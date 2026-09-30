'use client';

import { Download, FlaskRound, Scale, X } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { ColumnChart, LineChart } from '@/components/charts/svg';
import { useSearchParams } from '@/components/shell/keep-alive';
import { Page } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Skeleton, Stat, Tabs } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { cite, SOURCES } from '@/lib/citation';
import { api } from '@/lib/client';
import { exportXlsx } from '@/lib/export-client';
import { compactNumber, multiple, pct, price } from '@/lib/format';
import { SERIES_COLORS } from '@/lib/theme';
import { cn } from '@/lib/utils';

// ─── Event study ────────────────────────────────────────────────────────────

type EventStudy = {
  symbol: string;
  benchmark: string;
  method: string;
  events: Array<{ date: string; aligned: string | null; alpha: number; beta: number; car: number; t: number; abnormal: Array<{ day: number; ar: number; car: number }>; error?: string }>;
  caar: Array<{ day: number; caar: number; aar: number }>;
  summary: { n: number; meanCar: number; t: number | null; positive: number };
  window: [number, number];
};

function EventStudyTool({ initialSymbol }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol ?? '');
  const [source, setSource] = useState<'earnings' | '8-K' | 'custom'>('earnings');
  const [dates, setDates] = useState('');
  const [before, setBefore] = useState('5');
  const [after, setAfter] = useState('5');
  const [benchmark, setBenchmark] = useState('SPY');
  const [result, setResult] = useState<EventStudy | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      setResult(
        await api<EventStudy>('/api/lab/event-study', {
          body: {
            symbol,
            source,
            benchmark: benchmark || 'SPY',
            window: [-Math.abs(Number(before) || 0), Math.abs(Number(after) || 0)],
            dates: source === 'custom' ? dates.split(/[\s,;]+/).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)) : undefined,
          },
        }),
      );
    } finally {
      setRunning(false);
    }
  };

  const download = () => {
    if (!result) return;
    void exportXlsx(`${result.symbol}-event-study`, [
      {
        name: 'Events',
        title: `${result.symbol} event study vs ${result.benchmark}, window [${result.window[0]}, ${result.window[1]}]`,
        columns: [
          { header: 'Event date', key: 'date', format: 'date' },
          { header: 'Aligned session', key: 'aligned', format: 'date' },
          { header: 'Alpha (daily)', key: 'alpha', format: 'number' },
          { header: 'Beta', key: 'beta', format: 'number' },
          { header: 'CAR', key: 'car', format: 'percent' },
          { header: 't-stat', key: 't', format: 'number' },
        ],
        rows: result.events.map((event) => ({ date: event.date, aligned: event.aligned, alpha: event.alpha, beta: event.beta, car: event.error ? null : event.car, t: event.error ? null : event.t })),
        notes: [result.method],
      },
      {
        name: 'CAAR',
        columns: [
          { header: 'Relative day', key: 'day', format: 'integer' },
          { header: 'Average AR', key: 'aar', format: 'percent' },
          { header: 'CAAR', key: 'caar', format: 'percent' },
        ],
        rows: result.caar,
      },
    ], [cite(SOURCES.prices(), 'APA'), 'MacKinlay, A. C. (1997). Event studies in economics and finance. Journal of Economic Literature, 35(1), 13–39.']);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Panel className="flex flex-col gap-3 p-4">
        <Field label="Company">
          {symbol ? (
            <div className="flex items-center gap-2">
              <CompanyLogo symbol={symbol} size="xs" />
              <span className="font-mono text-[13px] text-ink">{symbol}</span>
              <Button size="xs" variant="ghost" onClick={() => setSymbol('')}>
                Change
              </Button>
            </div>
          ) : (
            <TickerSearch onPick={setSymbol} placeholder="Search a ticker…" />
          )}
        </Field>
        <Field label="Events">
          <Segmented value={source} onChange={setSource} options={[{ value: 'earnings', label: 'Earnings' }, { value: '8-K', label: 'All 8-Ks' }, { value: 'custom', label: 'Custom' }]} />
        </Field>
        {source === 'custom' ? (
          <Field label="Event dates" hint="YYYY-MM-DD, separated by commas or new lines">
            <textarea className="min-h-24 w-full rounded-sm border border-line-strong bg-surface-1 p-2 font-mono text-[12px] text-ink" value={dates} onChange={(event) => setDates(event.target.value)} placeholder="2025-01-29&#10;2025-04-30" />
          </Field>
        ) : (
          <p className="text-[11.5px] leading-relaxed text-muted">{source === 'earnings' ? 'Earnings releases: 8-K filings with item 2.02, from SEC EDGAR (last 12).' : 'Every 8-K the company filed (last 12).'}</p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Days before">
            <Input inputMode="numeric" value={before} onChange={(event) => setBefore(event.target.value)} />
          </Field>
          <Field label="Days after">
            <Input inputMode="numeric" value={after} onChange={(event) => setAfter(event.target.value)} />
          </Field>
          <Field label="Market">
            <Input value={benchmark} onChange={(event) => setBenchmark(event.target.value.toUpperCase())} />
          </Field>
        </div>
        <Button variant="primary" onClick={() => void run()} loading={running} disabled={!symbol}>
          Run event study
        </Button>
        <p className="text-[11px] leading-relaxed text-faint">Market model: α and β estimated on trading days −250 to −30 before each event; abnormal return = actual − (α + β × market).</p>
      </Panel>
      {result ? (
        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader
              kicker={`${result.symbol} vs ${result.benchmark} · window [${result.window[0]}, +${result.window[1]}]`}
              title="Cumulative average abnormal return"
              actions={
                <Button size="xs" variant="outline" icon={<Download className="size-3" />} onClick={download}>
                  Excel
                </Button>
              }
            />
            <div className="grid grid-cols-2 gap-4 px-4 pb-3 sm:grid-cols-4">
              <Stat label="Events" value={result.summary.n} />
              <Stat label="Mean CAR" value={<span className={result.summary.meanCar >= 0 ? 'text-gain' : 'text-loss'}>{pct(result.summary.meanCar, 2)}</span>} />
              <Stat label="t-statistic" value={result.summary.t?.toFixed(2) ?? '—'} sub={<span className="text-muted">{result.summary.t !== null && Math.abs(result.summary.t) >= 1.96 ? 'significant at 5%' : 'not significant'}</span>} />
              <Stat label="Positive CARs" value={`${result.summary.positive} / ${result.summary.n}`} />
            </div>
            <div className="px-4 pb-4">
              <LineChart
                categories={result.caar.map((row) => (row.day > 0 ? `+${row.day}` : String(row.day)))}
                series={[
                  { label: 'CAAR', values: result.caar.map((row) => row.caar * 100), emphasis: true },
                  ...result.events.filter((event) => !event.error).slice(-3).map((event, index) => ({ label: event.date, values: event.abnormal.map((row) => row.car * 100), color: SERIES_COLORS[index], dashed: true })),
                ]}
                format={(value) => `${value.toFixed(2)}%`}
                height={240}
                zeroLine
              />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Per event" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12.5px]">
                <thead>
                  <tr className="border-y border-line text-left text-[11px] text-muted">
                    <th className="px-4 py-2 font-medium">Event</th>
                    <th className="px-2 py-2 text-right font-medium">Beta</th>
                    <th className="px-2 py-2 text-right font-medium">Day-0 AR</th>
                    <th className="px-2 py-2 text-right font-medium">CAR</th>
                    <th className="px-4 py-2 text-right font-medium">t</th>
                  </tr>
                </thead>
                <tbody>
                  {result.events.map((event) => (
                    <tr key={event.date} className="border-b border-line">
                      <td className="px-4 py-1.5 font-mono">{event.date}</td>
                      {event.error ? (
                        <td colSpan={4} className="px-4 py-1.5 text-muted">
                          {event.error}
                        </td>
                      ) : (
                        <>
                          <td className="num px-2 py-1.5 text-right">{event.beta.toFixed(2)}</td>
                          <td className="num px-2 py-1.5 text-right">{pct(event.abnormal.find((row) => row.day === 0)?.ar ?? 0, 2)}</td>
                          <td className={cn('num px-2 py-1.5 text-right', event.car >= 0 ? 'text-gain' : 'text-loss')}>{pct(event.car, 2)}</td>
                          <td className={cn('num px-4 py-1.5 text-right', Math.abs(event.t) >= 1.96 && 'font-semibold text-ink')}>{event.t.toFixed(2)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      ) : (
        <EmptyState icon={<FlaskRound className="size-4" />} title="Measure how the market reacted" body="Pick a company and its earnings releases (or your own dates) to see abnormal returns around each event, with significance tests you can cite." />
      )}
    </div>
  );
}

// ─── Comps ──────────────────────────────────────────────────────────────────

type Comps = {
  target: string;
  price: number | null;
  rows: Array<Record<string, number | string | null> & { symbol: string; name: string }>;
  summary: Record<string, { median: number | null; mean: number | null; low: number | null; high: number | null }>;
  implied: Array<{ method: string; multiple: number | null; price: number | null; upside: number | null }>;
  note: string;
};

const COMP_COLUMNS: Array<{ key: string; label: string; format: (value: number) => string; xlsx: 'multiple' | 'percent' | 'currencyMillions' | 'number' }> = [
  { key: 'marketCap', label: 'Mkt value', format: (value) => `$${compactNumber(value)}`, xlsx: 'currencyMillions' },
  { key: 'pe', label: 'P/E', format: (value) => multiple(value), xlsx: 'multiple' },
  { key: 'ps', label: 'P/S', format: (value) => multiple(value), xlsx: 'multiple' },
  { key: 'evEbitda', label: 'EV/EBITDA', format: (value) => multiple(value), xlsx: 'multiple' },
  { key: 'pb', label: 'P/B', format: (value) => multiple(value), xlsx: 'multiple' },
  { key: 'fcfYield', label: 'FCF yld', format: (value) => pct(value), xlsx: 'percent' },
  { key: 'revenueGrowth', label: 'Rev growth', format: (value) => pct(value), xlsx: 'percent' },
  { key: 'grossMargin', label: 'Gross mgn', format: (value) => pct(value), xlsx: 'percent' },
  { key: 'operatingMargin', label: 'Op mgn', format: (value) => pct(value), xlsx: 'percent' },
  { key: 'roe', label: 'ROE', format: (value) => pct(value), xlsx: 'percent' },
  { key: 'debtToEquity', label: 'D/E', format: (value) => value.toFixed(2), xlsx: 'number' },
  { key: 'score', label: 'Score', format: (value) => value.toFixed(0), xlsx: 'number' },
];

export function CompsTool({ initialSymbol, initialPeers }: { initialSymbol?: string; initialPeers?: string[] }) {
  const [symbol, setSymbol] = useState(initialSymbol ?? '');
  const [peers, setPeers] = useState<string[] | null>(initialPeers?.length ? initialPeers : null);
  const key = symbol ? `/api/lab/comps?symbol=${symbol}${peers ? `&peers=${peers.join(',')}` : ''}` : null;
  const { data, isLoading } = useSWR<Comps>(key);
  const currentPeers = peers ?? data?.rows.filter((row) => row.symbol !== data.target).map((row) => row.symbol) ?? [];

  const download = () => {
    if (!data) return;
    const columns = [{ header: 'Company', key: 'symbol', width: 12 }, { header: 'Name', key: 'name', width: 30 }, ...COMP_COLUMNS.map((column) => ({ header: column.label, key: column.key, format: column.xlsx }))];
    void exportXlsx(`${data.target}-comps`, [
      {
        name: 'Comps',
        title: `${data.target} comparable companies`,
        columns,
        rows: [
          ...data.rows.map((row) => Object.fromEntries(columns.map((column) => [column.key, row[column.key] ?? null]))),
          { symbol: 'Median', name: 'Peers', ...Object.fromEntries(COMP_COLUMNS.map((column) => [column.key, data.summary[column.key]?.median ?? null])) },
          { symbol: 'Mean', name: 'Peers', ...Object.fromEntries(COMP_COLUMNS.map((column) => [column.key, data.summary[column.key]?.mean ?? null])) },
        ],
        notes: [data.note],
      },
      {
        name: 'Implied value',
        columns: [
          { header: 'Method', key: 'method', width: 34 },
          { header: 'Peer median multiple', key: 'multiple', format: 'multiple' },
          { header: 'Implied price', key: 'price', format: 'currency' },
          { header: 'Upside', key: 'upside', format: 'percent' },
        ],
        rows: data.implied,
      },
    ], [cite(SOURCES.secFacts(data.target, null), 'APA'), cite(SOURCES.prices(), 'APA')]);
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Target">
          {symbol ? (
            <div className="flex h-8 items-center gap-2">
              <CompanyLogo symbol={symbol} size="xs" />
              <span className="font-mono text-[13px] text-ink">{symbol}</span>
              <Button size="xs" variant="ghost" onClick={() => { setSymbol(''); setPeers(null); }}>
                Change
              </Button>
            </div>
          ) : (
            <TickerSearch onPick={(value) => { setSymbol(value); setPeers(null); }} placeholder="Search a ticker…" className="w-60" />
          )}
        </Field>
        {symbol ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {currentPeers.map((peer) => (
              <Badge key={peer} tone="outline" className="gap-1">
                {peer}
                <button onClick={() => setPeers(currentPeers.filter((item) => item !== peer))} aria-label={`Remove ${peer}`}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <TickerSearch onPick={(value) => setPeers([...new Set([...currentPeers, value])])} placeholder="Add peer…" className="w-40" />
          </div>
        ) : null}
        {data ? (
          <Button variant="outline" icon={<Download className="size-3.5" />} onClick={download}>
            Excel
          </Button>
        ) : null}
      </Panel>
      {!symbol ? (
        <EmptyState icon={<Scale className="size-4" />} title="Build a comps table" body="Pick a company; SilverNote suggests peers (edit them freely), computes peer statistics and the value implied by peer multiples." />
      ) : isLoading && !data ? (
        <Skeleton className="h-72" />
      ) : data ? (
        <>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] text-muted">
                    <th className="px-4 py-2 font-medium">Company</th>
                    {COMP_COLUMNS.map((column) => (
                      <th key={column.key} className="px-2 py-2 text-right font-medium">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.symbol} className={cn('border-b border-line', row.symbol === data.target && 'bg-brand-wash/40')}>
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2">
                          <CompanyLogo symbol={row.symbol} size="xs" />
                          <span className="font-mono font-semibold text-ink">{row.symbol}</span>
                          <span className="max-w-40 truncate text-[11px] text-muted">{row.name}</span>
                        </div>
                      </td>
                      {COMP_COLUMNS.map((column) => (
                        <td key={column.key} className="num px-2 py-1.5 text-right">
                          {typeof row[column.key] === 'number' ? column.format(row[column.key] as number) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {(['median', 'mean', 'low', 'high'] as const).map((stat) => (
                    <tr key={stat} className="border-b border-line bg-surface-1/60 text-muted">
                      <td className="px-4 py-1.5 text-[11.5px] font-medium capitalize">Peer {stat}</td>
                      {COMP_COLUMNS.map((column) => {
                        const value = data.summary[column.key]?.[stat];
                        return (
                          <td key={column.key} className="num px-2 py-1.5 text-right">
                            {typeof value === 'number' ? column.format(value) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[11px] text-faint">{data.note}</p>
          </Panel>
          <Panel>
            <PanelHeader kicker={`${data.target} at ${price(data.price)}`} title="Value implied by peer medians" />
            <div className="grid gap-4 px-4 pb-4 md:grid-cols-[1fr_1fr]">
              <div className="flex flex-col">
                {data.implied.map((row) => (
                  <div key={row.method} className="flex items-center justify-between border-t border-line py-2 text-[12.5px]">
                    <span className="text-ink-2">
                      {row.method} <span className="text-faint">({row.multiple === null ? '—' : multiple(row.multiple)})</span>
                    </span>
                    <span className="num">
                      {price(row.price)} <span className={cn('ml-1', (row.upside ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>{row.upside === null ? '' : pct(row.upside)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <ColumnChart
                categories={data.implied.map((row) => row.method.split(' ')[0])}
                series={[{ label: 'Implied price', values: data.implied.map((row) => row.price), color: SERIES_COLORS[0] }]}
                format={(value) => `$${value.toFixed(0)}`}
                height={180}
              />
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

export function Lab() {
  const params = useSearchParams();
  const [tool, setTool] = useState<'event' | 'comps'>(params.get('tool') === 'comps' ? 'comps' : 'event');
  const initialSymbol = params.get('symbol')?.toUpperCase() ?? undefined;
  return (
    <Page
      kicker="Event studies · comparable companies · exports"
      title="Research lab"
      description="Tools for coursework and write-ups: every result exports to Excel with its sources and citations."
    >
      <Tabs value={tool} onChange={setTool} tabs={[{ value: 'event', label: 'Event study' }, { value: 'comps', label: 'Comparable companies' }]} />
      {tool === 'event' ? <EventStudyTool key={initialSymbol} initialSymbol={initialSymbol} /> : <CompsTool key={initialSymbol} initialSymbol={initialSymbol} />}
    </Page>
  );
}

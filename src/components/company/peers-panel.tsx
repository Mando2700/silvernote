'use client';

import { Plus, X } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { EmptyState, Input, Panel, PanelHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { compactNumber, multiple, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

type Entry = Record<string, number | string | null> & { symbol: string; name: string; sector: string | null; industry: string | null };
type Stats = { group: string; kind: 'sector' | 'industry'; count: number; medians: Record<string, number | null> };
type PeersResponse = {
  subject: Entry | null;
  peers: Entry[];
  suggested: { symbols: string[]; source: string };
  sector: Stats | null;
  industry: Stats | null;
  percentiles: { sector: string; count: number; percentiles: Record<string, number | null> } | null;
  componentScores: Record<string, Array<{ key: string; name: string; score: number }>>;
};

type MetricDef = { key: string; label: string; format: (value: number) => string; better: 'higher' | 'lower' };

const METRICS: MetricDef[] = [
  { key: 'score', label: 'SilverNote Score', format: (value) => value.toFixed(0), better: 'higher' },
  { key: 'marketCap', label: 'Market value', format: (value) => `$${compactNumber(value)}`, better: 'higher' },
  { key: 'revenueGrowth', label: 'Revenue growth', format: (value) => pct(value), better: 'higher' },
  { key: 'revenueCagr3', label: 'Revenue CAGR 3Y', format: (value) => pct(value), better: 'higher' },
  { key: 'grossMargin', label: 'Gross margin', format: (value) => pct(value), better: 'higher' },
  { key: 'operatingMargin', label: 'Operating margin', format: (value) => pct(value), better: 'higher' },
  { key: 'netMargin', label: 'Net margin', format: (value) => pct(value), better: 'higher' },
  { key: 'fcfMargin', label: 'FCF margin', format: (value) => pct(value), better: 'higher' },
  { key: 'roe', label: 'Return on equity', format: (value) => pct(value), better: 'higher' },
  { key: 'debtToEquity', label: 'Debt / equity', format: (value) => multiple(value, 2), better: 'lower' },
  { key: 'pe', label: 'P/E', format: (value) => multiple(value), better: 'lower' },
  { key: 'ps', label: 'P/S', format: (value) => multiple(value), better: 'lower' },
  { key: 'evEbitda', label: 'EV / EBITDA', format: (value) => multiple(value), better: 'lower' },
  { key: 'fcfYield', label: 'FCF yield', format: (value) => pct(value), better: 'higher' },
  { key: 'dividendYield', label: 'Dividend yield', format: (value) => pct(value, 2), better: 'higher' },
];

type Mode = 'sector' | 'industry' | 'peers';

function num(entry: Entry | null | undefined, key: string) {
  const value = entry?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function Relative({ subject, benchmark, better }: { subject: number | null; benchmark: number | null; better: 'higher' | 'lower' }) {
  if (subject === null || benchmark === null) return null;
  const above = subject > benchmark;
  const good = better === 'higher' ? above : !above;
  if (subject === benchmark) return null;
  return (
    <span className={cn('ml-1.5 font-mono text-[10px]', good ? 'text-gain' : 'text-loss')} title={good ? 'Better than the comparison' : 'Worse than the comparison'}>
      {above ? '▲' : '▼'}
    </span>
  );
}

function RankBars({ metric, rows, subjectSymbol, benchmark }: { metric: MetricDef; rows: Entry[]; subjectSymbol: string; benchmark: number | null }) {
  const values = rows.map((row) => ({ symbol: row.symbol, value: num(row, metric.key) })).filter((row): row is { symbol: string; value: number } => row.value !== null);
  const sorted = values.sort((a, b) => (metric.better === 'higher' ? b.value - a.value : a.value - b.value));
  const max = Math.max(...sorted.map((row) => Math.abs(row.value)), Math.abs(benchmark ?? 0), 1e-9);
  return (
    <div className="flex flex-col gap-1">
      {sorted.map((row, index) => {
        const isSubject = row.symbol === subjectSymbol;
        return (
          <div key={row.symbol} className="grid grid-cols-[16px_46px_1fr_64px] items-center gap-2">
            <CompanyLogo symbol={row.symbol} size="xs" />
            <span className={cn('font-mono text-[11px]', isSubject ? 'font-semibold text-ink' : 'text-muted')}>{row.symbol}</span>
            <div className="relative h-3">
              {benchmark !== null ? <div className="absolute inset-y-[-3px] w-px bg-white/40" style={{ left: `${(Math.max(0, benchmark) / max) * 100}%` }} title="Comparison median" /> : null}
              <motion.div
                className="h-full rounded-r-[4px]"
                style={{ background: isSubject ? '#cdd4de' : '#5d6470', boxShadow: isSubject ? '0 0 12px rgba(205,212,222,0.3)' : undefined }}
                initial={{ width: 0 }}
                animate={{ width: `${(Math.max(0, row.value) / max) * 100}%` }}
                transition={{ duration: 0.7, delay: index * 0.03, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <span className={cn('num text-right text-[11px]', isSubject ? 'text-ink' : 'text-ink-2')}>{metric.format(row.value)}</span>
          </div>
        );
      })}
      {benchmark !== null ? <div className="mt-1 text-[10.5px] text-faint">White tick: comparison median ({metric.format(benchmark)})</div> : null}
    </div>
  );
}

export function PeersPanel({ symbol }: { symbol: string }) {
  const [custom, setCustom] = useState<string[] | null>(null);
  const [mode, setMode] = useState<Mode>('peers');
  const [adding, setAdding] = useState('');
  const [focusMetric, setFocusMetric] = useState('operatingMargin');
  const query = custom ? `?symbols=${custom.join(',')}` : '';
  const { data, isLoading } = useSWR<PeersResponse>(`/api/company/${symbol}/peers${query}`);

  const peerSymbols = custom ?? data?.suggested.symbols ?? [];
  const peers = useMemo(() => data?.peers ?? [], [data]);
  const benchmarkFor = (key: string) => {
    if (mode === 'sector') return data?.sector?.medians[key] ?? null;
    if (mode === 'industry') return data?.industry?.medians[key] ?? null;
    return median(peers.map((peer) => num(peer, key)).filter((value): value is number => value !== null));
  };
  const benchmarkLabel = mode === 'sector' ? `${data?.subject?.sector ?? 'Sector'} median` : mode === 'industry' ? 'Industry median' : 'Peer median';

  if (isLoading && !data) return <Skeleton className="h-96 w-full" />;
  if (!data?.subject) {
    return (
      <Panel>
        <EmptyState title="No comparison data yet" body="Sector medians are built from the universe fundamentals; they appear once the first SEC ingest finishes." />
      </Panel>
    );
  }

  const subject = data.subject;
  const focus = METRICS.find((metric) => metric.key === focusMetric) ?? METRICS[5];
  const componentKeys = data.componentScores[symbol] ?? [];
  const peerComponents = peers.map((peer) => data.componentScores[peer.symbol]).filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          kicker={mode === 'peers' ? data.suggested.source : mode === 'sector' ? `${data.sector?.count ?? 0} companies above $50M` : `${data.industry?.count ?? 0} companies in ${subject.industry}`}
          title="Compare"
          actions={
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'peers', label: 'Peer group' },
                { value: 'industry', label: 'Industry median' },
                { value: 'sector', label: 'Sector median' },
              ]}
            />
          }
        />
        {mode === 'peers' ? (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
            {peerSymbols.map((peer) => (
              <span key={peer} className="flex h-6 items-center gap-1 rounded-xs border border-line-strong bg-surface-3 pr-1 pl-2 font-mono text-[11px] text-ink-2">
                <Link href={`/company/${peer}`} className="hover:text-ink">
                  {peer}
                </Link>
                <button onClick={() => setCustom(peerSymbols.filter((item) => item !== peer))} className="rounded-[2px] p-0.5 text-faint hover:bg-white/10 hover:text-ink" aria-label={`Remove ${peer}`}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                const ticker = adding.trim().toUpperCase();
                if (ticker && !peerSymbols.includes(ticker) && ticker !== symbol) setCustom([...peerSymbols, ticker].slice(0, 12));
                setAdding('');
              }}
            >
              <Input value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="Add ticker" className="h-6 w-24 font-mono text-[11px] uppercase" />
              <Button size="xs" variant="ghost" type="submit" icon={<Plus className="size-3" />}>
                Add
              </Button>
            </form>
            {custom ? (
              <button onClick={() => setCustom(null)} className="ml-1 text-[11px] text-brand-soft hover:underline">
                Reset to suggested
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="bg-surface-1 text-muted">
                <th className="px-4 py-2 text-left font-medium">Metric</th>
                <th className="px-3 py-2 text-right font-medium text-ink">{symbol}</th>
                <th className="px-3 py-2 text-right font-medium">{benchmarkLabel}</th>
                {mode === 'peers' ? peers.map((peer) => (
                  <th key={peer.symbol} className="px-3 py-2 text-right font-mono text-[11px] font-medium">
                    {peer.symbol}
                  </th>
                )) : null}
                <th className="px-3 py-2 text-right font-medium">Sector rank</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => {
                const subjectValue = num(subject, metric.key);
                const benchmark = benchmarkFor(metric.key);
                const percentile = data.percentiles?.percentiles[metric.key] ?? null;
                return (
                  <tr
                    key={metric.key}
                    onClick={() => setFocusMetric(metric.key)}
                    className={cn('cursor-pointer border-t border-line hover:bg-white/[0.025]', focusMetric === metric.key && 'bg-brand-wash')}
                  >
                    <td className="px-4 py-1.5 text-ink-2">{metric.label}</td>
                    <td className="num px-3 py-1.5 text-right font-medium text-ink">
                      {subjectValue !== null ? metric.format(subjectValue) : '—'}
                      <Relative subject={subjectValue} benchmark={benchmark} better={metric.better} />
                    </td>
                    <td className="num px-3 py-1.5 text-right text-muted">{benchmark !== null ? metric.format(benchmark) : '—'}</td>
                    {mode === 'peers'
                      ? peers.map((peer) => {
                          const peerValue = num(peer, metric.key);
                          return (
                            <td key={peer.symbol} className="num px-3 py-1.5 text-right text-ink-2">
                              {peerValue !== null ? metric.format(peerValue) : '—'}
                            </td>
                          );
                        })
                      : null}
                    <td className="px-3 py-1.5">
                      {percentile !== null ? (
                        <div className="ml-auto flex w-28 items-center gap-2">
                          <div className="relative h-1.5 flex-1 rounded-full bg-white/[0.06]">
                            <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-2 bg-brand" style={{ left: `${percentile}%` }} />
                          </div>
                          <span className="num w-7 text-right text-[11px] text-muted">{percentile}</span>
                        </div>
                      ) : (
                        <span className="block text-right text-[11px] text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-[11px] text-faint">
          ▲▼ better/worse than the comparison, by the metric’s own direction (lower is better for multiples and leverage). Sector rank is the percentile within {data.percentiles?.sector ?? 'the sector'} (100 = best). Click a row to chart it.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader kicker="Ranking" title={focus.label} />
          <div className="px-4 pb-4">
            <RankBars metric={focus} rows={[subject, ...peers]} subjectSymbol={symbol} benchmark={benchmarkFor(focus.key)} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader kicker="SilverNote Score components" title={`${symbol} vs peer median`} />
          <div className="px-4 pb-4">
            {componentKeys.length ? (
              <div className="flex flex-col gap-2">
                {componentKeys.map((component) => {
                  const peerMedian = median(peerComponents.map((list) => list.find((item) => item.key === component.key)?.score).filter((value): value is number => typeof value === 'number'));
                  return (
                    <div key={component.key} className="grid grid-cols-[130px_1fr_60px] items-center gap-3">
                      <span className="truncate text-[12px] text-ink-2">{component.name}</span>
                      <div className="relative h-4">
                        <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.08]" />
                        {peerMedian !== null ? (
                          <div
                            className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-white/25"
                            style={{ left: `${Math.min(peerMedian, component.score)}%`, width: `${Math.abs(component.score - peerMedian)}%` }}
                          />
                        ) : null}
                        {peerMedian !== null ? <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-2 bg-[#858a95]" style={{ left: `${peerMedian}%` }} title={`Peer median ${peerMedian}`} /> : null}
                        <motion.div
                          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-2 bg-brand shadow-[0_0_10px_rgba(205,212,222,0.42)]"
                          initial={{ left: '0%' }}
                          animate={{ left: `${component.score}%` }}
                          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                          title={`${symbol} ${component.score}`}
                        />
                      </div>
                      <span className="num text-right text-[11px] text-muted">
                        <span className="text-ink">{component.score}</span> / {peerMedian ?? '—'}
                      </span>
                    </div>
                  );
                })}
                <div className="mt-1 flex items-center gap-4 text-[10.5px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-brand" /> {symbol}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-[#858a95]" /> Peer median ({peerComponents.length} scored)
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-muted">Open the Score tab once to calculate component scores for this company.</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

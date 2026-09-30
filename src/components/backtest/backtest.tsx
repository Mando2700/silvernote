'use client';

import { Database, History, Play, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { ColumnChart, LineChart, SERIES_COLORS } from '@/components/charts/svg';
import { Delta } from '@/components/motion/delta';
import { ScoreRing } from '@/components/motion/score-ring';
import { Page } from '@/components/shell/page';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Select, Skeleton } from '@/components/ui/primitives';
import { StatTile } from '@/components/ui/stat-tile';
import { api } from '@/lib/client';
import { FIELD_LABELS, type Field as RuleField, type Operator, PRICE_FIELDS, SCORE_FIELDS, type BacktestResult, type Strategy, type Trade } from '@/lib/finance/backtest';
import { fixed, money, pct, price, shortDate, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';

type Job = { status: 'running' | 'done' | 'failed' | 'cancelled'; total: number; done: number; message: string | null; error: string | null; finished_at: string | null };
type Status = {
  panel: { symbols: number; rows: number; first: string | null; last: string | null } | null;
  job: Job | null;
  defaults: { size: number; years: number };
  sectors: string[];
};
type Saved = { id: string; name: string; definition: Strategy; updated_at: string };

/** Rule as edited: value in display units (percent for returns). */
type DraftRule = { field: RuleField; op: Operator; value: string; lookback: string };
type Draft = {
  entry: DraftRule[];
  exit: DraftRule[];
  rebalance: '1' | '3' | '6' | '12';
  maxPositions: string;
  rankBy: RuleField;
  weighting: 'equal' | 'signal';
  costBps: string;
  start: string;
  end: string;
  minMarketCap: string;
  sectors: string[];
};

const OPERATORS: Array<{ value: Operator; label: string }> = [
  { value: 'gt', label: 'is above' },
  { value: 'lt', label: 'is below' },
  { value: 'rising', label: 'is rising' },
  { value: 'falling', label: 'is falling' },
  { value: 'top', label: 'is in the top %' },
  { value: 'bottom', label: 'is in the bottom %' },
];

const isReturn = (field: RuleField) => field.startsWith('return');

const rule = (field: RuleField, op: Operator, value = '', lookback = '1'): DraftRule => ({ field, op, value, lookback });

const BASE: Omit<Draft, 'entry' | 'exit'> = { rebalance: '1', maxPositions: '20', rankBy: 'overall', weighting: 'equal', costBps: '10', start: '', end: '', minMarketCap: '', sectors: [] };

const PRESETS: Array<{ name: string; draft: Draft }> = [
  { name: 'Score > 80, momentum rising', draft: { ...BASE, entry: [rule('overall', 'gt', '80'), rule('momentum', 'rising')], exit: [] } },
  { name: 'Quality at a fair price', draft: { ...BASE, rebalance: '3', maxPositions: '25', entry: [rule('profitability', 'top', '20'), rule('valuation', 'gt', '55')], exit: [] } },
  { name: '12-month momentum leaders', draft: { ...BASE, rankBy: 'return12m', entry: [rule('return12m', 'top', '10')], exit: [rule('return3m', 'lt', '-15')] } },
  { name: 'Improving fundamentals', draft: { ...BASE, rebalance: '3', entry: [rule('overall', 'rising', '4', '3'), rule('financialHealth', 'gt', '60')], exit: [rule('overall', 'lt', '55')] } },
  { name: 'Cheap and solvent', draft: { ...BASE, rebalance: '6', rankBy: 'valuation', entry: [rule('valuation', 'top', '20'), rule('financialHealth', 'gt', '65')], exit: [] } },
];

function toStrategy(draft: Draft): Strategy {
  const convert = (item: DraftRule) => {
    const raw = item.value.trim() === '' ? undefined : Number(item.value);
    const scaled = raw !== undefined && isReturn(item.field) && item.op !== 'top' && item.op !== 'bottom' ? raw / 100 : raw;
    return {
      field: item.field,
      op: item.op,
      ...(scaled !== undefined && Number.isFinite(scaled) ? { value: scaled } : {}),
      ...(item.op === 'rising' || item.op === 'falling' ? { lookback: Math.max(1, Number(item.lookback) || 1) } : {}),
    };
  };
  return {
    entry: draft.entry.map(convert),
    exit: draft.exit.map(convert),
    rebalance: Number(draft.rebalance) as Strategy['rebalance'],
    maxPositions: Math.max(1, Math.min(200, Number(draft.maxPositions) || 20)),
    rankBy: draft.rankBy,
    weighting: draft.weighting,
    costBps: Math.max(0, Number(draft.costBps) || 0),
    ...(draft.start ? { start: draft.start } : {}),
    ...(draft.end ? { end: draft.end } : {}),
    ...(draft.minMarketCap ? { minMarketCap: Number(draft.minMarketCap) } : {}),
    ...(draft.sectors.length ? { sectors: draft.sectors } : {}),
  };
}

function toDraft(strategy: Strategy): Draft {
  const convert = (item: Strategy['entry'][number]): DraftRule => {
    const value = item.value === undefined ? '' : isReturn(item.field) && item.op !== 'top' && item.op !== 'bottom' ? String(Math.round(item.value * 10_000) / 100) : String(item.value);
    return { field: item.field, op: item.op, value, lookback: String(item.lookback ?? 1) };
  };
  return {
    entry: strategy.entry.map(convert),
    exit: strategy.exit.map(convert),
    rebalance: String(strategy.rebalance) as Draft['rebalance'],
    maxPositions: String(strategy.maxPositions),
    rankBy: strategy.rankBy,
    weighting: strategy.weighting,
    costBps: String(strategy.costBps),
    start: strategy.start ?? '',
    end: strategy.end ?? '',
    minMarketCap: strategy.minMarketCap !== undefined ? String(strategy.minMarketCap) : '',
    sectors: strategy.sectors ?? [],
  };
}

function describeRule(item: DraftRule) {
  const label = FIELD_LABELS[item.field];
  const unit = isReturn(item.field) ? '%' : '';
  switch (item.op) {
    case 'gt':
      return `${label} > ${item.value || 0}${unit}`;
    case 'lt':
      return `${label} < ${item.value || 0}${unit}`;
    case 'rising':
    case 'falling':
      return `${label} ${item.op} over ${item.lookback || 1}m${item.value ? ` by ${item.value}${unit}+` : ''}`;
    default:
      return `${label} in ${item.op} ${item.value || 0}%`;
  }
}

function FieldSelect({ value, onChange, className }: { value: RuleField; onChange: (field: RuleField) => void; className?: string }) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value as RuleField)} className={className}>
      <optgroup label="SilverNote Score">
        {SCORE_FIELDS.map((field) => (
          <option key={field} value={field}>
            {FIELD_LABELS[field]}
          </option>
        ))}
      </optgroup>
      <optgroup label="Price">
        {PRICE_FIELDS.map((field) => (
          <option key={field} value={field}>
            {FIELD_LABELS[field]}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

function RuleRow({ item, onChange, onRemove }: { item: DraftRule; onChange: (item: DraftRule) => void; onRemove: () => void }) {
  const trend = item.op === 'rising' || item.op === 'falling';
  const rank = item.op === 'top' || item.op === 'bottom';
  const unit = rank || isReturn(item.field) ? '%' : item.field === 'marketCap' ? '$B' : 'pts';
  return (
    <div className="grid grid-cols-[1.3fr_1fr_0.8fr_auto] items-center gap-2 md:grid-cols-[1.3fr_1fr_0.7fr_0.8fr_auto]">
      <FieldSelect value={item.field} onChange={(field) => onChange({ ...item, field })} />
      <Select value={item.op} onChange={(event) => onChange({ ...item, op: event.target.value as Operator })}>
        {OPERATORS.map((operator) => (
          <option key={operator.value} value={operator.value}>
            {operator.label}
          </option>
        ))}
      </Select>
      <div className="relative">
        <Input
          inputMode="decimal"
          value={item.value}
          onChange={(event) => onChange({ ...item, value: event.target.value })}
          placeholder={trend ? 'by any' : rank ? '10' : '80'}
          aria-label={trend ? 'Minimum change' : 'Value'}
          className="pr-9"
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-faint">{unit}</span>
      </div>
      <div className={cn('relative hidden md:block', !trend && 'invisible')}>
        <Input inputMode="numeric" value={item.lookback} onChange={(event) => onChange({ ...item, lookback: event.target.value })} aria-label="Months to compare" className="pr-14" />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-faint">months</span>
      </div>
      <button onClick={onRemove} className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink" aria-label="Remove rule">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function RuleList({ title, hint, rules, onChange }: { title: string; hint: string; rules: DraftRule[]; onChange: (rules: DraftRule[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-[12.5px] font-medium text-ink">{title}</div>
          <div className="text-[11.5px] text-muted">{hint}</div>
        </div>
        <Button variant="ghost" size="sm" icon={<Plus className="size-3.5" />} onClick={() => onChange([...rules, rule('overall', 'gt', '70')])}>
          Add rule
        </Button>
      </div>
      {rules.map((item, index) => (
        <RuleRow
          key={index}
          item={item}
          onChange={(next) => onChange(rules.map((current, i) => (i === index ? next : current)))}
          onRemove={() => onChange(rules.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  );
}

function PanelBuilder({ status, onStarted }: { status: Status; onStarted: () => void }) {
  const [size, setSize] = useState(String(status.defaults.size));
  const running = status.job?.status === 'running';
  const start = async () => {
    try {
      await api('/api/jobs', { body: { kind: 'panel', params: { size: Number(size), years: status.defaults.years } } });
      toast.success('Building score history in the background');
      onStarted();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const progress = running && status.job?.total ? status.job.done / status.job.total : null;
  return (
    <div className="flex flex-col gap-3">
      {running ? (
        <div>
          <div className="flex justify-between text-[12px] text-muted">
            <span>{status.job?.message ?? 'Starting…'}</span>
            <span className="num">{progress !== null ? pct(progress, 0) : ''}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${(progress ?? 0.02) * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Companies (largest by market value)" className="w-56">
            <Select value={size} onChange={(event) => setSize(event.target.value)}>
              <option value="100">100 · a few minutes</option>
              <option value="250">250</option>
              <option value="500">500 · recommended</option>
              <option value="1000">1,000 · slow first run</option>
            </Select>
          </Field>
          <Button variant={status.panel?.rows ? 'outline' : 'primary'} icon={status.panel?.rows ? <RefreshCw className="size-3.5" /> : <Database className="size-3.5" />} onClick={() => void start()}>
            {status.panel?.rows ? 'Rebuild history' : 'Build history'}
          </Button>
        </div>
      )}
      {status.job?.status === 'failed' ? <p className="text-[11.5px] text-loss">Last build failed: {status.job.error}</p> : null}
    </div>
  );
}

const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function TradeTable({ trades, open }: { trades: Trade[]; open?: boolean }) {
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0">
          <tr className="border-y border-line bg-surface-1 text-right text-[11px] text-muted">
            <th className="px-4 py-2 text-left font-medium">Stock</th>
            <th className="px-3 py-2 font-medium">Bought</th>
            <th className="px-3 py-2 font-medium">{open ? 'Now' : 'Sold'}</th>
            <th className="px-3 py-2 font-medium">Months</th>
            <th className="px-3 py-2 font-medium">Return</th>
            {open ? null : <th className="px-4 py-2 text-left font-medium">Why</th>}
          </tr>
        </thead>
        <tbody>
          {trades.map((trade, index) => (
            <tr key={`${trade.symbol}-${trade.entryDate}-${index}`} className="border-b border-line text-right">
              <td className="px-4 py-1.5 text-left">
                <Link href={`/company/${trade.symbol}`} className="flex items-center gap-2 font-mono text-[12px] font-semibold text-ink hover:text-white">
                  <CompanyLogo symbol={trade.symbol} size="xs" />
                  {trade.symbol}
                </Link>
              </td>
              <td className="num px-3 py-1.5 text-ink-2">
                {monthLabel(trade.entryDate)} <span className="text-faint">{price(trade.entryPrice)}</span>
              </td>
              <td className="num px-3 py-1.5 text-ink-2">
                {open ? '' : trade.exitDate ? monthLabel(trade.exitDate) : ''} <span className="text-faint">{price(trade.exitPrice)}</span>
              </td>
              <td className="num px-3 py-1.5 text-muted">{trade.months}</td>
              <td className="px-3 py-1.5">
                <Delta value={trade.return} digits={1} className="justify-end text-[12px]" />
              </td>
              {open ? null : <td className="px-4 py-1.5 text-left text-[11.5px] text-muted">{trade.reason}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Results({ result, strategyName }: { result: BacktestResult; strategyName: string }) {
  const [tradeView, setTradeView] = useState<'closed' | 'open'>('open');
  const { stats, benchmarkStats: bench, universeStats: universe } = result;
  const step = Math.max(1, Math.ceil(result.dates.length / 180));
  const indices = result.dates.map((_, index) => index).filter((index) => index % step === 0 || index === result.dates.length - 1);
  const drawdown = useMemo(() => {
    const series: number[] = [];
    let peak = 0;
    for (const value of result.equity) {
      peak = Math.max(peak, value);
      series.push((value / peak - 1) * 100);
    }
    return series;
  }, [result]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <StatTile label="Annual return" value={<Delta value={stats.cagr} digits={1} className="text-[17px]" />} sub={<span className="text-muted">SPY {signedPct(bench.cagr, 1)} · universe {signedPct(universe.cagr, 1)}</span>} hint="Compound annual growth rate after trading costs" />
        <StatTile label="Total return" value={<Delta value={stats.totalReturn} digits={0} className="text-[17px]" />} sub={<span className="text-muted">SPY {signedPct(bench.totalReturn, 0)}</span>} />
        <StatTile label="Volatility" value={pct(stats.volatility)} sub={<span className="text-muted">SPY {pct(bench.volatility)}</span>} hint="Annualized standard deviation of monthly returns" />
        <StatTile label="Sharpe" value={fixed(stats.sharpe)} sub={<span className="text-muted">Sortino {fixed(stats.sortino)} · SPY {fixed(bench.sharpe)}</span>} />
        <StatTile
          label="Max drawdown"
          value={<span className="text-loss">{signedPct(stats.maxDrawdown, 1)}</span>}
          sub={<span className="text-muted">{stats.maxDrawdownFrom ? `${monthLabel(stats.maxDrawdownFrom)} → ${monthLabel(stats.maxDrawdownTo as string)}` : `SPY ${signedPct(bench.maxDrawdown, 1)}`}</span>}
          hint="Worst peak-to-trough fall on month-end values"
        />
        <StatTile label="Beta · alpha" value={fixed(stats.beta)} sub={<Delta value={stats.alpha} digits={1} className="text-[11.5px]" />} hint="Sensitivity to SPY and annual return beyond what that beta explains" />
        <StatTile label="Beat SPY" value={pct(stats.hitRate, 0)} sub={<span className="text-muted">of months</span>} />
        <StatTile label="Holdings" value={fixed(stats.avgPositions, 1)} sub={<span className="text-muted">avg · invested {pct(stats.exposure, 0)} of months</span>} />
        <StatTile label="Turnover" value={pct(stats.turnover, 0)} sub={<span className="text-muted">a year, one-way</span>} hint="Share of the portfolio replaced per year" />
        <StatTile label="Trades" value={stats.trades.toLocaleString()} sub={<span className="text-muted">{stats.winRate !== null ? `${pct(stats.winRate, 0)} winners · avg ${signedPct(stats.avgTradeReturn, 1)}` : 'none closed'}</span>} />
      </div>

      <Panel>
        <PanelHeader kicker={`Growth of $10,000 · ${monthLabel(result.dates[0])} – ${monthLabel(result.dates[result.dates.length - 1])} · monthly`} title={strategyName} />
        <div className="px-4 pb-2">
          <LineChart
            categories={indices.map((index) => monthLabel(result.dates[index]))}
            series={[
              { label: 'Strategy', values: indices.map((index) => result.equity[index] * 10_000), color: '#cdd4de', emphasis: true },
              { label: 'SPY', values: indices.map((index) => result.benchmark[index] * 10_000), color: SERIES_COLORS[0] },
              { label: 'Universe', values: indices.map((index) => result.universe[index] * 10_000), color: SERIES_COLORS[1], dashed: true },
            ]}
            format={(value) => money(value, { compact: true })}
            height={280}
          />
        </div>
        <div className="px-4 pb-4">
          <div className="kicker mb-1">Drawdown</div>
          <LineChart
            categories={indices.map((index) => monthLabel(result.dates[index]))}
            series={[{ label: 'Drawdown', values: indices.map((index) => drawdown[index]), color: '#d55181' }]}
            format={(value) => `${value.toFixed(0)}%`}
            height={110}
            endLabels={false}
          />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel>
          <PanelHeader kicker="Calendar-year returns" title="Year by year" />
          <div className="px-4 pb-4">
            <ColumnChart
              categories={result.yearly.map((row) => String(row.year))}
              series={[
                { label: 'Strategy', values: result.yearly.map((row) => row.strategy * 100), color: '#cdd4de' },
                { label: 'SPY', values: result.yearly.map((row) => (row.benchmark !== null ? row.benchmark * 100 : null)), color: SERIES_COLORS[0] },
                { label: 'Universe', values: result.yearly.map((row) => row.universe * 100), color: SERIES_COLORS[1] },
              ]}
              format={(value) => `${value.toFixed(0)}%`}
              height={230}
            />
          </div>
        </Panel>
        <Panel>
          <PanelHeader kicker={`What the rules pick at ${monthLabel(result.dates[result.dates.length - 1])}`} title="Current picks" />
          {result.picks.length ? (
            <div className="max-h-[300px] overflow-auto">
              {result.picks.map((pick) => (
                <Link key={pick.symbol} href={`/company/${pick.symbol}`} className="flex items-center gap-2.5 border-t border-line px-4 py-1.5 hover:bg-white/[0.025]">
                  <CompanyLogo symbol={pick.symbol} size="xs" />
                  <span className="w-14 font-mono text-[12px] font-semibold text-ink">{pick.symbol}</span>
                  <span className="num flex-1 text-[11.5px] text-muted">
                    ${price(pick.price)} · momentum {pick.momentum ?? '—'}
                  </span>
                  <ScoreRing score={pick.overall} size="xs" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-4 pb-4 text-[12.5px] text-muted">Nothing meets the entry rules today.</p>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          kicker="Month-end prices"
          title="Trades"
          actions={
            <Segmented
              size="xs"
              value={tradeView}
              onChange={setTradeView}
              options={[
                { value: 'open', label: `Open (${result.openPositions.length})` },
                { value: 'closed', label: `Closed (${result.trades.length})` },
              ]}
            />
          }
        />
        <TradeTable trades={tradeView === 'open' ? result.openPositions : result.trades.slice(0, 300)} open={tradeView === 'open'} />
      </Panel>

      <p className="px-1 text-[11px] leading-relaxed text-faint">
        How to read this: scores are recomputed at each month end from annual SEC filings that had been filed by then (or 90 days after the fiscal year end when the filing date is
        unknown) and prices up to that day. The universe is today’s {result.universeSize.toLocaleString()} largest companies, so firms that failed or were acquired are missing —
        this survivorship bias flatters every strategy, which is why the equal-weight “Universe” line (same bias, no rules) is the fair yardstick. Returns are price-only
        (dividends excluded) with trading costs charged on turnover. Past results do not predict future ones.
      </p>
    </div>
  );
}

export function Backtest() {
  const { data: status, mutate: refreshStatus } = useSWR<Status>('/api/backtest', {
    refreshInterval: (latest) => (latest?.job?.status === 'running' ? 3000 : 0),
  });
  const { data: saved, mutate: refreshSaved } = useSWR<Saved[]>('/api/backtest/strategies');
  const [draft, setDraft] = useState<Draft>(PRESETS[0].draft);
  const [name, setName] = useState(PRESETS[0].name);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);

  const hasPanel = Boolean(status?.panel?.rows);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const run = async () => {
    setRunning(true);
    try {
      setResult(await api<BacktestResult>('/api/backtest/run', { body: toStrategy(draft) }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    const label = window.prompt('Name this strategy', name)?.trim();
    if (!label) return;
    try {
      const body = { name: label, definition: toStrategy(draft) };
      const row = savedId && saved?.some((item) => item.id === savedId && item.name === label)
        ? await api<Saved>(`/api/backtest/strategies/${savedId}`, { method: 'PUT', body })
        : await api<Saved>('/api/backtest/strategies', { body });
      setSavedId(row.id);
      setName(label);
      await refreshSaved();
      toast.success(`Saved “${label}”`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const load = (item: { name: string; draft: Draft; id?: string }) => {
    setDraft(item.draft);
    setName(item.name);
    setSavedId(item.id ?? null);
    setResult(null);
  };

  return (
    <Page
      kicker="Rules tested on point-in-time scores"
      title="Backtest"
      description="Test a screen across history — for example “buy when the Score is above 80 and momentum is rising” — against SPY and an equal-weight universe."
      actions={
        hasPanel ? (
          <Magnetic>
            <Button variant="primary" icon={<Play className="size-3.5" />} loading={running} onClick={() => void run()} disabled={!draft.entry.length}>
              Run backtest
            </Button>
          </Magnetic>
        ) : null
      }
    >
      {!status ? (
        <Skeleton className="h-40" />
      ) : !hasPanel ? (
        <Panel>
          <EmptyState
            icon={<History className="size-4" />}
            title="Build the score history first"
            body={
              <>
                Backtests need the SilverNote Score as it read at every month end. SilverNote rebuilds it for the largest companies over the last {status.defaults.years} years from the
                SEC filings public at each date, plus 10 years of prices. The first build downloads a lot of data and can take 20–40 minutes for 500 companies; it runs in the background
                and later rebuilds reuse the cache.
              </>
            }
            action={<PanelBuilder status={status} onStarted={() => void refreshStatus()} />}
          />
        </Panel>
      ) : (
        <>
          <Panel>
            <PanelHeader
              kicker={`History: ${status.panel?.symbols.toLocaleString()} companies · ${status.panel?.first ? shortDate(status.panel.first) : ''} – ${status.panel?.last ? shortDate(status.panel.last) : ''}`}
              title="Strategy"
              actions={
                <>
                  <Select
                    value=""
                    onChange={(event) => {
                      const value = event.target.value;
                      const preset = PRESETS.find((item) => `preset:${item.name}` === value);
                      if (preset) load(preset);
                      const item = saved?.find((entry) => entry.id === value);
                      if (item) load({ name: item.name, draft: toDraft(item.definition), id: item.id });
                    }}
                    className="w-52"
                    aria-label="Load a strategy"
                  >
                    <option value="">Load a strategy…</option>
                    <optgroup label="Examples">
                      {PRESETS.map((preset) => (
                        <option key={preset.name} value={`preset:${preset.name}`}>
                          {preset.name}
                        </option>
                      ))}
                    </optgroup>
                    {saved?.length ? (
                      <optgroup label="Saved">
                        {saved.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </Select>
                  <Button variant="outline" size="sm" icon={<Save className="size-3.5" />} onClick={() => void save()}>
                    Save
                  </Button>
                  {savedId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="size-3.5" />}
                      aria-label="Delete saved strategy"
                      onClick={async () => {
                        if (!window.confirm(`Delete “${name}”?`)) return;
                        await api(`/api/backtest/strategies/${savedId}`, { method: 'DELETE' });
                        setSavedId(null);
                        void refreshSaved();
                      }}
                    />
                  ) : null}
                </>
              }
            />
            <div className="grid gap-5 px-4 pb-4 xl:grid-cols-[1.5fr_1fr]">
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                  <span className="font-medium text-ink">{name}:</span>
                  buy when {draft.entry.map(describeRule).join(' and ') || '…'}
                  {draft.exit.length ? `; sell when ${draft.exit.map(describeRule).join(' or ')}` : '; sell when it no longer qualifies'}
                </div>
                <RuleList title="Buy when all of these are true" hint="Checked at every rebalance for every company in the history." rules={draft.entry} onChange={(rules) => set('entry', rules)} />
                <RuleList
                  title="Sell when any of these is true"
                  hint="Leave empty to sell as soon as a holding stops meeting the buy rules."
                  rules={draft.exit}
                  onChange={(rules) => set('exit', rules)}
                />
              </div>
              <div className="grid content-start gap-3 sm:grid-cols-2">
                <Field label="Rebalance">
                  <Segmented
                    value={draft.rebalance}
                    onChange={(value) => set('rebalance', value)}
                    options={[
                      { value: '1', label: '1M' },
                      { value: '3', label: '3M' },
                      { value: '6', label: '6M' },
                      { value: '12', label: '12M' },
                    ]}
                  />
                </Field>
                <Field label="Weighting">
                  <Segmented
                    value={draft.weighting}
                    onChange={(value) => set('weighting', value)}
                    options={[
                      { value: 'equal', label: 'Equal' },
                      { value: 'signal', label: 'By rank value' },
                    ]}
                  />
                </Field>
                <Field label="Rank candidates by" hint="Highest first when there are more than the maximum">
                  <FieldSelect value={draft.rankBy} onChange={(field) => set('rankBy', field)} />
                </Field>
                <Field label="Max positions">
                  <Input inputMode="numeric" value={draft.maxPositions} onChange={(event) => set('maxPositions', event.target.value)} />
                </Field>
                <Field label="Trading cost (bp)" hint="Charged on every dollar traded">
                  <Input inputMode="decimal" value={draft.costBps} onChange={(event) => set('costBps', event.target.value)} />
                </Field>
                <Field label="Min market value ($B)">
                  <Input inputMode="decimal" value={draft.minMarketCap} onChange={(event) => set('minMarketCap', event.target.value)} placeholder="Any" />
                </Field>
                <Field label="From">
                  <Input type="date" value={draft.start} min={status.panel?.first ?? undefined} onChange={(event) => set('start', event.target.value)} />
                </Field>
                <Field label="To">
                  <Input type="date" value={draft.end} max={status.panel?.last ?? undefined} onChange={(event) => set('end', event.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <div className="mb-1.5 text-[11.5px] text-muted">Sectors {draft.sectors.length ? `(${draft.sectors.length})` : '(all)'}</div>
                  <div className="flex flex-wrap gap-1">
                    {status.sectors.map((sector) => {
                      const active = draft.sectors.includes(sector);
                      return (
                        <button
                          key={sector}
                          type="button"
                          onClick={() => set('sectors', active ? draft.sectors.filter((item) => item !== sector) : [...draft.sectors, sector])}
                          className={cn('rounded-xs border px-1.5 py-0.5 text-[11px] transition-colors', active ? 'border-brand/40 bg-brand-wash text-ink' : 'border-line text-muted hover:text-ink-2')}
                        >
                          {sector}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
              <details className="text-[12px] text-muted">
                <summary className="cursor-pointer select-none">Score history</summary>
                <div className="mt-2">
                  <PanelBuilder status={status} onStarted={() => void refreshStatus()} />
                </div>
              </details>
              {status.job?.status === 'running' ? <Badge tone="warning">Rebuilding history · {status.job.message}</Badge> : null}
            </div>
          </Panel>
          {running && !result ? <Skeleton className="h-80" /> : null}
          {result ? <Results result={result} strategyName={name} /> : null}
        </>
      )}
    </Page>
  );
}

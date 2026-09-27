'use client';

import { ArrowDown, ArrowUp, Briefcase, ImagePlus, Info, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, ViewTransition } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { CorrelationGrid } from '@/components/charts/correlation-grid';
import { MarketHeatmap } from '@/components/charts/market-heatmap';
import { LineChart, ScrollReveal, SERIES_COLORS } from '@/components/charts/svg';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { ImportPhotosModal } from '@/components/portfolio/import-photos';
import { Delta } from '@/components/motion/delta';
import { ScoreRing } from '@/components/motion/score-ring';
import { Page } from '@/components/shell/page';
import { useShell } from '@/components/shell/providers';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Menu, Modal } from '@/components/ui/overlay';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Select, Skeleton } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { api, revalidate } from '@/lib/client';
import { type LivePrice, useLivePrices } from '@/lib/live-client';
import { fixed, money, pct, price, shortDate, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';

type PortfolioListItem = { id: string; name: string; benchmark: string; cash: number; summary: Summary };
type Summary = { totalValue: number; invested: number; cash: number; costBasis: number; unrealized: number; unrealizedPct: number | null; realized: number; dayChange: number; dayChangePct: number | null; positions: number };
type Holding = { symbol: string; name: string; sector: string | null; industry: string | null; shares: number; avgCost: number; costBasis: number; price: number | null; marketValue: number; dayChange: number; dayChangePct: number | null; unrealized: number; unrealizedPct: number | null; realized: number; weight: number; score: number | null };
type Transaction = { id: string; symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; fees: number; traded_at: string; note: string | null };
type Detail = {
  portfolio: { id: string; name: string; benchmark: string; cash: number };
  holdings: Holding[];
  summary: Summary;
  transactions: Transaction[];
  sectors: Array<{ sector: string; value: number; weight: number }>;
  concentration: { hhi: number; effectiveN: number; top1: number; top5: number };
};
type Risk = {
  stats: null | {
    days: number;
    from: number | null;
    to: number | null;
    annualReturn: number;
    volatility: number;
    sharpe: number | null;
    sortino: number | null;
    beta: number | null;
    correlationToBenchmark: number | null;
    benchmarkVolatility: number | null;
    benchmarkReturn: number | null;
    maxDrawdown: number;
    maxDrawdownFrom: number | null;
    maxDrawdownTo: number | null;
    var95: { historical: number; parametric: number; expectedShortfall: number } | null;
    var99: { historical: number; parametric: number; expectedShortfall: number } | null;
    var95_10d: { historical: number; parametric: number; expectedShortfall: number } | null;
    contributions: Array<{ symbol: string; weight: number; contribution: number; volatility: number; beta: number | null }>;
    correlation: { symbols: string[]; matrix: number[][] };
    riskFree: number;
  };
  excluded: string[];
  benchmark: string;
};
type Performance = { benchmark: string; points: Array<{ t: number; value: number; invested: number; twr: number; benchmark: number }> };

type HoldingSortKey = 'symbol' | 'shares' | 'avgCost' | 'price' | 'marketValue' | 'weight' | 'dayChangePct' | 'unrealized' | 'score';
const HOLDING_SORT_DEFAULT_DIR: Record<HoldingSortKey, 'asc' | 'desc'> = { symbol: 'asc', shares: 'desc', avgCost: 'desc', price: 'desc', marketValue: 'desc', weight: 'desc', dayChangePct: 'desc', unrealized: 'desc', score: 'desc' };

function sortHoldings(holdings: Holding[], sort: { key: HoldingSortKey; dir: 'asc' | 'desc' }) {
  const factor = sort.dir === 'asc' ? 1 : -1;
  return holdings.slice().sort((a, b) => {
    if (sort.key === 'symbol') return factor * a.symbol.localeCompare(b.symbol);
    const av = a[sort.key];
    const bv = b[sort.key];
    if (typeof av !== 'number' && typeof bv !== 'number') return 0;
    if (typeof av !== 'number') return 1;
    if (typeof bv !== 'number') return -1;
    return factor * (av - bv);
  });
}

function TradeForm({ portfolioId, onDone }: { portfolioId: string; onDone: () => void }) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('');
  const [tradePrice, setTradePrice] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fees, setFees] = useState('');
  const [saving, setSaving] = useState(false);
  const { data: quote } = useSWR<Record<string, { price: number | null }>>(symbol ? `/api/quotes?symbols=${symbol}` : null);
  const lastPrice = quote?.[symbol]?.price ?? null;

  const submit = async () => {
    setSaving(true);
    try {
      await api(`/api/portfolios/${portfolioId}/transactions`, {
        body: { symbol, side, quantity: Number(quantity), price: Number(tradePrice || lastPrice || 0), fees: Number(fees || 0), traded_at: date },
      });
      toast.success(`${side === 'buy' ? 'Bought' : 'Sold'} ${quantity} ${symbol}`);
      onDone();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <Segmented
          value={side}
          onChange={setSide}
          options={[
            { value: 'buy', label: 'Buy' },
            { value: 'sell', label: 'Sell' },
          ]}
        />
        {symbol ? (
          <Badge tone="brand" className="text-[12px]">
            {symbol} {lastPrice ? `· $${price(lastPrice)}` : ''}
          </Badge>
        ) : null}
      </div>
      <TickerSearch onPick={setSymbol} placeholder="Ticker (search or type, then Enter)" autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shares">
          <Input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" />
        </Field>
        <Field label="Price per share">
          <Input inputMode="decimal" value={tradePrice} onChange={(event) => setTradePrice(event.target.value)} placeholder={lastPrice ? price(lastPrice) : '0.00'} />
        </Field>
        <Field label="Trade date">
          <Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Fees">
          <Input inputMode="decimal" value={fees} onChange={(event) => setFees(event.target.value)} placeholder="0" />
        </Field>
      </div>
      <Button variant="primary" loading={saving} disabled={!symbol || !Number(quantity)} onClick={() => void submit()}>
        Save trade
      </Button>
    </div>
  );
}

function StatTile({ label, value, sub, hint }: { label: string; value: React.ReactNode; sub?: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-sm border border-line bg-surface-1 p-3" title={hint}>
      <div className="flex items-center gap-1 text-[11.5px] text-muted">
        {label}
        {hint ? <Info className="size-3 text-faint" /> : null}
      </div>
      <div className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-[11.5px]">{sub}</div> : null}
    </div>
  );
}

function RiskPanel({ portfolioId, benchmark, concentration }: { portfolioId: string; benchmark: string; concentration: Detail['concentration'] }) {
  const [days, setDays] = useState('504');
  const { data, isLoading } = useSWR<Risk>(`/api/portfolios/${portfolioId}/risk?days=${days}`);
  const stats = data?.stats;
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          kicker={stats ? `${stats.days} trading days · current weights · vs ${benchmark}` : 'Risk'}
          title="Risk statistics"
          actions={
            <Segmented
              size="xs"
              value={days}
              onChange={setDays}
              options={[
                { value: '252', label: '1Y' },
                { value: '504', label: '2Y' },
                { value: '756', label: '3Y' },
                { value: '1260', label: '5Y' },
              ]}
            />
          }
        />
        <div className="px-4 pb-4">
          {isLoading && !data ? (
            <Skeleton className="h-40" />
          ) : !stats ? (
            <p className="text-[12.5px] text-muted">Risk statistics need at least 30 days of overlapping price history for your holdings.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <StatTile label="Annualized return" value={<Delta value={stats.annualReturn} digits={1} className="text-[17px]" />} sub={<span className="text-muted">{benchmark} {signedPct(stats.benchmarkReturn, 1)}</span>} hint="Compound annual return of today’s weights over the window" />
                <StatTile label="Volatility" value={pct(stats.volatility)} sub={<span className="text-muted">{benchmark} {pct(stats.benchmarkVolatility)}</span>} hint="Annualized standard deviation of daily returns" />
                <StatTile label={`Beta vs ${benchmark}`} value={fixed(stats.beta)} sub={<span className="text-muted">Correlation {fixed(stats.correlationToBenchmark)}</span>} hint="Sensitivity to benchmark moves (1.0 = moves with it)" />
                <StatTile label="Max drawdown" value={<span className="text-loss">{signedPct(stats.maxDrawdown, 1)}</span>} sub={<span className="text-muted">{stats.maxDrawdownFrom ? `${shortDate(stats.maxDrawdownFrom)} → ${shortDate(stats.maxDrawdownTo)}` : ''}</span>} hint="Worst peak-to-trough fall of the current mix" />
                <StatTile label="Sharpe ratio" value={fixed(stats.sharpe)} sub={<span className="text-muted">Risk-free {pct(stats.riskFree, 2)}</span>} hint="(Return − risk-free) ÷ volatility" />
                <StatTile label="Sortino ratio" value={fixed(stats.sortino)} hint="(Return − risk-free) ÷ downside deviation" />
                <StatTile label="VaR 95% · 1 day" value={pct(stats.var95?.historical ?? null, 2)} sub={<span className="text-muted">Parametric {pct(stats.var95?.parametric ?? null, 2)} · CVaR {pct(stats.var95?.expectedShortfall ?? null, 2)}</span>} hint="Loss not exceeded on 95% of days (historical)" />
                <StatTile label="VaR 99% · 1 day" value={pct(stats.var99?.historical ?? null, 2)} sub={<span className="text-muted">10-day 95%: {pct(stats.var95_10d?.historical ?? null, 1)}</span>} hint="Loss not exceeded on 99% of days" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                <StatTile label="Largest position" value={pct(concentration.top1)} hint="Weight of the biggest holding" />
                <StatTile label="Top 5 weight" value={pct(concentration.top5)} />
                <StatTile label="Herfindahl index" value={fixed(concentration.hhi, 3)} hint="Sum of squared weights; 1 = one stock, 1/N = equal weights" />
                <StatTile label="Effective positions" value={fixed(concentration.effectiveN, 1)} hint="1 ÷ HHI: how many equal-weight positions this behaves like" />
              </div>
              {data?.excluded.length ? <p className="mt-2 text-[11px] text-faint">Excluded for lack of price history: {data.excluded.join(', ')}</p> : null}
            </>
          )}
        </div>
      </Panel>
      {stats ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel>
            <PanelHeader kicker="Where the risk comes from" title="Weight vs. risk contribution" />
            <div className="flex flex-col gap-2 px-4 pb-4">
              {stats.contributions
                .slice()
                .sort((a, b) => b.contribution - a.contribution)
                .map((row) => (
                  <div key={row.symbol} className="grid grid-cols-[16px_48px_1fr_100px] items-center gap-2.5">
                    <CompanyLogo symbol={row.symbol} size="xs" />
                    <span className="font-mono text-[11.5px] text-ink">{row.symbol}</span>
                    <div className="flex flex-col gap-1">
                      <div className="h-1.5 rounded-full bg-white/[0.06]">
                        <motion.div className="h-full rounded-full bg-[#5d6470]" initial={{ width: 0 }} animate={{ width: `${Math.min(100, row.weight * 100)}%` }} transition={{ duration: 0.7 }} />
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.06]">
                        <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${Math.min(100, Math.max(0, row.contribution) * 100)}%` }} transition={{ duration: 0.7, delay: 0.1 }} />
                      </div>
                    </div>
                    <span className="num text-right text-[11px] text-muted">
                      {pct(row.weight, 0)} → <span className="text-ink">{pct(row.contribution, 0)}</span>
                    </span>
                  </div>
                ))}
              <div className="mt-1 flex gap-4 text-[10.5px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px] bg-[#5d6470]" /> Portfolio weight
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px] bg-brand" /> Share of portfolio variance
                </span>
              </div>
            </div>
          </Panel>
          <Panel>
            <PanelHeader kicker="Diversification" title="Correlation matrix" />
            <div className="px-4 pb-4">
              <CorrelationGrid symbols={stats.correlation.symbols} matrix={stats.correlation.matrix} />
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

function PerformancePanel({ portfolioId }: { portfolioId: string }) {
  const { data } = useSWR<Performance>(`/api/portfolios/${portfolioId}/performance`);
  const points = data?.points ?? [];
  if (points.length < 3) return null;
  const step = Math.max(1, Math.floor(points.length / 160));
  const sampled = points.filter((_, index) => index % step === 0 || index === points.length - 1);
  const last = points[points.length - 1];
  return (
    <Panel>
      <PanelHeader
        kicker={`Since ${shortDate(points[0].t)} · time-weighted (cash flows removed)`}
        title="Performance vs. benchmark"
        actions={
          <div className="flex items-center gap-3 text-[12px]">
            <span className="text-muted">
              You <Delta value={last.twr / 100 - 1} digits={1} />
            </span>
            <span className="text-muted">
              {data?.benchmark} <Delta value={last.benchmark / 100 - 1} digits={1} />
            </span>
          </div>
        }
      />
      <div className="px-4 pb-4">
        <ScrollReveal>
          <LineChart
            categories={sampled.map((point) => shortDate(point.t))}
            series={[
              { label: 'Portfolio (TWR)', values: sampled.map((point) => point.twr), color: '#cdd4de', emphasis: true },
              { label: data?.benchmark ?? 'Benchmark', values: sampled.map((point) => point.benchmark), color: SERIES_COLORS[0] },
            ]}
            format={(value) => value.toFixed(0)}
            height={230}
          />
        </ScrollReveal>
      </div>
    </Panel>
  );
}

export function PortfolioView() {
  const router = useRouter();
  const params = useSearchParams();
  const { askAssistant, setAssistantContext } = useShell();
  const { data: portfolios, mutate: refreshList, isLoading } = useSWR<PortfolioListItem[]>('/api/portfolios');
  const selectedId = params.get('id') ?? portfolios?.[0]?.id ?? null;
  const { data: savedDetail, mutate: refreshDetail } = useSWR<Detail>(selectedId ? `/api/portfolios/${selectedId}` : null, { refreshInterval: 60_000 });
  const live = useLivePrices(useMemo(() => (savedDetail?.holdings ?? []).map((holding) => holding.symbol), [savedDetail]));
  const detail = useMemo(() => (savedDetail ? withLivePrices(savedDetail, live) : undefined), [savedDetail, live]);
  const [tab, setTab] = useState<'holdings' | 'risk' | 'transactions'>('holdings');
  const [trading, setTrading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({ name: '', benchmark: 'SPY', cash: '' });
  const [holdingSort, setHoldingSort] = useState<{ key: HoldingSortKey; dir: 'asc' | 'desc' }>({ key: 'weight', dir: 'desc' });

  const toggleHoldingSort = (key: HoldingSortKey) => {
    setHoldingSort((current) => (current.key === key ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: HOLDING_SORT_DEFAULT_DIR[key] }));
  };

  useEffect(() => {
    if (detail) setAssistantContext({ type: 'portfolio', id: detail.portfolio.id, name: detail.portfolio.name });
    return () => setAssistantContext({ type: 'general' });
  }, [detail, setAssistantContext]);

  const heatmapItems = useMemo(
    () => (detail?.holdings ?? []).map((holding) => ({ symbol: holding.symbol, name: holding.name, sector: holding.sector, industry: holding.industry, marketCap: holding.marketValue, changePct: holding.dayChangePct, price: holding.price, score: holding.score })),
    [detail],
  );

  const refresh = () => {
    void refreshDetail();
    void refreshList();
    void revalidate('/api/dashboard', `/api/portfolios/${selectedId}`);
  };

  const importModal = (
    <ImportPhotosModal
      open={importing}
      onClose={() => setImporting(false)}
      portfolios={portfolios ?? []}
      defaultPortfolioId={selectedId}
      onImported={(id) => {
        setImporting(false);
        router.replace(`/portfolio?id=${id}`);
        refresh();
      }}
    />
  );

  const savePortfolio = async () => {
    const body = { name: form.name.trim() || 'Portfolio', benchmark: form.benchmark.trim().toUpperCase() || 'SPY', cash: Number(form.cash || 0) };
    if (editing && selectedId) {
      await api(`/api/portfolios/${selectedId}`, { method: 'PATCH', body });
      setEditing(false);
    } else {
      const created = await api<{ id: string }>('/api/portfolios', { body });
      setCreating(false);
      router.replace(`/portfolio?id=${created.id}`);
    }
    refresh();
  };

  if (!isLoading && !portfolios?.length) {
    return (
      <Page kicker="Holdings, P&L and risk" title="Portfolio">
        <Panel>
          <EmptyState
            icon={<Briefcase className="size-4" />}
            title="No portfolio yet"
            body="Create a portfolio, then record trades (or use Trade on any company page). SilverNote rebuilds holdings, cost basis, P&L and risk from the ledger."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create portfolio
                </Button>
                <Button variant="outline" icon={<ImagePlus className="size-3.5" />} onClick={() => setImporting(true)}>
                  Import from photos
                </Button>
              </div>
            }
          />
        </Panel>
        <Modal open={creating} onClose={() => setCreating(false)} title="New portfolio" footer={<Button variant="primary" onClick={() => void savePortfolio()}>Create</Button>}>
          <div className="grid gap-3">
            <Field label="Name">
              <Input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Long-term, IRA, Satellite ideas" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Benchmark ticker">
                <Input value={form.benchmark} onChange={(event) => setForm({ ...form, benchmark: event.target.value })} />
              </Field>
              <Field label="Cash">
                <Input inputMode="decimal" value={form.cash} onChange={(event) => setForm({ ...form, cash: event.target.value })} placeholder="0" />
              </Field>
            </div>
          </div>
        </Modal>
        {importModal}
      </Page>
    );
  }

  const summary = detail?.summary;

  return (
    <Page
      kicker="Holdings, P&L and risk"
      title="Portfolio"
      actions={
        <>
          {portfolios && portfolios.length > 1 ? (
            <Select value={selectedId ?? ''} onChange={(event) => router.replace(`/portfolio?id=${event.target.value}`)} className="w-48">
              {portfolios.map((portfolio) => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            variant="outline"
            icon={<Sparkles className="size-3.5 text-brand" />}
            onClick={() => detail && askAssistant(`Review my portfolio "${detail.portfolio.name}": concentration, factor and sector risks, what is driving risk, and 3 concrete ideas to improve risk-adjusted returns.`, { type: 'portfolio', id: detail.portfolio.id, name: detail.portfolio.name })}
          >
            Review with Grok
          </Button>
          <Menu
            trigger={({ toggle }) => <Button variant="ghost" icon={<MoreHorizontal className="size-4" />} onClick={toggle} aria-label="Portfolio options" />}
            items={[
              {
                label: 'Edit portfolio',
                icon: <Pencil className="size-3.5" />,
                onSelect: () => {
                  setForm({ name: detail?.portfolio.name ?? '', benchmark: detail?.portfolio.benchmark ?? 'SPY', cash: String(detail?.portfolio.cash ?? 0) });
                  setEditing(true);
                },
              },
              {
                label: 'New portfolio',
                icon: <Plus className="size-3.5" />,
                onSelect: () => {
                  setForm({ name: '', benchmark: 'SPY', cash: '' });
                  setCreating(true);
                },
              },
              {
                label: 'Import from photos',
                icon: <ImagePlus className="size-3.5" />,
                onSelect: () => setImporting(true),
              },
              'separator',
              {
                label: 'Delete portfolio',
                icon: <Trash2 className="size-3.5" />,
                danger: true,
                onSelect: async () => {
                  if (!selectedId || !window.confirm(`Delete “${detail?.portfolio.name}” and all its trades?`)) return;
                  await api(`/api/portfolios/${selectedId}`, { method: 'DELETE' });
                  router.replace('/portfolio');
                  refresh();
                },
              },
            ]}
          />
          <Magnetic>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setTrading(true)}>
              Add trade
            </Button>
          </Magnetic>
        </>
      }
    >
      <Panel className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_120%_at_0%_0%,rgba(205,212,222,0.06),transparent_60%)]" />
        <div className="relative grid gap-4 p-5 lg:grid-cols-[auto_1fr]">
          <div>
            <div className="kicker">{detail?.portfolio.name ?? '…'} · benchmark {detail?.portfolio.benchmark}</div>
            <div className="mt-2 text-[48px] leading-none font-semibold tracking-[-0.035em] text-ink">
              <AnimatedNumber value={summary?.totalValue} format={(value) => money(value, { digits: 0 })} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-[13px]">
              <span className="text-muted">Today</span>
              <Delta value={summary?.dayChange} kind="money" digits={0} />
              <Delta value={summary?.dayChangePct} className="text-[12px]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 self-end md:grid-cols-5">
            <StatTile label="Unrealized P&L" value={<Delta value={summary?.unrealized} kind="money" digits={0} className="text-[17px]" />} sub={<Delta value={summary?.unrealizedPct} className="text-[11.5px]" />} />
            <StatTile label="Realized P&L" value={<Delta value={summary?.realized} kind="money" digits={0} className="text-[17px]" />} />
            <StatTile label="Cost basis" value={money(summary?.costBasis, { digits: 0 })} />
            <StatTile label="Cash" value={money(summary?.cash, { digits: 0 })} />
            <StatTile label="Positions" value={summary?.positions ?? '—'} />
          </div>
        </div>
        <div className="relative border-t border-line px-4 py-2">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'holdings', label: 'Holdings & allocation' },
              { value: 'risk', label: 'Risk' },
              { value: 'transactions', label: `Transactions${detail ? ` (${detail.transactions.length})` : ''}` },
            ]}
          />
        </div>
      </Panel>

      {tab === 'holdings' && detail ? (
        <>
          {detail.holdings.length ? (
            <Panel>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-1 text-left text-[11px] text-muted">
                      {(
                        [
                          { key: 'symbol', label: 'Holding', align: 'left' },
                          { key: 'shares', label: 'Shares', align: 'right' },
                          { key: 'avgCost', label: 'Avg cost', align: 'right' },
                          { key: 'price', label: 'Price', align: 'right' },
                          { key: 'marketValue', label: 'Market value', align: 'right' },
                          { key: 'weight', label: 'Weight', align: 'left' },
                          { key: 'dayChangePct', label: 'Day', align: 'right' },
                          { key: 'unrealized', label: 'Unrealized', align: 'right' },
                          { key: 'score', label: 'Score', align: 'right' },
                        ] as const
                      ).map((column) => {
                        const active = holdingSort.key === column.key;
                        return (
                          <th
                            key={column.key}
                            onClick={() => toggleHoldingSort(column.key)}
                            className={cn(
                              'cursor-pointer px-3 py-2 font-medium first:px-4 select-none hover:text-ink-2',
                              column.align === 'right' ? 'text-right' : 'text-left',
                              active && 'text-ink-2',
                            )}
                          >
                            <span className={cn('inline-flex items-center gap-1', column.align === 'right' && 'justify-end')}>
                              {column.label}
                              {active ? holdingSort.dir === 'desc' ? <ArrowDown className="size-3 text-brand" /> : <ArrowUp className="size-3 text-brand" /> : null}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortHoldings(detail.holdings, holdingSort).map((holding, index) => (
                      <motion.tr
                        key={holding.symbol}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(index, 15) * 0.02 }}
                        onClick={() => router.push(`/company/${holding.symbol}`)}
                        className="group cursor-pointer border-b border-line hover:bg-white/[0.025]"
                      >
                        <td className="px-4 py-2">
                          <ViewTransition name={`company-${holding.symbol}`} share="morph" default="none">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <CompanyLogo symbol={holding.symbol} size="sm" />
                              <span className="w-12 shrink-0 font-mono text-[12px] font-semibold text-ink group-hover:text-white">{holding.symbol}</span>
                              <span className="max-w-48 truncate text-[11.5px] text-muted">{holding.name}</span>
                            </div>
                          </ViewTransition>
                        </td>
                        <td className="num px-3 py-2 text-right text-ink-2">{holding.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                        <td className="num px-3 py-2 text-right text-ink-2">{price(holding.avgCost)}</td>
                        <td className="num px-3 py-2 text-right text-ink">{price(holding.price)}</td>
                        <td className="num px-3 py-2 text-right text-ink">{money(holding.marketValue, { digits: 0 })}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 rounded-full bg-white/[0.06]">
                              <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${holding.weight * 100}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
                            </div>
                            <span className="num w-10 text-[11px] text-muted">{pct(holding.weight, 1)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Delta value={holding.dayChangePct} alreadyPercent className="justify-end text-[12px]" />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex flex-col items-end">
                            <Delta value={holding.unrealized} kind="money" digits={0} className="text-[12px]" />
                            <Delta value={holding.unrealizedPct} digits={1} className="text-[10.5px]" />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end">{holding.score !== null ? <ScoreRing score={holding.score} size="xs" /> : <span className="text-faint">—</span>}</div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <Panel>
              <EmptyState
                title="No open positions"
                body="Record a buy, or import holdings from broker screenshots."
                action={
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={() => setTrading(true)}>
                      Add trade
                    </Button>
                    <Button variant="outline" icon={<ImagePlus className="size-3.5" />} onClick={() => setImporting(true)}>
                      Import from photos
                    </Button>
                  </div>
                }
              />
            </Panel>
          )}
          {selectedId && detail.holdings.length ? <PerformancePanel portfolioId={selectedId} /> : null}
          {detail.holdings.length ? (
            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <Panel>
                <PanelHeader kicker="Sized by market value · colored by today" title="Holdings map" />
                <div className="px-4 pb-4">
                  <MarketHeatmap items={heatmapItems} height={320} />
                </div>
              </Panel>
              <Panel>
                <PanelHeader kicker="Allocation" title="Sector exposure" />
                <div className="flex flex-col gap-2 px-4 pb-4">
                  {detail.sectors.map((sector, index) => (
                    <div key={sector.sector} className="grid grid-cols-[140px_1fr_48px] items-center gap-3">
                      <span className="truncate text-[12px] text-ink-2">{sector.sector}</span>
                      <div className="h-2.5 rounded-r-[4px] bg-white/[0.04]">
                        <motion.div
                          className="h-full rounded-r-[4px]"
                          style={{ background: sector.sector === 'Cash' ? '#5d6470' : '#cdd4de', opacity: sector.sector === 'Cash' ? 1 : 0.45 + sector.weight * 0.55 }}
                          initial={{ width: 0 }}
                          animate={{ width: `${sector.weight * 100}%` }}
                          transition={{ duration: 0.8, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <span className="num text-right text-[11.5px] text-ink">{pct(sector.weight, 1)}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'risk' && detail && selectedId ? (
        detail.holdings.length ? (
          <RiskPanel portfolioId={selectedId} benchmark={detail.portfolio.benchmark} concentration={detail.concentration} />
        ) : (
          <Panel>
            <EmptyState title="Nothing to measure yet" body="Add positions to see volatility, beta, drawdowns, VaR and correlations." />
          </Panel>
        )
      ) : null}

      {tab === 'transactions' && detail ? (
        <Panel>
          {detail.transactions.length ? (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-1 text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 text-right font-medium">Shares</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Fees</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {detail.transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-line">
                    <td className="px-4 py-2 text-ink-2">{shortDate(tx.traded_at)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={tx.side === 'buy' ? 'gain' : 'loss'}>{tx.side.toUpperCase()}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/company/${tx.symbol}`} className="flex items-center gap-2 font-mono text-[12px] font-semibold text-ink hover:text-white">
                        <CompanyLogo symbol={tx.symbol} size="xs" />
                        {tx.symbol}
                      </Link>
                    </td>
                    <td className="num px-3 py-2 text-right text-ink-2">{tx.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{price(tx.price)}</td>
                    <td className="num px-3 py-2 text-right text-muted">{tx.fees ? price(tx.fees) : '—'}</td>
                    <td className="num px-3 py-2 text-right text-ink">{money(tx.quantity * tx.price + (tx.side === 'buy' ? tx.fees : -tx.fees), { digits: 2 })}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={async () => {
                          if (!window.confirm('Delete this trade? Holdings and P&L are recalculated.')) return;
                          try {
                            await api(`/api/portfolios/${selectedId}/transactions?id=${tx.id}`, { method: 'DELETE' });
                            refresh();
                          } catch (error) {
                            toast.error((error as Error).message);
                          }
                        }}
                        className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink"
                        aria-label="Delete trade"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No trades yet" action={<Button variant="primary" onClick={() => setTrading(true)}>Add trade</Button>} />
          )}
        </Panel>
      ) : null}

      <Modal open={trading} onClose={() => setTrading(false)} title="Record a trade" description="Average-cost accounting; sells realize P&L against the running average.">
        {selectedId ? (
          <TradeForm
            portfolioId={selectedId}
            onDone={() => {
              setTrading(false);
              refresh();
            }}
          />
        ) : null}
      </Modal>
      <Modal open={creating || editing} onClose={() => { setCreating(false); setEditing(false); }} title={editing ? 'Edit portfolio' : 'New portfolio'} footer={<Button variant="primary" onClick={() => void savePortfolio()}>{editing ? 'Save' : 'Create'}</Button>}>
        <div className="grid gap-3">
          <Field label="Name">
            <Input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Benchmark ticker" hint="Any stock or ETF, e.g. SPY, QQQ, VT">
              <Input value={form.benchmark} onChange={(event) => setForm({ ...form, benchmark: event.target.value })} />
            </Field>
            <Field label="Cash">
              <Input inputMode="decimal" value={form.cash} onChange={(event) => setForm({ ...form, cash: event.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
      {importModal}
    </Page>
  );
}

/** Revalue holdings and the summary with real-time prices (same arithmetic as the server). */
function withLivePrices(detail: Detail, live: Record<string, LivePrice | undefined>): Detail {
  if (!detail.holdings.some((holding) => live[holding.symbol])) return detail;
  const holdings = detail.holdings.map((holding) => {
    const tick = live[holding.symbol];
    if (!tick) return holding;
    const marketValue = tick.price * holding.shares;
    return {
      ...holding,
      price: tick.price,
      marketValue,
      dayChange: tick.change !== null ? tick.change * holding.shares : holding.dayChange,
      dayChangePct: tick.changePct ?? holding.dayChangePct,
      unrealized: marketValue - holding.costBasis,
      unrealizedPct: holding.costBasis > 0 ? (marketValue - holding.costBasis) / holding.costBasis : null,
    };
  });
  const invested = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const total = invested + detail.summary.cash;
  const dayChange = holdings.reduce((sum, holding) => sum + holding.dayChange, 0);
  const costBasis = detail.summary.costBasis;
  return {
    ...detail,
    holdings: holdings.map((holding) => ({ ...holding, weight: total > 0 ? holding.marketValue / total : 0 })),
    summary: {
      ...detail.summary,
      totalValue: total,
      invested,
      unrealized: invested - costBasis,
      unrealizedPct: costBasis > 0 ? (invested - costBasis) / costBasis : null,
      dayChange,
      dayChangePct: total - dayChange > 0 ? dayChange / (total - dayChange) : null,
    },
  };
}

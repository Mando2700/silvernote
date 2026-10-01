'use client';

import { ArrowDown, ArrowUp, Briefcase, ImagePlus, MoreHorizontal, Pencil, Plus, Share2, Sparkles, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, ViewTransition } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { CorrelationGrid } from '@/components/charts/correlation-grid';
import { MarketHeatmap } from '@/components/charts/market-heatmap';
import { PerformanceChart } from '@/components/portfolio/performance-chart';
import { RollingNumber } from '@/components/motion/rolling-number';
import { BondsPanel } from '@/components/portfolio/bonds';
import { ImportPhotosModal } from '@/components/portfolio/import-photos';
import { ShareStudio } from '@/components/portfolio/share/share-studio';
import { TaxPanel } from '@/components/portfolio/tax';
import { Delta } from '@/components/motion/delta';
import { ScoreRing } from '@/components/motion/score-ring';
import { Page } from '@/components/shell/page';
import { AnalyticsPanel } from '@/components/portfolio/analytics';
import { RebalancePanel } from '@/components/portfolio/rebalance';
import { PolishTaxPanel } from '@/components/portfolio/tax-pl';
import { useShell } from '@/components/shell/providers';
import { useBaseCurrency } from '@/lib/fx-client';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Menu, Modal } from '@/components/ui/overlay';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Select, Skeleton } from '@/components/ui/primitives';
import { StatTile } from '@/components/ui/stat-tile';
import { TickerSearch } from '@/components/ui/ticker-search';
import { localToday } from '@/lib/dates';
import { api, revalidate } from '@/lib/client';
import { useLivePrices } from '@/lib/live-client';
import { fixed, money, pct, price, shortDate, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSearchParams } from '@/components/shell/keep-alive';
import { withLivePrices } from '@/lib/portfolio-live';

type PortfolioListItem = { id: string; name: string; benchmark: string; cash: number; summary: Summary };
type Summary = { totalValue: number; invested: number; fixedIncome: number; bonds: number; cash: number; costBasis: number; unrealized: number; unrealizedPct: number | null; realized: number; dayChange: number; dayChangePct: number | null; extended?: { session: 'pre' | 'post'; change: number; changePct: number | null } | null; positions: number; unpriced?: string[]; pricesAsOf?: number | null };
type Holding = { symbol: string; name: string; sector: string | null; industry: string | null; shares: number; avgCost: number; costBasis: number; price: number | null; marketValue: number; dayChange: number; dayChangePct: number | null; extendedPrice?: number | null; extendedChange?: number; extendedChangePct?: number | null; unrealized: number; unrealizedPct: number | null; realized: number; weight: number; score: number | null; priced?: boolean; priceAsOf?: number | null };
type Transaction = { id: string; symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; fees: number; traded_at: string; note: string | null; split_factor?: number; kind?: 'trade' | 'opening' | 'removal' };
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
  backfilled: string[];
  benchmark: string;
};
/** "10-for-1" for a factor of 10, "1-for-10" for a reverse split. */
function splitLabel(factor: number) {
  const round = (value: number) => Number(value.toFixed(3)).toString();
  return factor >= 1 ? `${round(factor)}-for-1` : `1-for-${round(1 / factor)}`;
}

type HoldingSortKey = 'symbol' | 'shares' | 'avgCost' | 'price' | 'priceChange' | 'priceChangePct' | 'marketValue' | 'weight' | 'dayChange' | 'unrealized' | 'unrealizedPct' | 'score';
const HOLDING_SORT_DEFAULT_DIR: Record<HoldingSortKey, 'asc' | 'desc'> = { symbol: 'asc', shares: 'desc', avgCost: 'desc', price: 'desc', priceChange: 'desc', priceChangePct: 'desc', marketValue: 'desc', weight: 'desc', dayChange: 'desc', unrealized: 'desc', unrealizedPct: 'desc', score: 'desc' };

const SESSION_LABEL = { pre: 'Pre-market', post: 'After hours' } as const;

const HOLDING_COLUMNS: Record<HoldingSortKey, { label: string; align: 'left' | 'right' }> = {
  symbol: { label: 'Holding', align: 'left' },
  shares: { label: 'Shares', align: 'right' },
  avgCost: { label: 'Avg cost', align: 'right' },
  price: { label: 'Price', align: 'right' },
  priceChange: { label: 'Change ($)', align: 'right' },
  priceChangePct: { label: 'Change (%)', align: 'right' },
  marketValue: { label: 'Market value', align: 'right' },
  weight: { label: 'Weight', align: 'left' },
  dayChange: { label: 'Day P&L', align: 'right' },
  unrealized: { label: 'Total P&L ($)', align: 'right' },
  unrealizedPct: { label: 'Total P&L (%)', align: 'right' },
  score: { label: 'Score', align: 'right' },
};
const DEFAULT_COLUMN_ORDER = Object.keys(HOLDING_COLUMNS) as HoldingSortKey[];
const COLUMN_ORDER_KEY = 'portfolio:holding-columns';

function HoldingCell({ column, holding, extendedSession, showExtended }: { column: HoldingSortKey; holding: Holding; extendedSession: 'pre' | 'post' | null; showExtended: boolean }) {
  switch (column) {
    case 'symbol':
      return (
        <td className="px-4 py-2">
          <ViewTransition name={`company-${holding.symbol}`} share="morph" default="none">
            <div className="flex min-w-0 items-center gap-2.5">
              <CompanyLogo symbol={holding.symbol} size="sm" />
              <span className="w-12 shrink-0 font-mono text-[12px] font-semibold text-ink group-hover:text-white">{holding.symbol}</span>
              <span className="max-w-48 truncate text-[11.5px] text-muted">{holding.name}</span>
            </div>
          </ViewTransition>
        </td>
      );
    case 'shares':
      return <td className="num px-3 py-2 text-right text-ink-2">{holding.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>;
    case 'avgCost':
      return <td className="num px-3 py-2 text-right text-ink-2">{price(holding.avgCost)}</td>;
    case 'price':
      return (
        <td className="num px-3 py-2 text-right text-ink" title={holding.priceAsOf ? `Quote as of ${new Date(holding.priceAsOf).toLocaleString()}` : 'No price available: valued at cost'}>
          {holding.priced === false ? <span className="text-warning">—</span> : <span>{price(holding.price)}</span>}
        </td>
      );
    case 'priceChange': {
      const extended = showExtended && holding.extendedPrice != null;
      return (
        <td className="num px-3 py-2 text-right">
          {holding.priced === false || (showExtended && !extended) ? (
            <span className="text-faint">—</span>
          ) : extended ? (
            <span title={`${extendedSession ? SESSION_LABEL[extendedSession] : ''} ${price(holding.extendedPrice)}`}>
              <Delta value={holding.price !== null ? holding.extendedPrice! - holding.price : null} kind="money" digits={2} className="text-[12px]" />
            </span>
          ) : (
            <Delta value={holding.shares > 0 ? holding.dayChange / holding.shares : null} kind="money" digits={2} className="text-[12px]" />
          )}
        </td>
      );
    }
    case 'priceChangePct': {
      const extended = showExtended && holding.extendedPrice != null;
      return (
        <td className="num px-3 py-2 text-right">
          {holding.priced === false || (showExtended && !extended) ? (
            <span className="text-faint">—</span>
          ) : extended ? (
            <span title={`${extendedSession ? SESSION_LABEL[extendedSession] : ''} ${price(holding.extendedPrice)}`}>
              <Delta value={holding.extendedChangePct} alreadyPercent className="text-[12px]" />
            </span>
          ) : (
            <Delta value={holding.dayChangePct} alreadyPercent className="text-[12px]" />
          )}
        </td>
      );
    }
    case 'marketValue':
      return <td className="num px-3 py-2 text-right text-ink">{money(holding.marketValue, { digits: 0 })}</td>;
    case 'weight':
      return (
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-10 rounded-full bg-white/[0.06]">
              <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${holding.weight * 100}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
            </div>
            <span className="num text-[11px] text-muted">{pct(holding.weight, 1)}</span>
          </div>
        </td>
      );
    case 'dayChange': {
      const extended = showExtended && holding.extendedPrice != null;
      return (
        <td className="px-3 py-2 text-right">
          <div className="flex flex-col items-end">
            <Delta value={holding.priced === false || (showExtended && !extended) ? null : extended ? holding.extendedChange : holding.dayChange} kind="money" digits={0} className="text-[12px]" />
            <Delta value={showExtended ? (extended ? holding.extendedChangePct : null) : holding.dayChangePct} alreadyPercent className="text-[10.5px]" />
          </div>
        </td>
      );
    }
    case 'unrealized':
      return (
        <td className="num px-3 py-2 text-right">
          <Delta value={holding.unrealized} kind="money" digits={0} className="text-[12px]" />
        </td>
      );
    case 'unrealizedPct':
      return (
        <td className="num px-3 py-2 text-right">
          <Delta value={holding.unrealizedPct} digits={1} className="text-[12px]" />
        </td>
      );
    case 'score':
      return (
        <td className="px-3 py-2">
          <div className="flex justify-end">{holding.score !== null ? <ScoreRing score={holding.score} size="xs" /> : <span className="text-faint">—</span>}</div>
        </td>
      );
  }
}

function sortHoldings(holdings: Holding[], sort: { key: HoldingSortKey | 'extendedChange' | 'extendedPriceChange' | 'extendedChangePct'; dir: 'asc' | 'desc' }) {
  const factor = sort.dir === 'asc' ? 1 : -1;
  return holdings.slice().sort((a, b) => {
    if (sort.key === 'symbol') return factor * a.symbol.localeCompare(b.symbol);
    if (sort.key === 'priceChange') return factor * ((a.shares > 0 ? a.dayChange / a.shares : 0) - (b.shares > 0 ? b.dayChange / b.shares : 0));
    if (sort.key === 'extendedPriceChange') return factor * ((a.price !== null && a.extendedPrice != null ? a.extendedPrice - a.price : 0) - (b.price !== null && b.extendedPrice != null ? b.extendedPrice - b.price : 0));
    if (sort.key === 'extendedChangePct') return factor * ((a.extendedChangePct ?? 0) - (b.extendedChangePct ?? 0));
    if (sort.key === 'priceChangePct') return factor * ((a.dayChangePct ?? 0) - (b.dayChangePct ?? 0));
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
  const [date, setDate] = useState(() => localToday());
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
          <Input type="date" value={date} max={localToday()} onChange={(event) => setDate(event.target.value)} />
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

function RiskPanel({ portfolioId, benchmark, concentration }: { portfolioId: string; benchmark: string; concentration: Detail['concentration'] }) {
  const [days, setDays] = useState('actual');
  const { data, isLoading } = useSWR<Risk>(`/api/portfolios/${portfolioId}/risk?days=${days}`);
  const stats = data?.stats;
  const actual = days === 'actual';
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          kicker={
            stats
              ? actual
                ? `Your account since ${shortDate(stats.from)} · ${stats.days} trading days · vs ${benchmark}`
                : `Today's holdings back-tested · ${stats.days} trading days · vs ${benchmark}`
              : 'Risk'
          }
          title="Risk statistics"
          actions={
            <Segmented
              size="xs"
              value={days}
              onChange={setDays}
              options={[
                { value: 'actual', label: 'Actual' },
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
                <StatTile label={`Beta vs ${benchmark}`} value={fixed(stats.beta)} sub={<span className="text-muted">Correlation {fixed(stats.correlationToBenchmark)}</span>} hint="Sensitivity to benchmark moves. 1.0 = moves with it, >1 amplifies its swings, <1 dampens them, negative = tends to move opposite" />
                <StatTile label="Max drawdown" value={<span className="text-loss">{signedPct(stats.maxDrawdown, 1)}</span>} sub={<span className="text-muted">{stats.maxDrawdownFrom ? `${shortDate(stats.maxDrawdownFrom)} → ${shortDate(stats.maxDrawdownTo)}` : ''}</span>} hint="Worst peak-to-trough fall of the current mix. Smaller (closer to 0%) is better; -20% or worse is a rough line for painful" />
                <StatTile label="Sharpe ratio" value={fixed(stats.sharpe)} sub={<span className="text-muted">Risk-free {pct(stats.riskFree, 2)}</span>} hint="(Return − risk-free) ÷ volatility. Rule of thumb: <0 losing to risk-free, 0–1 subpar, 1–2 good, 2–3 very good, >3 excellent" />
                <StatTile label="Sortino ratio" value={fixed(stats.sortino)} hint="(Return − risk-free) ÷ downside deviation. Same rough scale as Sharpe, but only penalizes downside moves — usually higher than Sharpe for the same portfolio" />
                <StatTile label="VaR 95% · 1 day" value={pct(stats.var95?.historical ?? null, 2)} sub={<span className="text-muted">Parametric {pct(stats.var95?.parametric ?? null, 2)} · CVaR {pct(stats.var95?.expectedShortfall ?? null, 2)}</span>} hint="Loss not exceeded on 95% of days (historical)" />
                <StatTile label="VaR 99% · 1 day" value={pct(stats.var99?.historical ?? null, 2)} sub={<span className="text-muted">10-day 95%: {pct(stats.var95_10d?.historical ?? null, 1)}</span>} hint="Loss not exceeded on 99% of days" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                <StatTile label="Largest position" value={pct(concentration.top1)} hint="Weight of the biggest holding" />
                <StatTile label="Top 5 weight" value={pct(concentration.top5)} />
                <StatTile label="Herfindahl index" value={fixed(concentration.hhi, 3)} hint="Sum of squared weights, from 1/N (equal-weighted, most diversified) to 1 (all one stock). Below 0.15 is broadly diversified, above 0.25 is concentrated" />
                <StatTile label="Effective positions" value={fixed(concentration.effectiveN, 1)} hint="1 ÷ HHI: how many equal-weight positions this behaves like. Close to your actual position count means weights are even; much lower means a few holdings dominate" />
              </div>
              {actual ? (
                <p className="mt-2 text-[11px] text-faint">
                  Time-weighted daily returns of this account, including past trades and cash. {stats.days < 252 ? 'Under a year of history, so ratios and VaR are rough estimates. ' : ''}
                  Risk contribution and correlations below use today&apos;s holdings over 2 years.
                </p>
              ) : null}
              {data?.backfilled.length ? (
                <p className="mt-2 text-[11px] text-faint">
                  {data.backfilled.join(', ')} listed after the window starts; days before listing are modelled from {benchmark} via beta (no excess return assumed).
                </p>
              ) : null}
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

export function PortfolioView() {
  const router = useRouter();
  const params = useSearchParams();
  const { askAssistant, setAssistantContext, prefs } = useShell();
  const base = useBaseCurrency();
  const { data: portfolios, mutate: refreshList, isLoading } = useSWR<PortfolioListItem[]>('/api/portfolios');
  const selectedId = params.get('id') ?? portfolios?.[0]?.id ?? null;
  const { data: savedDetail, mutate: refreshDetail } = useSWR<Detail>(selectedId ? `/api/portfolios/${selectedId}` : null, { refreshInterval: 60_000 });
  const live = useLivePrices(useMemo(() => (savedDetail?.holdings ?? []).map((holding) => holding.symbol), [savedDetail]));
  const detail = useMemo(() => (savedDetail ? withLivePrices(savedDetail, live) : undefined), [savedDetail, live]);
  /** Outside regular hours: whether day changes show extended trading or the last regular session. */
  const [changeView, setChangeView] = useState<'extended' | 'regular'>('extended');
  const [tab, setTab] = useState<'holdings' | 'risk' | 'analytics' | 'rebalance' | 'bonds' | 'tax' | 'transactions'>(() => {
    const requested = params.get('tab');
    return requested === 'risk' || requested === 'analytics' || requested === 'rebalance' || requested === 'bonds' || requested === 'tax' || requested === 'transactions' ? requested : 'holdings';
  });
  const [trading, setTrading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  // The studio mounts on first use and then stays, so it closes with its exit animation and remembers nothing it should not.
  const [sharing, setSharing] = useState<'closed' | 'open' | 'dismissed'>('closed');
  const [form, setForm] = useState({ name: '', benchmark: 'SPY', cash: '' });
  // The table only renders once data has loaded on the client, so reading storage here cannot mismatch the server render.
  const [columnOrder, setColumnOrder] = useState<HoldingSortKey[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COLUMN_ORDER_KEY) ?? 'null') as HoldingSortKey[] | null;
      // Only a complete, known set: new or renamed columns fall back to the default order.
      if (saved && saved.length === DEFAULT_COLUMN_ORDER.length && DEFAULT_COLUMN_ORDER.every((key) => saved.includes(key))) return saved;
    } catch {}
    return DEFAULT_COLUMN_ORDER;
  });
  const [draggedColumn, setDraggedColumn] = useState<HoldingSortKey | null>(null);
  const moveColumn = (from: HoldingSortKey, to: HoldingSortKey) =>
    setColumnOrder((current) => {
      const next = current.filter((key) => key !== from);
      next.splice(current.indexOf(to), 0, from);
      try {
        window.localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
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
  const extendedSession = summary?.extended?.session ?? null;
  const showExtended = extendedSession !== null && changeView === 'extended';
  // With extended hours on, the headline value includes the pre-market / after-hours move.
  const displayTotal = summary ? summary.totalValue + (showExtended ? (summary.extended?.change ?? 0) : 0) : undefined;

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
          <Button variant="outline" icon={<Share2 className="size-3.5" />} disabled={!detail} onClick={() => setSharing('open')}>
            Share
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
              <RollingNumber value={displayTotal} format={(value) => money(value, { digits: 0 })} />
            </div>
            {base.rate && summary ? <div className="num mt-1 text-[13px] text-muted">≈ {base.format(displayTotal ?? summary.totalValue)}</div> : null}
            <div className="mt-2 flex items-center gap-2 text-[13px]">
              <span className="text-muted">{showExtended && extendedSession ? SESSION_LABEL[extendedSession] : 'Today'}</span>
              <Delta value={showExtended ? summary?.extended?.change : summary?.dayChange} kind="money" digits={0} />
              <Delta value={showExtended ? summary?.extended?.changePct : summary?.dayChangePct} className="text-[12px]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 self-end md:grid-cols-6">
            <StatTile label="Unrealized P&L" value={<Delta value={summary?.unrealized} kind="money" digits={0} className="text-[17px]" />} sub={<Delta value={summary?.unrealizedPct} className="text-[11.5px]" />} />
            <StatTile label="Realized P&L" value={<Delta value={summary?.realized} kind="money" digits={0} className="text-[17px]" />} />
            <StatTile label="Cost basis" value={money(summary?.costBasis, { digits: 0 })} />
            <StatTile label="Bonds" value={money(summary?.fixedIncome, { digits: 0 })} sub={summary?.bonds ? <span className="text-muted">{summary.bonds} held</span> : undefined} />
            <StatTile label="Cash" value={money(summary?.cash, { digits: 0 })} />
            <StatTile label="Positions" value={summary?.positions ?? '—'} />
          </div>
        </div>
        {summary?.unpriced?.length ? (
          <div className="relative mx-5 mb-4 rounded-sm border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-ink-2">
            No current price for {summary.unpriced.join(', ')}. {summary.unpriced.length === 1 ? 'It is' : 'They are'} valued at cost, so the total and P&amp;L above leave out {summary.unpriced.length === 1 ? 'its' : 'their'} gains and losses.
          </div>
        ) : null}
        <div className="relative flex items-center justify-between gap-3 border-t border-line px-4 py-2">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'holdings', label: 'Holdings & allocation' },
              { value: 'risk', label: 'Risk' },
              { value: 'analytics', label: 'Factors & attribution' },
              { value: 'rebalance', label: 'Rebalance' },
              { value: 'bonds', label: 'Bonds' },
              { value: 'tax', label: 'Tax' },
              { value: 'transactions', label: `Transactions${detail ? ` (${detail.transactions.length})` : ''}` },
            ]}
          />
          {extendedSession ? (
            <Segmented
              size="xs"
             
              value={changeView}
              onChange={setChangeView}
              options={[
                { value: 'regular', label: 'Day' },
                { value: 'extended', label: SESSION_LABEL[extendedSession] },
              ]}
            />
          ) : null}
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
                      {columnOrder.map((key) => {
                        const column = HOLDING_COLUMNS[key];
                        const active = holdingSort.key === key;
                        return (
                          <th
                            key={key}
                            draggable
                            onDragStart={(event) => {
                              setDraggedColumn(key);
                              event.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(event) => {
                              if (!draggedColumn || draggedColumn === key) return;
                              event.preventDefault();
                              moveColumn(draggedColumn, key);
                            }}
                            onDragEnd={() => setDraggedColumn(null)}
                            onClick={() => toggleHoldingSort(key)}
                            title="Click to sort, drag to reorder"
                            className={cn(
                              'cursor-grab px-3 py-2 font-medium whitespace-nowrap first:px-4 select-none hover:text-ink-2 active:cursor-grabbing',
                              column.align === 'right' ? 'text-right' : 'text-left',
                              key === 'dayChange' && 'w-24',
                              active && 'text-ink-2',
                              draggedColumn === key && 'opacity-40',
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
                    {sortHoldings(detail.holdings, showExtended && holdingSort.key === 'dayChange' ? { ...holdingSort, key: 'extendedChange' } : showExtended && holdingSort.key === 'priceChange' ? { ...holdingSort, key: 'extendedPriceChange' } : showExtended && holdingSort.key === 'priceChangePct' ? { ...holdingSort, key: 'extendedChangePct' } : holdingSort).map((holding, index) => (
                      <motion.tr
                        key={holding.symbol}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(index, 15) * 0.02 }}
                        onClick={() => router.push(`/company/${holding.symbol}`)}
                        data-nav-row
                        tabIndex={-1}
                        className="group cursor-pointer border-b border-line outline-none hover:bg-white/[0.025] focus:bg-white/[0.05]"
                      >
                        {columnOrder.map((key) => (
                          <HoldingCell key={key} column={key} holding={holding} extendedSession={extendedSession} showExtended={showExtended} />
                        ))}
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
          {selectedId && detail.holdings.length ? <PerformanceChart portfolioId={selectedId} live={displayTotal} /> : null}
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

      {tab === 'bonds' && selectedId ? <BondsPanel portfolioId={selectedId} onChanged={refresh} /> : null}

      {tab === 'analytics' && selectedId ? <AnalyticsPanel portfolioId={selectedId} /> : null}

      {tab === 'rebalance' && selectedId && detail ? <RebalancePanel key={selectedId} portfolioId={selectedId} holdings={detail.holdings} /> : null}

      {tab === 'tax' && selectedId ? (
        prefs.taxJurisdiction === 'PL' ? <PolishTaxPanel portfolioId={selectedId} /> : <TaxPanel portfolioId={selectedId} onPortfolioChanged={refresh} />
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
                    <td className="num px-3 py-2 text-right text-ink-2">
                      {tx.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                      {tx.split_factor && tx.split_factor !== 1 ? (
                        <div className="text-[10.5px] text-faint" title="Restated in today's shares for stock splits since the trade">
                          {(tx.quantity / tx.split_factor).toLocaleString('en-US', { maximumFractionDigits: 4 })} before {splitLabel(tx.split_factor)} split
                        </div>
                      ) : null}
                      {tx.kind === 'opening' ? <div className="text-[10.5px] text-faint">Opening balance</div> : null}
                      {tx.kind === 'removal' ? <div className="text-[10.5px] text-faint">Balancing removal</div> : null}
                    </td>
                    <td className="num px-3 py-2 text-right text-ink-2">{price(tx.price)}</td>
                    <td className="num px-3 py-2 text-right text-muted">{tx.fees ? price(tx.fees) : '—'}</td>
                    <td className="num px-3 py-2 text-right text-ink">{money(tx.quantity * tx.price + (tx.side === 'buy' ? tx.fees : -tx.fees), { digits: 2 })}</td>
                    <td className="px-3 py-2 text-right">
                      {tx.id.startsWith('balance:') ? null : (
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
                      )}
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

      <Modal open={trading} onClose={() => setTrading(false)} title="Record a trade" description="Holdings show average cost; the Tax tab tracks every lot (FIFO, LIFO or HIFO) with wash sales.">
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
      {detail && sharing !== 'closed' ? <ShareStudio open={sharing === 'open'} onClose={() => setSharing('dismissed')} detail={detail} /> : null}
    </Page>
  );
}

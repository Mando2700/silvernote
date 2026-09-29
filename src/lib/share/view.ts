import { money as formatMoney } from '@/lib/format';
import { normalizeShareOptions, rangeLabel, SCALED_BASE, type ShareAmounts, type ShareOptions, type ShareRange } from '@/lib/share/options';

/**
 * Turns a portfolio into what a viewer is allowed to see. Everything that should stay private is removed
 * here, once, so the image export, the public page and stored snapshots can never disagree: a value that
 * is not in the view cannot leak from any of them.
 */

export type ShareSourceHolding = {
  symbol: string;
  name: string;
  sector: string | null;
  shares: number;
  costBasis: number;
  marketValue: number;
  dayChange: number;
  /** In percent (1.2 = +1.2%), as the portfolio API reports it. */
  dayChangePct: number | null;
  unrealized: number;
  unrealizedPct: number | null;
};

export type ShareSource = {
  name: string;
  benchmark: string;
  cash: number;
  fixedIncome: number;
  holdings: ShareSourceHolding[];
  /** Time-weighted index of the portfolio and the benchmark, both 100 on the first day. */
  performance: Array<{ t: number; twr: number; benchmark: number; nasdaq?: number; value?: number }> | null;
  /** Milliseconds since epoch. */
  asOf: number;
};

export type ShareSliceKind = 'holding' | 'other' | 'sector' | 'bonds' | 'cash';

export type ShareSlice = { label: string; weight: number; kind: ShareSliceKind };

export type ShareHoldingRow = {
  /** Null for the "Other" row. */
  symbol: string | null;
  name: string;
  kind: 'holding' | 'other';
  weight: number;
  value: number | null;
  shares: number | null;
  /** Fractions (0.012 = +1.2%). */
  dayChangePct: number | null;
  returnPct: number | null;
  gain: number | null;
};

export type SharePerformance = {
  range: ShareRange;
  benchmark: string;
  /** Both series indexed to 100 at the start of the range. */
  points: Array<{ t: number; portfolio: number; benchmark: number; nasdaq?: number }>;
  portfolioReturn: number;
  benchmarkReturn: number;
  /** The Nasdaq 100 over the same range, when the share includes it. */
  nasdaqReturn?: number;
};

export type ShareView = {
  title: string;
  owner: string | null;
  benchmark: string;
  asOf: number;
  amounts: ShareAmounts;
  totals: {
    value: number | null;
    dayChange: number | null;
    dayChangePct: number | null;
    gain: number | null;
    gainPct: number | null;
    /** Null when cash is left out or there is none. */
    cashWeight: number | null;
    positions: number | null;
  };
  allocation: ShareSlice[];
  holdings: ShareHoldingRow[];
  sectors: Array<{ sector: string; weight: number }>;
  performance: SharePerformance | null;
  sections: ShareOptions['sections'];
  returns: boolean;
  shares: boolean;
};

const DAY = 86_400;
const RANGE_DAYS: Record<Exclude<ShareRange, 'YTD' | 'ALL'>, number> = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 };
const MAX_POINTS = 260;

function detailLimit(detail: ShareOptions['detail']) {
  return detail === 'top5' ? 5 : detail === 'top10' ? 10 : Infinity;
}

function cutoff(range: ShareRange, last: number) {
  if (range === 'ALL') return -Infinity;
  if (range === 'YTD') return Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000;
  return last - RANGE_DAYS[range] * DAY;
}

function buildPerformance(source: ShareSource, range: ShareRange, withNasdaq: boolean): SharePerformance | null {
  // Like the portfolio page, the series starts on the first day the portfolio holds anything.
  const held = source.performance ? source.performance.findIndex((point) => point.value === undefined || point.value > 0) : -1;
  if (!source.performance || held < 0) return null;
  const all = source.performance.slice(held);
  if (all.length < 2) return null;
  const latest = all[all.length - 1].t;
  // A range longer than the history is the whole history, and says so.
  const wanted = cutoff(range, latest);
  const shown: ShareRange = range !== 'ALL' && wanted < all[0].t - 3 * DAY ? 'ALL' : range;
  const from = shown === 'ALL' ? -Infinity : wanted;
  // Start from the last point before the window so the range's first day already has a return.
  let start = all.findIndex((point) => point.t >= from);
  if (start < 0) return null;
  if (start > 0) start -= 1;
  const window = all.slice(start);
  if (window.length < 2) return null;
  const base = window[0];
  if (!(base.twr > 0) || !(base.benchmark > 0)) return null;
  const step = Math.max(1, Math.ceil(window.length / MAX_POINTS));
  const sampled = window.filter((_, index) => index % step === 0 || index === window.length - 1);
  const nasdaqBase = withNasdaq && base.nasdaq && base.nasdaq > 0 ? base.nasdaq : null;
  const points = sampled.map((point) => ({
    t: point.t,
    portfolio: (point.twr / base.twr) * 100,
    benchmark: (point.benchmark / base.benchmark) * 100,
    ...(nasdaqBase ? { nasdaq: ((point.nasdaq ?? nasdaqBase) / nasdaqBase) * 100 } : {}),
  }));
  const last = points[points.length - 1];
  return { range: shown, benchmark: source.benchmark, points, portfolioReturn: last.portfolio / 100 - 1, benchmarkReturn: last.benchmark / 100 - 1, ...(last.nasdaq !== undefined ? { nasdaqReturn: last.nasdaq / 100 - 1 } : {}) };
}

export function buildShareView(source: ShareSource, rawOptions: ShareOptions, title?: string | null): ShareView {
  const options = normalizeShareOptions(rawOptions);
  const holdings = source.holdings.filter((holding) => holding.shares > 1e-9).sort((a, b) => b.marketValue - a.marketValue);
  const invested = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const cash = options.cash ? source.cash : 0;
  const base = invested + source.fixedIncome + cash;
  const weightOf = (value: number) => (base > 0 ? value / base : 0);

  // Dollar figures: real, scaled to a model portfolio, or absent.
  const factor = options.amounts === 'exact' ? 1 : options.amounts === 'scaled' && base > 0 ? SCALED_BASE / base : null;
  const money = (value: number) => (factor === null ? null : value * factor);
  const gainsOnly = <T>(value: T): T | null => (options.returns ? value : null);

  const dayChange = holdings.reduce((sum, holding) => sum + holding.dayChange, 0);
  const costBasis = holdings.reduce((sum, holding) => sum + holding.costBasis, 0);
  const unrealized = invested - costBasis;
  const previousBase = base - dayChange;

  const limit = detailLimit(options.detail);
  const shown = options.detail === 'sectors' ? [] : holdings.slice(0, limit);
  const rest = options.detail === 'sectors' ? [] : holdings.slice(limit);

  const rows: ShareHoldingRow[] = shown.map((holding) => ({
    symbol: holding.symbol,
    name: holding.name,
    kind: 'holding',
    weight: weightOf(holding.marketValue),
    value: money(holding.marketValue),
    shares: options.shares ? holding.shares : null,
    dayChangePct: gainsOnly(holding.dayChangePct === null ? null : holding.dayChangePct / 100),
    returnPct: gainsOnly(holding.unrealizedPct),
    gain: options.returns ? money(holding.unrealized) : null,
  }));
  if (rest.length) {
    const restValue = rest.reduce((sum, holding) => sum + holding.marketValue, 0);
    const restCost = rest.reduce((sum, holding) => sum + holding.costBasis, 0);
    const restDay = rest.reduce((sum, holding) => sum + holding.dayChange, 0);
    rows.push({
      symbol: null,
      name: `${rest.length} other holding${rest.length === 1 ? '' : 's'}`,
      kind: 'other',
      weight: weightOf(restValue),
      value: money(restValue),
      shares: null,
      dayChangePct: gainsOnly(restValue - restDay > 0 ? restDay / (restValue - restDay) : null),
      returnPct: gainsOnly(restCost > 0 ? (restValue - restCost) / restCost : null),
      gain: options.returns ? money(restValue - restCost) : null,
    });
  }

  // Sectors always include the parts of the portfolio that are not equities, so they add up to the mix.
  const sectorMap = new Map<string, number>();
  for (const holding of holdings) sectorMap.set(holding.sector ?? 'Other', (sectorMap.get(holding.sector ?? 'Other') ?? 0) + holding.marketValue);
  if (source.fixedIncome > 0) sectorMap.set('Bonds', source.fixedIncome);
  if (cash > 0) sectorMap.set('Cash', cash);
  const sectors = [...sectorMap.entries()].map(([sector, value]) => ({ sector, weight: weightOf(value) })).sort((a, b) => b.weight - a.weight);

  const allocation: ShareSlice[] =
    options.detail === 'sectors'
      ? sectors.map((row) => ({ label: row.sector, weight: row.weight, kind: row.sector === 'Cash' ? 'cash' : row.sector === 'Bonds' ? 'bonds' : 'sector' }))
      : [
          ...rows.map((row): ShareSlice => ({ label: row.symbol ?? row.name, weight: row.weight, kind: row.kind })),
          ...(source.fixedIncome > 0 ? [{ label: 'Bonds', weight: weightOf(source.fixedIncome), kind: 'bonds' as const }] : []),
          ...(cash > 0 ? [{ label: 'Cash', weight: weightOf(cash), kind: 'cash' as const }] : []),
        ];

  return {
    title: title?.trim() || source.name,
    owner: options.owner,
    benchmark: source.benchmark,
    asOf: source.asOf,
    amounts: options.amounts,
    totals: {
      value: money(base),
      dayChange: options.returns ? money(dayChange) : null,
      dayChangePct: gainsOnly(previousBase > 0 ? dayChange / previousBase : null),
      gain: options.returns ? money(unrealized) : null,
      gainPct: gainsOnly(costBasis > 0 ? unrealized / costBasis : null),
      cashWeight: cash > 0 ? weightOf(cash) : null,
      positions: options.detail === 'all' ? holdings.length : null,
    },
    allocation,
    holdings: rows,
    sectors,
    performance: options.returns && options.sections.performance ? buildPerformance(source, options.range, options.nasdaq) : null,
    sections: options.sections,
    returns: options.returns,
    shares: options.shares,
  };
}

/** A weight as a percentage, with a floor so a sliver never reads as "0.0%". */
export function weightLabel(weight: number, digits = 1) {
  if (weight > 0 && weight < 0.5 * 10 ** -(digits + 2)) return `<${(10 ** -digits).toFixed(digits)}%`;
  return `${(weight * 100).toFixed(digits)}%`;
}

/** The largest slices, with the remainder folded into one so a chart stays readable. */
export function groupSlices(slices: ShareSlice[], max: number): ShareSlice[] {
  const sorted = slices.slice().sort((a, b) => b.weight - a.weight);
  if (sorted.length <= max) return sorted;
  const keep = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1);
  const weight = rest.reduce((sum, slice) => sum + slice.weight, 0);
  return [...keep, { label: `Other (${rest.length})`, weight, kind: 'other' }];
}

/** A short plain-text summary, for pasting into a post or message. */
export function shareSummaryText(view: ShareView): string {
  const pct = (value: number, digits = 1) => `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(digits)}%`;
  const lines = [`${view.title}${view.owner ? ` · ${view.owner}` : ''}`];
  if (view.totals.value !== null) lines.push(`${view.amounts === 'scaled' ? 'Model value' : 'Value'}: $${Math.round(view.totals.value).toLocaleString('en-US')}`);
  if (view.totals.gainPct !== null) lines.push(`Total gain: ${pct(view.totals.gainPct)}`);
  if (view.performance) {
    lines.push(`${rangeLabel(view.performance.range)} return: ${pct(view.performance.portfolioReturn)} vs ${view.performance.benchmark} ${pct(view.performance.benchmarkReturn)}`);
  }
  const top = view.allocation.filter((slice) => slice.kind === 'holding' || slice.kind === 'sector').slice(0, 5);
  if (top.length) lines.push(`Top: ${top.map((slice) => `${slice.label} ${(slice.weight * 100).toFixed(1)}%`).join(', ')}`);
  return lines.join('\n');
}

/** What the middle of the allocation donut says: the portfolio's size when it is shared, otherwise how many pieces it has. */
export function donutCenter(view: ShareView): { value: string; label: string } {
  if (view.totals.value !== null) return { value: formatMoney(view.totals.value, { digits: 0 }), label: view.amounts === 'scaled' ? 'Model portfolio' : 'Portfolio value' };
  if (view.allocation.some((slice) => slice.kind === 'sector')) return { value: String(view.sectors.length), label: view.sectors.length === 1 ? 'sector' : 'sectors' };
  const count = view.totals.positions ?? view.allocation.filter((slice) => slice.kind === 'holding').length;
  return { value: String(count), label: count === 1 ? 'holding' : 'holdings' };
}

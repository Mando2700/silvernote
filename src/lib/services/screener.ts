import 'server-only';

import { q } from '@/lib/db';
import { memo } from '@/lib/data/http';

/** Numeric fields the explorer can filter, sort and rank on. */
export const METRIC_KEYS = [
  'price', 'changePct', 'marketCap', 'volume', 'revenue', 'netIncome', 'fcf', 'revenueGrowth', 'revenueCagr3', 'epsGrowth',
  'grossMargin', 'operatingMargin', 'netMargin', 'fcfMargin', 'roe', 'roa', 'debtToEquity', 'currentRatio', 'pe', 'ps', 'pb',
  'pfcf', 'evEbitda', 'fcfYield', 'dividendYield', 'score',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export type UniverseEntry = {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  country: string | null;
  fiscalYear: number | null;
  scoreLabel: string | null;
  scoreConfidence: string | null;
  scoreAt: string | null;
} & Record<MetricKey, number | null>;

type Raw = {
  symbol: string;
  primary_class: boolean;
  name: string;
  sector: string | null;
  industry: string | null;
  country: string | null;
  price: number | null;
  change_pct: number | null;
  market_cap: number | null;
  volume: number | null;
  fiscal_year: number | null;
  revenue: number | null;
  revenue_prev: number | null;
  revenue_3y_ago: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  ebitda: number | null;
  net_income: number | null;
  eps: number | null;
  eps_prev: number | null;
  fcf: number | null;
  dividends_paid: number | null;
  total_assets: number | null;
  total_equity: number | null;
  cash: number | null;
  total_debt: number | null;
  current_assets: number | null;
  current_liabilities: number | null;
  overall: number | null;
  label: string | null;
  confidence: string | null;
  calculated_at: Date | null;
};

const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const positiveDiv = (a: number | null, b: number | null) => (b === null || b <= 0 ? null : div(a, b));
const growth = (current: number | null, previous: number | null) =>
  current === null || previous === null || previous === 0 ? null : (current - previous) / Math.abs(previous);

function clean(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : value;
}

function toEntry(row: Raw): UniverseEntry {
  const marketCap = row.market_cap;
  const enterpriseValue = marketCap !== null ? marketCap + (row.total_debt ?? 0) - (row.cash ?? 0) : null;
  const cagr3 =
    row.revenue !== null && row.revenue_3y_ago !== null && row.revenue > 0 && row.revenue_3y_ago > 0
      ? (row.revenue / row.revenue_3y_ago) ** (1 / 3) - 1
      : null;
  return {
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    country: row.country,
    fiscalYear: row.fiscal_year,
    scoreLabel: row.label,
    scoreConfidence: row.confidence,
    scoreAt: row.calculated_at ? new Date(row.calculated_at).toISOString() : null,
    price: row.price,
    changePct: row.change_pct,
    marketCap,
    volume: row.volume,
    revenue: row.revenue,
    netIncome: row.net_income,
    fcf: row.fcf,
    revenueGrowth: clean(growth(row.revenue, row.revenue_prev)),
    revenueCagr3: clean(cagr3),
    epsGrowth: clean(growth(row.eps, row.eps_prev)),
    grossMargin: clean(div(row.gross_profit, row.revenue)),
    operatingMargin: clean(div(row.operating_income, row.revenue)),
    netMargin: clean(div(row.net_income, row.revenue)),
    fcfMargin: clean(div(row.fcf, row.revenue)),
    roe: clean(positiveDiv(row.net_income, row.total_equity)),
    roa: clean(div(row.net_income, row.total_assets)),
    debtToEquity: clean(positiveDiv(row.total_debt, row.total_equity)),
    currentRatio: clean(div(row.current_assets, row.current_liabilities)),
    pe: clean(positiveDiv(marketCap, row.net_income)),
    ps: clean(positiveDiv(marketCap, row.revenue)),
    pb: clean(positiveDiv(marketCap, row.total_equity)),
    pfcf: clean(positiveDiv(marketCap, row.fcf)),
    evEbitda: clean(positiveDiv(enterpriseValue, row.ebitda)),
    fcfYield: clean(div(row.fcf, marketCap)),
    dividendYield: clean(row.dividends_paid !== null && marketCap ? Math.abs(row.dividends_paid) / marketCap : null),
    score: row.overall,
  };
}

/**
 * Every listed common stock (all share classes) with fundamentals, valuation ratios and its latest SilverNote Score.
 * Use this for looking up a specific symbol; use getUniverse() for lists, rankings and statistics.
 */
export function getListings(): Promise<(UniverseEntry & { primaryClass: boolean })[]> {
  return memo('universe:listings', 45_000, async () => {
    // Share classes of one company (GOOGL/GOOG, BRK.A/BRK.B) share an SEC CIK: the most traded class is the primary one.
    const rows = await q<Raw>(
      `select s.symbol, s.name, s.sector, s.industry, s.country, s.price, s.change_pct, s.market_cap, s.volume,
              (s.cik is null or s.symbol = first_value(s.symbol) over (
                partition by s.cik order by s.volume desc nulls last, s.market_cap desc nulls last, s.symbol)) as primary_class,
              f.fiscal_year, f.revenue, f.revenue_prev, f.revenue_3y_ago, f.gross_profit, f.operating_income, f.ebitda,
              f.net_income, f.eps, f.eps_prev, f.fcf, f.dividends_paid, f.total_assets, f.total_equity, f.cash, f.total_debt,
              f.current_assets, f.current_liabilities, sc.overall, sc.label, sc.confidence, sc.calculated_at
       from public.securities s
       left join public.fundamentals f on f.symbol = s.symbol
       left join public.scores sc on sc.symbol = s.symbol
       where s.listed and s.is_common
       order by s.market_cap desc nulls last`,
    );
    return rows.map((row) => ({ ...toEntry(row), primaryClass: row.primary_class }));
  });
}

/** One entry per company (its primary share class), so multi-class companies are not counted twice. */
export function getUniverse(): Promise<UniverseEntry[]> {
  return memo('universe:entries', 45_000, async () =>
    (await getListings()).filter((entry) => entry.primaryClass).map(({ primaryClass, ...entry }) => (void primaryClass, entry)),
  );
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type GroupStats = {
  group: string;
  kind: 'sector' | 'industry';
  count: number;
  medians: Partial<Record<MetricKey, number | null>>;
};

/** Medians for a sector or industry, ignoring micro-caps (< $50M) that distort ratios. */
export async function getGroupStats(kind: 'sector' | 'industry', group: string): Promise<GroupStats> {
  return memo(`group:${kind}:${group}`, 5 * 60_000, async () => {
    const universe = await getUniverse();
    const members = universe.filter((entry) => entry[kind] === group && (entry.marketCap ?? 0) >= 50e6);
    const medians: Partial<Record<MetricKey, number | null>> = {};
    for (const key of ['marketCap', 'revenueGrowth', 'revenueCagr3', 'epsGrowth', 'grossMargin', 'operatingMargin', 'netMargin', 'fcfMargin', 'roe', 'roa', 'debtToEquity', 'currentRatio', 'pe', 'ps', 'pb', 'pfcf', 'evEbitda', 'fcfYield', 'dividendYield', 'score'] as MetricKey[]) {
      const values = members.map((entry) => entry[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      medians[key] = median(values);
    }
    return { group, kind, count: members.length, medians };
  });
}

/** Percentile (0–100) of a company within its sector for each metric; lower-is-better metrics are flipped. */
export async function getSectorPercentiles(symbol: string) {
  const [universe, listings] = await Promise.all([getUniverse(), getListings()]);
  const entry = listings.find((item) => item.symbol === symbol.toUpperCase());
  if (!entry?.sector) return null;
  const members = universe.filter((item) => item.sector === entry.sector && (item.marketCap ?? 0) >= 50e6);
  const lowerIsBetter = new Set<MetricKey>(['debtToEquity', 'pe', 'ps', 'pb', 'pfcf', 'evEbitda']);
  const result: Partial<Record<MetricKey, number | null>> = {};
  for (const key of METRIC_KEYS) {
    const value = entry[key];
    if (typeof value !== 'number') {
      result[key] = null;
      continue;
    }
    const values = members.map((item) => item[key]).filter((item): item is number => typeof item === 'number');
    if (values.length < 5) {
      result[key] = null;
      continue;
    }
    const below = values.filter((item) => (lowerIsBetter.has(key) ? item > value : item < value)).length;
    result[key] = Math.round((below / (values.length - 1 || 1)) * 100);
  }
  return { sector: entry.sector, count: members.length, percentiles: result };
}

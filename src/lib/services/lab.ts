import 'server-only';

import { eventStudy } from '@/lib/finance/event-study';
import { q1 } from '@/lib/db';
import { getFilings, getPeerSymbols } from '@/lib/services/market';
import { getCandles } from '@/lib/services/prices';
import { getUniverse, type UniverseEntry } from '@/lib/services/screener';

// ─── Event study ────────────────────────────────────────────────────────────

export type EventSource = 'earnings' | '8-K' | 'custom';

/** Earnings releases are 8-Ks carrying item 2.02 ("Results of Operations and Financial Condition"). */
async function filingDates(symbol: string, source: 'earnings' | '8-K', limit: number) {
  const filings = await getFilings(symbol);
  return filings
    .filter((filing) => filing.form === '8-K' && (source === '8-K' || (filing.items ?? '').split(',').includes('2.02')))
    .map((filing) => filing.filedAt)
    .filter((date, index, all) => all.indexOf(date) === index)
    .slice(0, limit);
}

export async function runEventStudy(input: { symbol: string; source: EventSource; dates?: string[]; window?: [number, number]; benchmark?: string; limit?: number }) {
  const symbol = input.symbol.toUpperCase();
  const benchmark = (input.benchmark ?? 'SPY').toUpperCase();
  const events = input.source === 'custom' ? (input.dates ?? []) : await filingDates(symbol, input.source, input.limit ?? 12);
  if (!events.length) throw new Error(input.source === 'custom' ? 'Add at least one event date.' : `No ${input.source === 'earnings' ? 'earnings 8-Ks (item 2.02)' : '8-K filings'} found for ${symbol}.`);
  const oldest = events.reduce((min, date) => (date < min ? date : min), events[0]);
  const years = Math.min(10, (Date.now() - Date.parse(oldest)) / (365 * 86_400_000) + 1.3);
  const [stock, market] = await Promise.all([getCandles(symbol, years), getCandles(benchmark, years)]);
  const result = eventStudy(
    stock.map((candle) => ({ t: candle.t, c: candle.c })),
    market.map((candle) => ({ t: candle.t, c: candle.c })),
    events.sort(),
    { window: input.window },
  );
  return {
    symbol,
    benchmark,
    source: input.source,
    ...result,
    method: `Market model (OLS on ${benchmark}) estimated over trading days ${result.estimation[0]} to ${result.estimation[1]} before each event; abnormal return = actual − (α + β·market).`,
  };
}

// ─── Comparable companies ───────────────────────────────────────────────────

export const COMP_METRICS = ['marketCap', 'pe', 'ps', 'pb', 'evEbitda', 'fcfYield', 'revenueGrowth', 'grossMargin', 'operatingMargin', 'netMargin', 'roe', 'debtToEquity', 'dividendYield', 'score'] as const;
export type CompMetric = (typeof COMP_METRICS)[number];

function stats(values: number[]) {
  if (!values.length) return { median: null, mean: null, low: null, high: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    low: sorted[0],
    high: sorted[sorted.length - 1],
  };
}

/**
 * A comps table for `symbol` against `peers` (or suggested peers), with peer statistics and the
 * target's value implied by the peer median P/E, P/S and EV/EBITDA.
 */
export async function buildComps(symbol: string, peers?: string[]) {
  const target = symbol.toUpperCase();
  const peerList = peers?.length ? peers.map((peer) => peer.toUpperCase()) : (await getPeerSymbols(target, 10)).symbols;
  const universe = await getUniverse();
  const bySymbol = new Map(universe.map((entry) => [entry.symbol, entry]));
  const rows = [target, ...peerList.filter((peer) => peer !== target)].map((sym) => bySymbol.get(sym)).filter((entry): entry is UniverseEntry => Boolean(entry));
  const peerRows = rows.filter((row) => row.symbol !== target);
  const summary = Object.fromEntries(
    COMP_METRICS.map((metric) => {
      // Negative multiples (losses) are meaningless as comps and are left out of the statistics.
      const values = peerRows.map((row) => row[metric as keyof UniverseEntry]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && (!['pe', 'evEbitda', 'ps', 'pb'].includes(metric) || value > 0));
      return [metric, stats(values)];
    }),
  ) as Record<CompMetric, ReturnType<typeof stats>>;

  const fundamentals = await q1<{ net_income: number | null; revenue: number | null; ebitda: number | null; total_debt: number | null; cash: number | null; shares: number | null; total_equity: number | null }>(
    'select net_income, revenue, ebitda, total_debt, cash, shares, total_equity from public.fundamentals where symbol = $1',
    [target],
  );
  const self = bySymbol.get(target);
  const price = self?.price ?? null;
  const shares = self?.marketCap && price ? self.marketCap / price : (fundamentals?.shares ?? null);
  const netDebt = (fundamentals?.total_debt ?? 0) - (fundamentals?.cash ?? 0);
  const implied: Array<{ method: string; multiple: number | null; price: number | null; upside: number | null }> = [];
  const push = (method: string, multiple: number | null, equityValue: number | null) => {
    const perShare = equityValue !== null && shares ? equityValue / shares : null;
    implied.push({ method, multiple, price: perShare, upside: perShare !== null && price ? perShare / price - 1 : null });
  };
  push('P/E × net income', summary.pe.median, summary.pe.median !== null && fundamentals?.net_income && fundamentals.net_income > 0 ? summary.pe.median * fundamentals.net_income : null);
  push('P/S × revenue', summary.ps.median, summary.ps.median !== null && fundamentals?.revenue ? summary.ps.median * fundamentals.revenue : null);
  push('EV/EBITDA × EBITDA − net debt', summary.evEbitda.median, summary.evEbitda.median !== null && fundamentals?.ebitda && fundamentals.ebitda > 0 ? summary.evEbitda.median * fundamentals.ebitda - netDebt : null);
  push('P/B × book equity', summary.pb.median, summary.pb.median !== null && fundamentals?.total_equity && fundamentals.total_equity > 0 ? summary.pb.median * fundamentals.total_equity : null);

  return {
    target,
    price,
    rows: rows.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      industry: row.industry,
      price: row.price,
      fiscalYear: row.fiscalYear,
      ...(Object.fromEntries(COMP_METRICS.map((metric) => [metric, (row[metric as keyof UniverseEntry] as number | null | undefined) ?? null])) as Record<CompMetric, number | null>),
    })),
    summary,
    implied,
    metrics: COMP_METRICS,
    note: 'Multiples use the latest fiscal year (SEC filings) and today’s market value. Peer statistics exclude negative multiples.',
  };
}

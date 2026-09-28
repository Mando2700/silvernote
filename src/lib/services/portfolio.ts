import 'server-only';

import { HttpError } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import type { Candle } from '@/lib/data/types';
import { sortTrades, type TradeKind } from '@/lib/finance/ledger';
import { buildPositions } from '@/lib/finance/positions';
import {
  alignReturns,
  annualizedReturn,
  backfillReturns,
  annualizedVolatility,
  beta,
  concentration,
  correlation,
  covariance,
  dailyReturns,
  downsideDeviation,
  equityCurve,
  maxDrawdown,
  sharpe,
  sortino,
  TRADING_DAYS,
  valueAtRisk,
  variance,
} from '@/lib/finance/stats';
import { getBondValues } from '@/lib/services/bonds';
import { getExtendedQuotes, getQuotes } from '@/lib/services/market';
import { getCandlesForMany, getRiskFreeRate } from '@/lib/services/prices';
import { getSecuritiesBySymbols } from '@/lib/services/universe';
import { adjustTransactionsForSplits } from '@/lib/services/splits';
import { reconcile } from '@/lib/services/ibkr-reconcile';
import type { FlexPosition } from '@/lib/data/providers/ibkr';

export type PortfolioRow = {
  id: string;
  user_id: string;
  name: string;
  benchmark: string;
  cash: number;
  lot_method: 'fifo' | 'lifo' | 'hifo';
  account_type: 'taxable' | 'tax_deferred' | 'tax_free';
  created_at: Date;
};
export type TransactionRow = {
  id: string;
  portfolio_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** In today's share units (restated for splits since the trade; see `split_factor`). */
  quantity: number;
  price: number;
  fees: number;
  traded_at: string;
  note: string | null;
  created_at: Date;
  broker_execution_id: string | null;
  kind: TradeKind;
  /** Shares per originally recorded share (1 when no split since the trade). */
  split_factor: number;
};

export { buildPositions, type Position } from '@/lib/finance/positions';

export async function listPortfolios(userId: string) {
  return q<PortfolioRow>(`select p.* from public.portfolios p where p.user_id = $1 order by p.created_at`, [userId]);
}

export async function getPortfolio(userId: string, id: string) {
  const portfolio = await q1<PortfolioRow>('select * from public.portfolios where id = $1 and user_id = $2', [id, userId]);
  if (!portfolio) throw new HttpError(404, 'Portfolio not found.');
  return portfolio;
}

/**
 * Synthetic rows are marked by their execution id: broker balancing rows, and photo imports (today's
 * holdings booked as opening buys, so their real purchase dates are unknown). Older photo imports
 * predate the marker and are recognized by their note.
 */
export function kindOf(brokerExecutionId: string | null | undefined, note?: string | null): TradeKind {
  if (brokerExecutionId?.startsWith('ibkr:balance:open:') || brokerExecutionId?.startsWith('import:opening:')) return 'opening';
  if (brokerExecutionId?.startsWith('ibkr:balance:adjust:')) return 'removal';
  if (!brokerExecutionId && note === 'Imported from photo') return 'opening';
  return 'trade';
}

/** Rows exactly as stored (in the share units of their trade day). */
export async function getStoredTransactions(portfolioId: string) {
  const rows = await q<Omit<TransactionRow, 'kind' | 'split_factor'>>(
    `select id, portfolio_id, symbol, side, quantity, price, fees, traded_at::text as traded_at, note, created_at, broker_execution_id
     from public.transactions where portfolio_id = $1 order by traded_at desc, created_at desc`,
    [portfolioId],
  );
  return rows.map((row) => ({ ...row, kind: kindOf(row.broker_execution_id, row.note) }));
}

type StoredTransaction = Awaited<ReturnType<typeof getStoredTransactions>>[number];

/**
 * The ledger in today's share units, from stored rows: trades restated for splits, plus the balancing
 * rows that make a broker-synced portfolio match the broker's positions as of its last sync. Those are
 * derived here from the stored snapshot (not stored themselves) so they always agree with the split
 * adjustment. Trades after the snapshot date apply on top.
 */
export async function assembleLedger(portfolioId: string, stored: StoredTransaction[]): Promise<TransactionRow[]> {
  const snapshot = await q1<{ positions: FlexPosition[]; positions_as_of: string }>(
    `select positions, positions_as_of::text as positions_as_of from public.broker_accounts
     where portfolio_id = $1 and positions is not null and positions_as_of is not null limit 1`,
    [portfolioId],
  );
  // Balancing rows stored by older syncs are superseded by the snapshot.
  const rows = snapshot ? stored.filter((row) => !row.broker_execution_id?.startsWith('ibkr:balance:')) : stored;
  const adjusted = await adjustTransactionsForSplits(rows);
  if (!snapshot) return adjusted;
  const asOf = snapshot.positions_as_of;
  const balancing: TransactionRow[] = reconcile(
    adjusted.filter((row) => row.traded_at <= asOf),
    snapshot.positions,
    asOf,
  ).map((row) => ({
    id: `balance:${row.kind}:${row.symbol}`,
    portfolio_id: portfolioId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fees: 0,
    traded_at: row.tradedAt,
    note: row.kind === 'open' ? 'Opening balance from IBKR (before synced history)' : 'Balanced to the IBKR position',
    created_at: new Date(row.kind === 'open' ? `${row.tradedAt}T00:00:00Z` : `${row.tradedAt}T23:59:59Z`),
    broker_execution_id: null,
    kind: row.kind === 'open' ? 'opening' : 'removal',
    split_factor: 1,
  }));
  return [...adjusted, ...balancing].sort(
    (a, b) => b.traded_at.localeCompare(a.traded_at) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** The ledger in today's share units: every consumer (holdings, tax lots, performance) reads this. */
export async function getTransactions(portfolioId: string): Promise<TransactionRow[]> {
  return assembleLedger(portfolioId, await getStoredTransactions(portfolioId));
}

export type Holding = {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  shares: number;
  avgCost: number;
  costBasis: number;
  price: number | null;
  marketValue: number;
  dayChange: number;
  dayChangePct: number | null;
  /** Pre-market or after-hours price, with the position's move from the regular close ($ and %). */
  extendedPrice: number | null;
  extendedChange: number;
  extendedChangePct: number | null;
  unrealized: number;
  unrealizedPct: number | null;
  realized: number;
  weight: number;
  score: number | null;
  firstBought: string | null;
  /** False when no quote was available: market value then falls back to cost and P&L reads zero. */
  priced: boolean;
  /** When the price was last updated (ms since epoch), or null when unpriced. */
  priceAsOf: number | null;
};

export async function getHoldings(portfolio: PortfolioRow) {
  const transactions = await getTransactions(portfolio.id);
  const positions = buildPositions(transactions);
  const symbols = [...positions.keys()];
  const [quotes, extendedQuotes, securities, scores, bonds] = await Promise.all([
    getQuotes(symbols),
    getExtendedQuotes(symbols),
    getSecuritiesBySymbols(symbols),
    symbols.length ? q<{ symbol: string; overall: number }>('select symbol, overall from public.scores where symbol = any($1::text[])', [symbols]) : Promise.resolve([]),
    getBondValues(portfolio.id),
  ]);
  const securityBySymbol = new Map(securities.map((row) => [row.symbol, row]));
  const scoreBySymbol = new Map(scores.map((row) => [row.symbol, row.overall]));
  let realizedTotal = 0;
  const holdings: Holding[] = [];
  for (const position of positions.values()) {
    realizedTotal += position.realized;
    if (position.shares <= 0) continue;
    const quote = quotes[position.symbol];
    const extended = extendedQuotes[position.symbol];
    const security = securityBySymbol.get(position.symbol);
    // Outside regular hours the position is valued at the regular close; extended trading is shown on its own.
    const lastPrice = extended?.close ?? quote?.price ?? null;
    const lastChange = extended ? extended.closeChange : (quote?.change ?? null);
    const marketValue = lastPrice !== null ? lastPrice * position.shares : position.cost;
    const dayChange = lastChange != null ? lastChange * position.shares : 0;
    holdings.push({
      symbol: position.symbol,
      name: security?.name ?? position.symbol,
      sector: security?.sector ?? (security ? null : 'Funds & other'),
      industry: security?.industry ?? null,
      shares: position.shares,
      avgCost: position.cost / position.shares,
      costBasis: position.cost,
      price: lastPrice,
      marketValue,
      dayChange,
      dayChangePct: extended ? extended.closeChangePct : (quote?.changePct ?? null),
      extendedPrice: extended?.price ?? null,
      extendedChange: extended ? extended.change * position.shares : 0,
      extendedChangePct: extended?.changePct ?? null,
      unrealized: marketValue - position.cost,
      unrealizedPct: position.cost > 0 ? (marketValue - position.cost) / position.cost : null,
      realized: position.realized,
      weight: 0,
      score: scoreBySymbol.get(position.symbol) ?? null,
      firstBought: position.firstBought,
      priced: lastPrice !== null,
      priceAsOf: lastPrice !== null ? (extended?.timestamp ?? quote?.timestamp ?? null) : null,
    });
  }
  const invested = holdings.reduce((total, holding) => total + holding.marketValue, 0);
  // Bonds count toward the total (market value with accrued interest) but not toward equity analytics.
  const fixedIncome = bonds.reduce((sum, bond) => sum + bond.marketValue, 0);
  const total = invested + fixedIncome + (portfolio.cash ?? 0);
  for (const holding of holdings) holding.weight = total > 0 ? holding.marketValue / total : 0;
  holdings.sort((a, b) => b.marketValue - a.marketValue);
  const costBasis = holdings.reduce((sum, holding) => sum + holding.costBasis, 0);
  const dayChange = holdings.reduce((sum, holding) => sum + holding.dayChange, 0);
  const extendedChange = holdings.reduce((sum, holding) => sum + holding.extendedChange, 0);
  const extendedSession = Object.values(extendedQuotes)[0]?.session ?? null;
  return {
    transactions,
    holdings,
    summary: {
      totalValue: total,
      invested,
      fixedIncome,
      bonds: bonds.filter((bond) => !bond.matured).length,
      cash: portfolio.cash ?? 0,
      costBasis,
      unrealized: invested - costBasis,
      unrealizedPct: costBasis > 0 ? (invested - costBasis) / costBasis : null,
      realized: realizedTotal,
      dayChange,
      dayChangePct: total - dayChange > 0 ? dayChange / (total - dayChange) : null,
      /** Pre-market or after-hours move of the holdings from the regular close; null during regular hours. */
      extended: extendedSession ? { session: extendedSession, change: extendedChange, changePct: total > 0 ? extendedChange / total : null } : null,
      positions: holdings.length,
      /** Holdings valued at cost because no price was available. */
      unpriced: holdings.filter((holding) => !holding.priced).map((holding) => holding.symbol),
      /** Oldest quote behind the valuation (ms since epoch). */
      pricesAsOf: holdings.reduce<number | null>((oldest, holding) => (holding.priceAsOf !== null && (oldest === null || holding.priceAsOf < oldest) ? holding.priceAsOf : oldest), null),
    },
  };
}

// ─── Risk model ─────────────────────────────────────────────────────────────

export type RiskModel = {
  symbols: string[];
  weights: number[];
  dates: number[];
  /** Daily simple returns per symbol aligned on common dates (symbols × days). */
  returns: number[][];
  benchmark: { symbol: string; returns: number[] } | null;
  excluded: string[];
  /** Symbols listed inside the window whose earlier days are modelled from the benchmark via beta. */
  backfilled: string[];
};

/** Aligned daily returns for the current holdings (plus benchmark) over the lookback window. */
export async function buildRiskModel(
  holdings: Array<Pick<Holding, 'symbol' | 'marketValue'>>,
  benchmarkSymbol: string,
  lookbackDays = 252 * 2,
): Promise<RiskModel> {
  const symbols = holdings.filter((holding) => holding.marketValue > 0).map((holding) => holding.symbol);
  const years = Math.min(10, lookbackDays / 252 + 0.2);
  const candles = await getCandlesForMany([...symbols, benchmarkSymbol], years);
  const usable = symbols.filter((symbol) => (candles.get(symbol)?.length ?? 0) > 60);
  const excluded = symbols.filter((symbol) => !usable.includes(symbol));
  const maps = usable.map((symbol) => dailyReturns((candles.get(symbol) as Candle[]).map((candle) => ({ t: candle.t, c: candle.c }))));
  const benchmarkCandles = candles.get(benchmarkSymbol) ?? [];
  const benchmarkMap = dailyReturns(benchmarkCandles.map((candle) => ({ t: candle.t, c: candle.c })));
  const hasBenchmark = benchmarkCandles.length > 60;
  const valueBySymbol = new Map(holdings.map((holding) => [holding.symbol, holding.marketValue]));
  const totalUsable = usable.reduce((sum, symbol) => sum + (valueBySymbol.get(symbol) ?? 0), 0);
  const weights = usable.map((symbol) => (totalUsable > 0 ? (valueBySymbol.get(symbol) ?? 0) / totalUsable : 0));
  if (hasBenchmark) {
    const filled = backfillReturns(maps, benchmarkMap);
    const start = Math.max(0, filled.dates.length - lookbackDays);
    return {
      symbols: usable,
      weights,
      dates: filled.dates.slice(start),
      returns: filled.matrix.map((row) => row.slice(start)),
      benchmark: { symbol: benchmarkSymbol, returns: filled.market.slice(start) },
      excluded,
      backfilled: usable.filter((_, index) => filled.firstReal[index] > start),
    };
  }
  const { dates, matrix } = alignReturns(maps);
  const start = Math.max(0, dates.length - lookbackDays);
  return {
    symbols: usable,
    weights,
    dates: dates.slice(start),
    returns: matrix.map((row) => row.slice(start)),
    benchmark: null,
    excluded,
    backfilled: [],
  };
}

export function portfolioReturns(model: Pick<RiskModel, 'weights' | 'returns'>) {
  const days = model.returns[0]?.length ?? 0;
  const result = new Array<number>(days).fill(0);
  model.weights.forEach((weight, index) => {
    const series = model.returns[index];
    for (let day = 0; day < days; day += 1) result[day] += weight * series[day];
  });
  return result;
}

export function riskStatistics(model: RiskModel, riskFree: number) {
  const returns = portfolioReturns(model);
  if (returns.length < 30) return null;
  const curve = equityCurve(returns);
  const drawdown = maxDrawdown(curve);
  const benchmarkReturns = model.benchmark?.returns ?? null;
  const portfolioVariance = variance(returns);
  // Contribution to risk: w_i · cov(r_i, r_p) / var(r_p) — sums to 100%.
  const contributions = model.symbols.map((symbol, index) => ({
    symbol,
    weight: model.weights[index],
    contribution: portfolioVariance ? (model.weights[index] * covariance(model.returns[index], returns)) / portfolioVariance : 0,
    volatility: annualizedVolatility(model.returns[index]),
    beta: benchmarkReturns ? beta(model.returns[index], benchmarkReturns) : null,
  }));
  const correlationMatrix = model.returns.map((row) => model.returns.map((other) => correlation(row, other)));
  return {
    days: returns.length,
    from: model.dates[0] ?? null,
    to: model.dates[model.dates.length - 1] ?? null,
    annualReturn: annualizedReturn(returns),
    volatility: annualizedVolatility(returns),
    downsideDeviation: downsideDeviation(returns),
    sharpe: sharpe(returns, riskFree),
    sortino: sortino(returns, riskFree),
    beta: benchmarkReturns ? beta(returns, benchmarkReturns) : null,
    correlationToBenchmark: benchmarkReturns ? correlation(returns, benchmarkReturns) : null,
    benchmarkVolatility: benchmarkReturns ? annualizedVolatility(benchmarkReturns) : null,
    benchmarkReturn: benchmarkReturns ? annualizedReturn(benchmarkReturns) : null,
    maxDrawdown: drawdown.value,
    maxDrawdownFrom: model.dates[Math.max(0, drawdown.peakIndex - 1)] ?? null,
    maxDrawdownTo: model.dates[Math.max(0, drawdown.troughIndex - 1)] ?? null,
    var95: valueAtRisk(returns, 0.95, 1),
    var99: valueAtRisk(returns, 0.99, 1),
    var95_10d: valueAtRisk(returns, 0.95, 10),
    contributions,
    correlation: { symbols: model.symbols, matrix: correlationMatrix },
    riskFree,
    tradingDays: TRADING_DAYS,
  };
}

/** Portfolio value through time from the ledger, plus a time-weighted index vs the benchmark. */
export async function performanceHistory(transactions: TransactionRow[], benchmarkSymbol: string) {
  if (!transactions.length) return [];
  const sorted = sortTrades(transactions);
  const first = sorted[0].traded_at;
  const years = Math.min(10, (Date.now() - Date.parse(first)) / (365.25 * 86_400_000) + 0.1);
  const symbols = [...new Set(sorted.map((tx) => tx.symbol))];
  const candles = await getCandlesForMany([...symbols, benchmarkSymbol], Math.max(0.3, years));
  const benchmark = candles.get(benchmarkSymbol) ?? [];
  const firstDay = Math.floor(Date.parse(`${first}T00:00:00Z`) / 1000);
  const timeline = benchmark.filter((candle) => candle.t >= firstDay - 86_400).map((candle) => candle.t);
  if (!timeline.length) return [];

  const closes = new Map<string, Map<number, number>>();
  for (const symbol of symbols) closes.set(symbol, new Map((candles.get(symbol) ?? []).map((candle) => [candle.t, candle.c])));
  const lastClose = new Map<string, number>();
  const shares = new Map<string, number>();
  const benchmarkClose = new Map(benchmark.map((candle) => [candle.t, candle.c]));
  const points: Array<{ t: number; value: number; invested: number; twr: number; benchmark: number }> = [];
  let txIndex = 0;
  let invested = 0;
  let twr = 1;
  let previousValue = 0;
  const benchmarkBase = benchmarkClose.get(timeline[0]) ?? 1;

  for (const day of timeline) {
    let flow = 0;
    const dayIso = new Date(day * 1000).toISOString().slice(0, 10);
    while (txIndex < sorted.length && sorted[txIndex].traded_at <= dayIso) {
      const tx = sorted[txIndex];
      const held = shares.get(tx.symbol) ?? 0;
      // Never sell more than is held, matching the holdings replay.
      const quantity = tx.side === 'buy' ? tx.quantity : Math.min(tx.quantity, Math.max(0, held));
      shares.set(tx.symbol, held + (tx.side === 'buy' ? quantity : -quantity));
      // Until a symbol has a close of its own, it is carried at its trade price so the flow and the value agree.
      if (!lastClose.has(tx.symbol) && tx.price > 0) lastClose.set(tx.symbol, tx.price);
      if (tx.kind === 'removal') {
        // Shares leaving without a sale are an outflow at market value, not a loss.
        flow -= quantity * (closes.get(tx.symbol)?.get(day) ?? lastClose.get(tx.symbol) ?? tx.price);
      } else if (tx.side === 'buy') {
        flow += quantity * tx.price + tx.fees;
      } else {
        flow -= quantity * tx.price - (tx.quantity > 0 ? (tx.fees * quantity) / tx.quantity : 0);
      }
      txIndex += 1;
    }
    invested += flow;
    let value = 0;
    for (const [symbol, count] of shares) {
      if (count <= 0) continue;
      const close = closes.get(symbol)?.get(day);
      if (close) lastClose.set(symbol, close);
      value += count * (lastClose.get(symbol) ?? 0);
    }
    // Time-weighted return: the day's gain on the capital at work (yesterday's value plus today's buys).
    const base = previousValue + Math.max(0, flow);
    if (base > 0) {
      const dailyReturn = (value - Math.min(0, flow)) / base - 1;
      if (Number.isFinite(dailyReturn)) twr *= 1 + dailyReturn;
    }
    previousValue = value;
    points.push({ t: day, value, invested, twr: twr * 100, benchmark: ((benchmarkClose.get(day) ?? benchmarkBase) / benchmarkBase) * 100 });
  }
  return points;
}

export async function riskFreeFor(preferred: number | null | undefined) {
  if (typeof preferred === 'number' && Number.isFinite(preferred)) return preferred;
  return getRiskFreeRate();
}

export function sectorExposure(holdings: Holding[], cash: number, fixedIncome = 0) {
  const total = holdings.reduce((sum, holding) => sum + holding.marketValue, 0) + cash + fixedIncome;
  const map = new Map<string, number>();
  for (const holding of holdings) map.set(holding.sector ?? 'Other', (map.get(holding.sector ?? 'Other') ?? 0) + holding.marketValue);
  if (fixedIncome > 0) map.set('Bonds', fixedIncome);
  if (cash > 0) map.set('Cash', cash);
  return [...map.entries()].map(([sector, value]) => ({ sector, value, weight: total > 0 ? value / total : 0 })).sort((a, b) => b.value - a.value);
}

export function concentrationStats(holdings: Holding[]) {
  return concentration(holdings.map((holding) => holding.marketValue));
}

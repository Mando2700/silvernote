import 'server-only';

import { HttpError } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import type { Candle } from '@/lib/data/types';
import {
  alignReturns,
  annualizedReturn,
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
import { getQuotes } from '@/lib/services/market';
import { getCandlesForMany, getRiskFreeRate } from '@/lib/services/prices';
import { getSecuritiesBySymbols } from '@/lib/services/universe';

export type PortfolioRow = { id: string; user_id: string; name: string; benchmark: string; cash: number; created_at: Date };
export type TransactionRow = {
  id: string;
  portfolio_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fees: number;
  traded_at: string;
  note: string | null;
  created_at: Date;
};

export type Position = { symbol: string; shares: number; cost: number; realized: number; firstBought: string | null };

/** Average-cost position keeping: sells realize P&L against the running average cost. */
export function buildPositions(transactions: Array<Pick<TransactionRow, 'symbol' | 'side' | 'quantity' | 'price' | 'fees' | 'traded_at'>>) {
  const positions = new Map<string, Position>();
  const sorted = [...transactions].sort((a, b) => a.traded_at.localeCompare(b.traded_at));
  for (const tx of sorted) {
    const position = positions.get(tx.symbol) ?? { symbol: tx.symbol, shares: 0, cost: 0, realized: 0, firstBought: null };
    if (tx.side === 'buy') {
      position.cost += tx.quantity * tx.price + tx.fees;
      position.shares += tx.quantity;
      position.firstBought ??= tx.traded_at;
    } else {
      const quantity = Math.min(tx.quantity, position.shares);
      const average = position.shares > 0 ? position.cost / position.shares : 0;
      position.realized += quantity * tx.price - tx.fees - average * quantity;
      position.cost -= average * quantity;
      position.shares -= quantity;
      if (position.shares < 1e-9) {
        position.shares = 0;
        position.cost = 0;
      }
    }
    positions.set(tx.symbol, position);
  }
  return positions;
}

export async function listPortfolios(userId: string) {
  return q<PortfolioRow & { positions: number }>(
    `select p.*, (select count(distinct symbol)::int from public.transactions t where t.portfolio_id = p.id) as positions
     from public.portfolios p where p.user_id = $1 order by p.created_at`,
    [userId],
  );
}

export async function getPortfolio(userId: string, id: string) {
  const portfolio = await q1<PortfolioRow>('select * from public.portfolios where id = $1 and user_id = $2', [id, userId]);
  if (!portfolio) throw new HttpError(404, 'Portfolio not found.');
  return portfolio;
}

export async function getTransactions(portfolioId: string) {
  return q<TransactionRow>(
    `select id, portfolio_id, symbol, side, quantity, price, fees, traded_at::text as traded_at, note, created_at
     from public.transactions where portfolio_id = $1 order by traded_at desc, created_at desc`,
    [portfolioId],
  );
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
  unrealized: number;
  unrealizedPct: number | null;
  realized: number;
  weight: number;
  score: number | null;
  firstBought: string | null;
};

export async function getHoldings(portfolio: PortfolioRow) {
  const transactions = await getTransactions(portfolio.id);
  const positions = buildPositions(transactions);
  const symbols = [...positions.keys()];
  const [quotes, securities, scores] = await Promise.all([
    getQuotes(symbols),
    getSecuritiesBySymbols(symbols),
    symbols.length ? q<{ symbol: string; overall: number }>('select symbol, overall from public.scores where symbol = any($1::text[])', [symbols]) : Promise.resolve([]),
  ]);
  const securityBySymbol = new Map(securities.map((row) => [row.symbol, row]));
  const scoreBySymbol = new Map(scores.map((row) => [row.symbol, row.overall]));
  let realizedTotal = 0;
  const holdings: Holding[] = [];
  for (const position of positions.values()) {
    realizedTotal += position.realized;
    if (position.shares <= 0) continue;
    const quote = quotes[position.symbol];
    const security = securityBySymbol.get(position.symbol);
    const lastPrice = quote?.price ?? null;
    const marketValue = lastPrice !== null ? lastPrice * position.shares : position.cost;
    const dayChange = quote?.change != null ? quote.change * position.shares : 0;
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
      dayChangePct: quote?.changePct ?? null,
      unrealized: marketValue - position.cost,
      unrealizedPct: position.cost > 0 ? (marketValue - position.cost) / position.cost : null,
      realized: position.realized,
      weight: 0,
      score: scoreBySymbol.get(position.symbol) ?? null,
      firstBought: position.firstBought,
    });
  }
  const invested = holdings.reduce((total, holding) => total + holding.marketValue, 0);
  const total = invested + (portfolio.cash ?? 0);
  for (const holding of holdings) holding.weight = total > 0 ? holding.marketValue / total : 0;
  holdings.sort((a, b) => b.marketValue - a.marketValue);
  const costBasis = holdings.reduce((sum, holding) => sum + holding.costBasis, 0);
  const dayChange = holdings.reduce((sum, holding) => sum + holding.dayChange, 0);
  return {
    transactions,
    holdings,
    summary: {
      totalValue: total,
      invested,
      cash: portfolio.cash ?? 0,
      costBasis,
      unrealized: invested - costBasis,
      unrealizedPct: costBasis > 0 ? (invested - costBasis) / costBasis : null,
      realized: realizedTotal,
      dayChange,
      dayChangePct: total - dayChange > 0 ? dayChange / (total - dayChange) : null,
      positions: holdings.length,
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
  const { dates, matrix } = alignReturns(benchmarkCandles.length > 60 ? [...maps, benchmarkMap] : maps);
  const start = Math.max(0, dates.length - lookbackDays);
  const cut = (row: number[]) => row.slice(start);
  const hasBenchmark = benchmarkCandles.length > 60;
  const valueBySymbol = new Map(holdings.map((holding) => [holding.symbol, holding.marketValue]));
  const totalUsable = usable.reduce((sum, symbol) => sum + (valueBySymbol.get(symbol) ?? 0), 0);
  return {
    symbols: usable,
    weights: usable.map((symbol) => (totalUsable > 0 ? (valueBySymbol.get(symbol) ?? 0) / totalUsable : 0)),
    dates: dates.slice(start),
    returns: matrix.slice(0, usable.length).map(cut),
    benchmark: hasBenchmark ? { symbol: benchmarkSymbol, returns: cut(matrix[matrix.length - 1]) } : null,
    excluded,
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
  const sorted = [...transactions].sort((a, b) => a.traded_at.localeCompare(b.traded_at));
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
      const signedQuantity = tx.side === 'buy' ? tx.quantity : -tx.quantity;
      shares.set(tx.symbol, (shares.get(tx.symbol) ?? 0) + signedQuantity);
      const amount = tx.quantity * tx.price + (tx.side === 'buy' ? tx.fees : -tx.fees);
      flow += tx.side === 'buy' ? amount : -amount;
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
    if (previousValue > 0) {
      const dailyReturn = (value - flow) / previousValue - 1;
      if (Number.isFinite(dailyReturn) && Math.abs(dailyReturn) < 0.5) twr *= 1 + dailyReturn;
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

export function sectorExposure(holdings: Holding[], cash: number) {
  const total = holdings.reduce((sum, holding) => sum + holding.marketValue, 0) + cash;
  const map = new Map<string, number>();
  for (const holding of holdings) map.set(holding.sector ?? 'Other', (map.get(holding.sector ?? 'Other') ?? 0) + holding.marketValue);
  if (cash > 0) map.set('Cash', cash);
  return [...map.entries()].map(([sector, value]) => ({ sector, value, weight: total > 0 ? value / total : 0 })).sort((a, b) => b.value - a.value);
}

export function concentrationStats(holdings: Holding[]) {
  return concentration(holdings.map((holding) => holding.marketValue));
}

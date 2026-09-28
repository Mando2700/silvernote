/**
 * Rule-based backtests over a monthly point-in-time score panel.
 *
 * At every rebalance, held names are sold when an exit rule fires (or, with no exit rules, when
 * they stop meeting the entry rules); free slots are filled with the best-ranked names that meet
 * every entry rule. Returns are month to month on closing prices, with trading costs charged on
 * turnover. Pure functions: no I/O.
 */

import { covariance, mean, stdev, variance } from '@/lib/finance/stats';

export const SCORE_FIELDS = [
  'overall',
  'growth',
  'profitability',
  'valuation',
  'financialHealth',
  'momentum',
  'earningsQuality',
  'competitivePosition',
  'efficiency',
  'risk',
  'futureOutlook',
] as const;
export const PRICE_FIELDS = ['return1m', 'return3m', 'return6m', 'return12m', 'marketCap'] as const;

export type ScoreField = (typeof SCORE_FIELDS)[number];
export type Field = ScoreField | (typeof PRICE_FIELDS)[number];
export type Operator = 'gt' | 'lt' | 'rising' | 'falling' | 'top' | 'bottom';

export type Condition = {
  field: Field;
  op: Operator;
  /** Threshold for gt/lt, minimum change for rising/falling, percent of names for top/bottom. */
  value?: number;
  /** Months to look back for rising/falling (default 1). */
  lookback?: number;
};

export type Strategy = {
  entry: Condition[];
  exit: Condition[];
  /** Months between rebalances. */
  rebalance: 1 | 3 | 6 | 12;
  maxPositions: number;
  rankBy: Field;
  weighting: 'equal' | 'signal';
  /** One-way trading cost in basis points of traded value. */
  costBps: number;
  start?: string;
  end?: string;
  /** Minimum market value in $ billions at each rebalance. */
  minMarketCap?: number;
  sectors?: string[];
};

export type PanelPoint = {
  overall: number;
  sub: Partial<Record<ScoreField, number>>;
  price: number;
  marketCap: number | null;
};

export type Panel = {
  /** Ascending month-end dates (ISO). */
  dates: string[];
  series: Map<string, Array<PanelPoint | null>>;
  sectors: Map<string, string | null>;
  /** Benchmark close on each date. */
  benchmark: Array<number | null>;
};

export type Trade = {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  return: number | null;
  months: number;
  reason: string | null;
};

export type SeriesStats = {
  totalReturn: number;
  cagr: number;
  volatility: number;
  sharpe: number | null;
  maxDrawdown: number;
  bestMonth: number;
  worstMonth: number;
};

export type BacktestResult = {
  dates: string[];
  equity: number[];
  benchmark: number[];
  universe: number[];
  positions: number[];
  stats: SeriesStats & {
    sortino: number | null;
    beta: number | null;
    alpha: number | null;
    hitRate: number | null;
    maxDrawdownFrom: string | null;
    maxDrawdownTo: string | null;
    avgPositions: number;
    turnover: number;
    exposure: number;
    trades: number;
    winRate: number | null;
    avgTradeReturn: number | null;
    avgHoldMonths: number | null;
  };
  benchmarkStats: SeriesStats;
  universeStats: SeriesStats;
  yearly: Array<{ year: number; strategy: number; benchmark: number | null; universe: number }>;
  trades: Trade[];
  openPositions: Trade[];
  picks: Array<{ symbol: string; rank: number | null; overall: number; momentum: number | null; price: number }>;
  universeSize: number;
};

export const FIELD_LABELS: Record<Field, string> = {
  overall: 'SilverNote Score',
  growth: 'Growth',
  profitability: 'Profitability',
  valuation: 'Valuation',
  financialHealth: 'Financial health',
  momentum: 'Momentum',
  earningsQuality: 'Earnings quality',
  competitivePosition: 'Competitive position',
  efficiency: 'Efficiency',
  risk: 'Risk',
  futureOutlook: 'Future outlook',
  return1m: '1-month return',
  return3m: '3-month return',
  return6m: '6-month return',
  return12m: '12-month return',
  marketCap: 'Market value ($B)',
};

const RETURN_MONTHS: Partial<Record<Field, number>> = { return1m: 1, return3m: 3, return6m: 6, return12m: 12 };

export function createEvaluator(panel: Panel, strategy: Pick<Strategy, 'minMarketCap' | 'sectors'>) {
  const rankCache = new Map<string, Map<string, number>>();
  const sectorFilter = strategy.sectors?.length ? new Set(strategy.sectors) : null;

  const point = (symbol: string, index: number) => (index >= 0 ? (panel.series.get(symbol)?.[index] ?? null) : null);

  const value = (symbol: string, index: number, field: Field): number | null => {
    const current = point(symbol, index);
    if (!current) return null;
    if (field === 'overall') return current.overall;
    if (field === 'marketCap') return current.marketCap !== null ? current.marketCap / 1e9 : null;
    const months = RETURN_MONTHS[field];
    if (months) {
      const past = point(symbol, index - months);
      return past && past.price > 0 ? current.price / past.price - 1 : null;
    }
    return current.sub[field as ScoreField] ?? null;
  };

  /** Percentile rank (0 = lowest, 1 = highest) within the names that have the field on that date. */
  const percentile = (symbol: string, index: number, field: Field) => {
    const key = `${index}:${field}`;
    let ranks = rankCache.get(key);
    if (!ranks) {
      const values: Array<[string, number]> = [];
      for (const candidate of panel.series.keys()) {
        const v = value(candidate, index, field);
        if (v !== null) values.push([candidate, v]);
      }
      values.sort((a, b) => a[1] - b[1]);
      ranks = new Map(values.map(([candidate], position) => [candidate, values.length > 1 ? position / (values.length - 1) : 1]));
      rankCache.set(key, ranks);
    }
    return ranks.get(symbol) ?? null;
  };

  const test = (symbol: string, index: number, condition: Condition): boolean => {
    const current = value(symbol, index, condition.field);
    if (current === null) return false;
    const threshold = condition.value ?? 0;
    switch (condition.op) {
      case 'gt':
        return current > threshold;
      case 'lt':
        return current < threshold;
      case 'rising':
      case 'falling': {
        const past = value(symbol, index - Math.max(1, condition.lookback ?? 1), condition.field);
        if (past === null) return false;
        return condition.op === 'rising' ? current - past > Math.max(0, threshold) : current - past < -Math.max(0, threshold);
      }
      case 'top':
      case 'bottom': {
        const rank = percentile(symbol, index, condition.field);
        if (rank === null) return false;
        const share = Math.min(100, Math.max(0, threshold)) / 100;
        return condition.op === 'top' ? rank >= 1 - share : rank <= share;
      }
      default:
        return false;
    }
  };

  const eligible = (symbol: string, index: number) => {
    const current = point(symbol, index);
    if (!current || !(current.price > 0)) return false;
    if (strategy.minMarketCap && (current.marketCap ?? 0) / 1e9 < strategy.minMarketCap) return false;
    if (sectorFilter && !sectorFilter.has(panel.sectors.get(symbol) ?? '')) return false;
    return true;
  };

  return { point, value, test, eligible };
}

function seriesStats(curve: number[], riskFree: number): SeriesStats {
  const returns = curve.slice(1).map((value, index) => value / curve[index] - 1);
  const months = returns.length;
  const total = (curve[curve.length - 1] ?? 1) / (curve[0] ?? 1) - 1;
  const cagr = months ? (1 + total) ** (12 / months) - 1 : 0;
  const volatility = months > 1 ? stdev(returns) * Math.sqrt(12) : 0;
  let peak = curve[0] ?? 1;
  let maxDrawdown = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }
  return {
    totalReturn: total,
    cagr,
    volatility,
    sharpe: volatility ? (cagr - riskFree) / volatility : null,
    maxDrawdown,
    bestMonth: months ? Math.max(...returns) : 0,
    worstMonth: months ? Math.min(...returns) : 0,
  };
}

function monthsBetween(from: string, to: string) {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function runBacktest(panel: Panel, strategy: Strategy, riskFree = 0.02): BacktestResult {
  const { point, value, test, eligible } = createEvaluator(panel, strategy);
  const symbols = [...panel.series.keys()];
  const startIndex = panel.dates.findIndex((date) => date >= (strategy.start ?? ''));
  let endIndex = panel.dates.length - 1;
  if (strategy.end) while (endIndex > 0 && panel.dates[endIndex] > strategy.end) endIndex -= 1;
  if (startIndex < 0 || endIndex - startIndex < 1) throw new Error('The backtest window needs at least two months of history.');

  const exitFires = (symbol: string, index: number) => strategy.exit.some((condition) => test(symbol, index, condition));
  // A name whose exit rule is firing is never bought.
  const meetsEntry = (symbol: string, index: number) => strategy.entry.every((condition) => test(symbol, index, condition)) && !exitFires(symbol, index);
  const shouldExit = (symbol: string, index: number) => (strategy.exit.length ? exitFires(symbol, index) : !meetsEntry(symbol, index));
  const rankValue = (symbol: string, index: number) => value(symbol, index, strategy.rankBy);
  const byRank = (index: number) => (a: string, b: string) => (rankValue(b, index) ?? -Infinity) - (rankValue(a, index) ?? -Infinity) || a.localeCompare(b);

  let weights = new Map<string, number>();
  const open = new Map<string, Trade>();
  const trades: Trade[] = [];
  let equity = 1;
  let bench = 1;
  let universe = 1;
  const dates = [panel.dates[startIndex]];
  const equityCurve = [1];
  const benchmarkCurve = [1];
  const universeCurve = [1];
  const positions: number[] = [];
  let turnoverTotal = 0;
  let investedMonths = 0;
  let benchmarkMissing = false;

  const lastPrice = (symbol: string, index: number) => {
    for (let i = index; i >= 0; i -= 1) {
      const p = point(symbol, i);
      if (p) return p.price;
    }
    return null;
  };

  const closeTrade = (symbol: string, index: number, reason: string) => {
    const trade = open.get(symbol);
    if (!trade) return;
    trade.exitDate = panel.dates[index];
    trade.exitPrice = lastPrice(symbol, index);
    trade.return = trade.exitPrice !== null ? trade.exitPrice / trade.entryPrice - 1 : null;
    trade.months = monthsBetween(trade.entryDate, trade.exitDate);
    trade.reason = reason;
    trades.push(trade);
    open.delete(symbol);
  };

  for (let index = startIndex; index < endIndex; index += 1) {
    if ((index - startIndex) % strategy.rebalance === 0) {
      const kept: string[] = [];
      // Names sold at this rebalance are not bought straight back.
      const held = new Set(weights.keys());
      for (const symbol of weights.keys()) {
        if (!point(symbol, index)) closeTrade(symbol, index, 'No data');
        else if (shouldExit(symbol, index)) closeTrade(symbol, index, strategy.exit.length ? 'Exit rule' : 'Left the screen');
        else kept.push(symbol);
      }
      const candidates = symbols.filter((symbol) => !held.has(symbol) && eligible(symbol, index) && meetsEntry(symbol, index)).sort(byRank(index));
      const chosen = [...kept.sort(byRank(index)).slice(0, strategy.maxPositions), ...candidates].slice(0, strategy.maxPositions);
      for (const symbol of kept) if (!chosen.includes(symbol)) closeTrade(symbol, index, 'Crowded out');

      const target = new Map<string, number>();
      if (chosen.length) {
        const signals = chosen.map((symbol) => (strategy.weighting === 'signal' ? Math.max(0, rankValue(symbol, index) ?? 0) : 1));
        const total = signals.reduce((sum, signal) => sum + signal, 0);
        chosen.forEach((symbol, i) => target.set(symbol, total > 0 ? signals[i] / total : 1 / chosen.length));
      }
      let turnover = 0;
      for (const symbol of new Set([...weights.keys(), ...target.keys()])) turnover += Math.abs((target.get(symbol) ?? 0) - (weights.get(symbol) ?? 0));
      turnoverTotal += turnover / 2;
      equity *= 1 - (turnover * strategy.costBps) / 10_000;
      for (const symbol of chosen) {
        if (!open.has(symbol)) {
          open.set(symbol, { symbol, entryDate: panel.dates[index], entryPrice: point(symbol, index)?.price ?? 0, exitDate: null, exitPrice: null, return: null, months: 0, reason: null });
        }
      }
      weights = target;
    }

    // Hold from this month-end to the next.
    let portfolioReturn = 0;
    const grown = new Map<string, number>();
    for (const [symbol, weight] of weights) {
      const from = point(symbol, index)?.price ?? lastPrice(symbol, index);
      const to = point(symbol, index + 1)?.price;
      const r = from && to ? to / from - 1 : 0;
      portfolioReturn += weight * r;
      grown.set(symbol, weight * (1 + r));
    }
    const cash = 1 - [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    const grownTotal = [...grown.values()].reduce((sum, weight) => sum + weight, 0) + cash;
    weights = new Map([...grown].map(([symbol, weight]) => [symbol, grownTotal > 0 ? weight / grownTotal : 0]));
    if (grown.size) investedMonths += 1;
    positions.push(grown.size);
    equity *= 1 + portfolioReturn;

    const b0 = panel.benchmark[index];
    const b1 = panel.benchmark[index + 1];
    if (b0 && b1) bench *= b1 / b0;
    else benchmarkMissing = true;

    const universeReturns: number[] = [];
    for (const symbol of symbols) {
      if (!eligible(symbol, index)) continue;
      const from = point(symbol, index)?.price;
      const to = point(symbol, index + 1)?.price;
      if (from && to) universeReturns.push(to / from - 1);
    }
    universe *= 1 + (universeReturns.length ? mean(universeReturns) : 0);

    dates.push(panel.dates[index + 1]);
    equityCurve.push(equity);
    benchmarkCurve.push(bench);
    universeCurve.push(universe);
  }

  const openPositions = [...open.values()].map((trade) => {
    const current = lastPrice(trade.symbol, endIndex);
    return { ...trade, exitPrice: current, return: current !== null ? current / trade.entryPrice - 1 : null, months: monthsBetween(trade.entryDate, panel.dates[endIndex]) };
  });

  const strategyReturns = equityCurve.slice(1).map((value, i) => value / equityCurve[i] - 1);
  const benchmarkReturns = benchmarkCurve.slice(1).map((value, i) => value / benchmarkCurve[i] - 1);
  const stats = seriesStats(equityCurve, riskFree);
  const benchmarkStats = seriesStats(benchmarkCurve, riskFree);
  const benchmarkVariance = benchmarkMissing ? 0 : variance(benchmarkReturns);
  const beta = benchmarkVariance ? covariance(strategyReturns, benchmarkReturns) / benchmarkVariance : null;
  const downside = Math.sqrt(mean(strategyReturns.map((r) => Math.min(0, r - riskFree / 12) ** 2))) * Math.sqrt(12);

  let peak = equityCurve[0];
  let peakIndex = 0;
  let worst = 0;
  let from: string | null = null;
  let to: string | null = null;
  equityCurve.forEach((value, i) => {
    if (value > peak) {
      peak = value;
      peakIndex = i;
    }
    if (value / peak - 1 < worst) {
      worst = value / peak - 1;
      from = dates[peakIndex];
      to = dates[i];
    }
  });

  const closed = trades.filter((trade) => trade.return !== null);
  const years = strategyReturns.length / 12;

  const yearly = new Map<number, { strategy: number; benchmark: number; universe: number }>();
  for (let i = 1; i < dates.length; i += 1) {
    const year = Number(dates[i].slice(0, 4));
    const row = yearly.get(year) ?? { strategy: 1, benchmark: 1, universe: 1 };
    row.strategy *= equityCurve[i] / equityCurve[i - 1];
    row.benchmark *= benchmarkCurve[i] / benchmarkCurve[i - 1];
    row.universe *= universeCurve[i] / universeCurve[i - 1];
    yearly.set(year, row);
  }

  const picks = symbols
    .filter((symbol) => eligible(symbol, endIndex) && meetsEntry(symbol, endIndex))
    .sort(byRank(endIndex))
    .slice(0, strategy.maxPositions)
    .map((symbol) => {
      const current = point(symbol, endIndex) as PanelPoint;
      return { symbol, rank: rankValue(symbol, endIndex), overall: current.overall, momentum: current.sub.momentum ?? null, price: current.price };
    });

  return {
    dates,
    equity: equityCurve,
    benchmark: benchmarkCurve,
    universe: universeCurve,
    positions,
    stats: {
      ...stats,
      sortino: downside ? (stats.cagr - riskFree) / downside : null,
      beta,
      alpha: beta !== null ? stats.cagr - (riskFree + beta * (benchmarkStats.cagr - riskFree)) : null,
      hitRate: benchmarkMissing || !strategyReturns.length ? null : strategyReturns.filter((r, i) => r > benchmarkReturns[i]).length / strategyReturns.length,
      maxDrawdownFrom: from,
      maxDrawdownTo: to,
      avgPositions: positions.length ? mean(positions) : 0,
      turnover: years > 0 ? turnoverTotal / years : 0,
      exposure: positions.length ? investedMonths / positions.length : 0,
      trades: trades.length + openPositions.length,
      winRate: closed.length ? closed.filter((trade) => (trade.return ?? 0) > 0).length / closed.length : null,
      avgTradeReturn: closed.length ? mean(closed.map((trade) => trade.return as number)) : null,
      avgHoldMonths: closed.length ? mean(closed.map((trade) => trade.months)) : null,
    },
    benchmarkStats,
    universeStats: seriesStats(universeCurve, riskFree),
    yearly: [...yearly].map(([year, row]) => ({ year, strategy: row.strategy - 1, benchmark: benchmarkMissing ? null : row.benchmark - 1, universe: row.universe - 1 })),
    trades: trades.slice().reverse(),
    openPositions,
    picks,
    universeSize: symbols.length,
  };
}

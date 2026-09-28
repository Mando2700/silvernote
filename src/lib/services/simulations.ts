import 'server-only';

import { HttpError } from '@/lib/auth';
import type { Candle } from '@/lib/data/types';
import { annualizedReturn, beta, betaFromCloses, concentration, correlation } from '@/lib/finance/stats';
import { buildRiskModel, performanceHistory, portfolioReturns, riskStatistics, type Holding, type TransactionRow } from '@/lib/services/portfolio';
import { getCandles, getCandlesForMany, getIndexHistory } from '@/lib/services/prices';
import { getSecuritiesBySymbols } from '@/lib/services/universe';

export const SCENARIOS = [
  { id: 'gfc2008', name: '2008 financial crisis', start: '2007-10-09', end: '2009-03-09', description: 'Peak to trough of the global financial crisis, from the October 2007 high to the March 2009 low.' },
  { id: 'covid2020', name: '2020 COVID crash', start: '2020-02-19', end: '2020-03-23', description: 'The fastest bear market on record, from the February 2020 high to the March 23 low.' },
  { id: 'rates2022', name: '2022 rate shock', start: '2022-01-03', end: '2022-10-12', description: 'Inflation and rapid rate hikes; long-duration growth stocks were hit hardest.' },
] as const;

type Position = { symbol: string; value: number };
type Point = { t: number; c: number };

function toDay(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function windowOf(series: Point[], start: number, end: number) {
  const before = [...series].reverse().find((point) => point.t <= start) ?? null;
  const inside = series.filter((point) => point.t > start && point.t <= end);
  return before ? [before, ...inside] : inside;
}

async function marketSeries(start: string, end: string): Promise<{ series: Point[]; proxy: string }> {
  const spy = await getCandles('SPY', 10).catch(() => [] as Candle[]);
  if (spy.length && spy[0].t <= toDay(start) - 5 * 86_400) {
    return { series: spy.map((candle) => ({ t: candle.t, c: candle.c })), proxy: 'SPY (S&P 500 ETF)' };
  }
  // Nasdaq's free history covers ~10 years; older windows use FRED's NASDAQ Composite (1971→).
  const from = new Date(toDay(start) * 1000 - 20 * 86_400_000).toISOString().slice(0, 10);
  const series = await getIndexHistory('NASDAQCOM', from, end);
  return { series, proxy: 'NASDAQ Composite (FRED)' };
}

export async function runStressTests(positions: Position[]) {
  const live = positions.filter((position) => position.value > 0);
  const total = live.reduce((sum, position) => sum + position.value, 0);
  if (!total) return [];
  const histories = await getCandlesForMany(live.map((position) => position.symbol), 10);
  const spyRecent = await getCandles('SPY', 2).catch(() => [] as Candle[]);
  const betas = new Map<string, number>();
  for (const position of live) {
    const candles = histories.get(position.symbol) ?? [];
    const beta = candles.length && spyRecent.length ? betaFromCloses(candles.slice(-520), spyRecent) : null;
    betas.set(position.symbol, beta !== null && Number.isFinite(beta) ? Math.max(0, Math.min(3, beta)) : 1);
  }

  const results = [];
  for (const scenario of SCENARIOS) {
    const start = toDay(scenario.start);
    const end = toDay(scenario.end);
    const { series, proxy } = await marketSeries(scenario.start, scenario.end);
    const market = windowOf(series, start, end);
    if (market.length < 3) continue;
    const dates = market.map((point) => point.t);
    const marketPath = market.map((point) => point.c / market[0].c);

    const paths = live.map((position) => {
      const candles = histories.get(position.symbol) ?? [];
      const beta = betas.get(position.symbol) ?? 1;
      if (candles.length && candles[0].t <= start + 3 * 86_400) {
        const closes = new Map(candles.map((candle) => [candle.t, candle.c]));
        const base = [...candles].reverse().find((candle) => candle.t <= start)?.c ?? candles[0].c;
        let last = base;
        return {
          method: 'actual' as const,
          beta,
          values: dates.map((date) => {
            last = closes.get(date) ?? last;
            return last / base;
          }),
        };
      }
      // No price history this far back: replay the market move scaled by the stock's beta.
      let level = 1;
      return {
        method: 'beta' as const,
        beta,
        values: marketPath.map((value, index) => {
          if (index === 0) return 1;
          level *= 1 + beta * (value / marketPath[index - 1] - 1);
          return Math.max(0, level);
        }),
      };
    });

    const holdings = live.map((position, index) => {
      const weight = position.value / total;
      const holdingReturn = paths[index].values[paths[index].values.length - 1] - 1;
      return { symbol: position.symbol, weight, return: holdingReturn, contribution: weight * holdingReturn, method: paths[index].method, beta: paths[index].beta };
    });
    const portfolioPath = dates.map((_, day) => paths.reduce((sum, path, index) => sum + holdings[index].weight * path.values[day], 0));
    let peak = portfolioPath[0];
    let worstDrawdown = 0;
    let worstDay = 0;
    for (let index = 1; index < portfolioPath.length; index += 1) {
      peak = Math.max(peak, portfolioPath[index]);
      worstDrawdown = Math.min(worstDrawdown, portfolioPath[index] / peak - 1);
      worstDay = Math.min(worstDay, portfolioPath[index] / portfolioPath[index - 1] - 1);
    }
    results.push({
      ...scenario,
      proxy,
      portfolioReturn: portfolioPath[portfolioPath.length - 1] - 1,
      marketReturn: marketPath[marketPath.length - 1] - 1,
      maxDrawdown: worstDrawdown,
      worstDay,
      dollarImpact: total * (portfolioPath[portfolioPath.length - 1] - 1),
      holdings: holdings.sort((a, b) => a.contribution - b.contribution),
      path: dates.map((date, index) => ({ t: date, portfolio: portfolioPath[index], market: marketPath[index] })),
    });
  }
  return results;
}

type SimPosition = { symbol: string; marketValue: number; sector: string | null };

/** Risk, concentration, sector mix and stress results for a set of positions plus cash. */
async function describePositions(positions: SimPosition[], cash: number, benchmark: string, riskFree: number) {
  const live = positions.filter((position) => position.marketValue > 0);
  const model = await buildRiskModel(live, benchmark, 252 * 2);
  const stats = riskStatistics(model, riskFree);
  const total = live.reduce((sum, position) => sum + position.marketValue, 0) + cash;
  const sectors = new Map<string, number>();
  for (const position of live) sectors.set(position.sector ?? 'Other', (sectors.get(position.sector ?? 'Other') ?? 0) + position.marketValue);
  const stress = await runStressTests(live.map((position) => ({ symbol: position.symbol, value: position.marketValue })));
  const summary = {
    total,
    stats: stats
      ? {
          annualReturn: stats.annualReturn,
          volatility: stats.volatility,
          beta: stats.beta,
          sharpe: stats.sharpe,
          sortino: stats.sortino,
          maxDrawdown: stats.maxDrawdown,
          var95: stats.var95?.historical ?? null,
        }
      : null,
    concentration: concentration(live.map((position) => position.marketValue)),
    sectors: [...sectors.entries()].map(([sector, value]) => ({ sector, weight: total ? value / total : 0 })).sort((a, b) => b.weight - a.weight),
    stress: stress.map((scenario) => ({ id: scenario.id, name: scenario.name, portfolioReturn: scenario.portfolioReturn, maxDrawdown: scenario.maxDrawdown })),
    excluded: model.excluded,
  };
  return { summary, model, contributions: stats?.contributions ?? [] };
}

/** Long-run equity risk premium over cash used for the market-implied (CAPM) expected return. */
const EQUITY_PREMIUM = 0.05;
/** Share of the blended expected return that comes from this portfolio's own history. */
const HISTORY_WEIGHT = 0.25;

/** Monte Carlo inputs: up to 10 years of aligned daily returns of the positions, and expected-return anchors. */
export async function monteCarloModel(positions: Array<{ symbol: string; marketValue: number }>, benchmark: string, totalValue: number, riskFree: number) {
  const model = await buildRiskModel(positions, benchmark, 252 * 10);
  const returns = portfolioReturns(model);
  const rawBeta = model.benchmark ? beta(returns, model.benchmark.returns) : null;
  const portfolioBeta = rawBeta !== null && Number.isFinite(rawBeta) ? rawBeta : 1;
  // Cash and bonds are held flat in the simulation, so only the invested share earns a return.
  const invested = positions.reduce((sum, position) => sum + Math.max(0, position.marketValue), 0);
  const investedShare = totalValue > 0 ? Math.min(1, invested / totalValue) : 1;
  const impliedReturn = investedShare * (riskFree + portfolioBeta * EQUITY_PREMIUM);
  const historicalReturn = investedShare * annualizedReturn(returns);
  return {
    symbols: model.symbols,
    weights: model.weights,
    returns: model.returns,
    benchmark: model.benchmark?.symbol ?? null,
    days: model.dates.length,
    from: model.dates[0] ?? null,
    excluded: model.excluded,
    backfilled: model.backfilled,
    riskFree,
    beta: portfolioBeta,
    impliedReturn,
    historicalReturn,
    blendedReturn: (1 - HISTORY_WEIGHT) * impliedReturn + HISTORY_WEIGHT * historicalReturn,
  };
}

export type SimFunding = 'new_money' | 'cash' | 'trim';

/**
 * Apply several dollar buys (positive) / sells (negative) to the holdings. Funding: `new_money` adds the net buys
 * on top, `cash` draws them from the portfolio's cash, `trim` sells the untouched holdings pro rata so the total
 * stays the same.
 */
export async function applyChanges(holdings: Holding[], cash: number, changes: Array<{ symbol: string; amount: number }>, funding: SimFunding = 'new_money') {
  const merged = new Map<string, number>();
  for (const change of changes) merged.set(change.symbol.toUpperCase(), (merged.get(change.symbol.toUpperCase()) ?? 0) + change.amount);
  const securities = await getSecuritiesBySymbols([...merged.keys()]);
  const sectorOf = new Map(securities.map((security) => [security.symbol, security.sector ?? null]));

  const before: SimPosition[] = holdings.map((holding) => ({ symbol: holding.symbol, marketValue: holding.marketValue, sector: holding.sector }));
  const after = before.map((position) => ({ ...position }));
  const notes: string[] = [];
  for (const [symbol, amount] of merged) {
    const existing = after.find((position) => position.symbol === symbol);
    if (existing) {
      if (amount < 0 && -amount > existing.marketValue) notes.push(`Sell of ${symbol} capped at the full position.`);
      existing.marketValue = Math.max(0, existing.marketValue + amount);
    } else if (amount > 0) {
      after.push({ symbol, marketValue: amount, sector: sectorOf.get(symbol) ?? null });
    } else {
      notes.push(`${symbol} isn't held, so the sell was ignored.`);
    }
  }
  const valueOf = (positions: SimPosition[]) => positions.reduce((sum, position) => sum + position.marketValue, 0);
  const net = valueOf(after) - valueOf(before);
  let cashAfter = cash;
  if (funding === 'cash') {
    cashAfter = cash - net;
    if (cashAfter < 0) notes.push(`Needs ${Math.round(net)} but only ${Math.round(cash)} cash: cash goes negative (margin).`);
  } else if (funding === 'trim' && net !== 0) {
    const untouched = after.filter((position) => !merged.has(position.symbol));
    const pool = valueOf(untouched);
    if (net > pool) notes.push('Not enough in untouched holdings to fund the buys by trimming; the rest is treated as new money.');
    const scale = pool > 0 ? Math.max(0, 1 - net / pool) : 1;
    for (const position of untouched) position.marketValue *= scale;
  }
  return { merged, sectorOf, before, after, net, cashAfter, notes };
}

/** Apply changes (see `applyChanges`) and compare the portfolio before and after. */
export async function simulateChanges(
  holdings: Holding[],
  cash: number,
  benchmark: string,
  riskFree: number,
  changes: Array<{ symbol: string; amount: number }>,
  funding: SimFunding = 'new_money',
) {
  const { merged, sectorOf, before, after, net, cashAfter, notes } = await applyChanges(holdings, cash, changes, funding);
  const [baseline, proposed] = await Promise.all([describePositions(before, cash, benchmark, riskFree), describePositions(after, cashAfter, benchmark, riskFree)]);

  // How each changed name moves with the rest of the portfolio as it stands today (excluding itself), and its
  // share of risk after the change. Returns come from one model over every symbol involved.
  const union = [...new Set([...before, ...after].map((position) => position.symbol))];
  const model = await buildRiskModel(union.map((symbol) => ({ symbol, marketValue: 1 })), benchmark, 252 * 2);
  const baseValue = new Map(before.map((position) => [position.symbol, position.marketValue]));
  const restReturns = (exclude: string) => {
    const weights = model.symbols.map((symbol) => (symbol === exclude ? 0 : (baseValue.get(symbol) ?? 0)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return total ? portfolioReturns({ weights: weights.map((weight) => weight / total), returns: model.returns }) : [];
  };
  const positionsAfter = new Map(after.map((position) => [position.symbol, position.marketValue]));
  const changed = [...merged.entries()].map(([symbol, amount]) => {
    const index = model.symbols.indexOf(symbol);
    const rest = index >= 0 ? restReturns(symbol) : [];
    const contribution = proposed.contributions.find((item) => item.symbol === symbol);
    return {
      symbol,
      amount,
      sector: sectorOf.get(symbol) ?? before.find((position) => position.symbol === symbol)?.sector ?? null,
      weightBefore: baseline.summary.total ? (baseValue.get(symbol) ?? 0) / baseline.summary.total : 0,
      weightAfter: proposed.summary.total ? (positionsAfter.get(symbol) ?? 0) / proposed.summary.total : 0,
      correlationToPortfolio: rest.length ? correlation(model.returns[index], rest) : null,
      volatility: contribution?.volatility ?? null,
      beta: contribution?.beta ?? null,
      riskContribution: contribution?.contribution ?? null,
    };
  });

  return {
    funding,
    netFlow: net,
    cashBefore: cash,
    cashAfter,
    changes: changed,
    positionsAfter: after.filter((position) => position.marketValue > 0).map((position) => ({ ...position, weight: proposed.summary.total ? position.marketValue / proposed.summary.total : 0 })),
    baseline: baseline.summary,
    proposed: proposed.summary,
    notes,
  };
}

/** Compare risk, concentration, sectors and stress results before and after adding a position. */
export async function whatIf(
  holdings: Holding[],
  cash: number,
  benchmark: string,
  riskFree: number,
  add: { symbol: string; amount: number; date?: string | null },
  transactions: TransactionRow[] = [],
) {
  const symbol = add.symbol.toUpperCase();
  const [security] = await getSecuritiesBySymbols([symbol]);
  const past = add.date ? await pastPurchase(symbol, add.amount, add.date) : null;
  // A past purchase is worth what it grew into; a purchase today is worth what was paid.
  const addedValue = past ? past.valueNow : add.amount;
  const before = holdings.map((holding) => ({ symbol: holding.symbol, marketValue: holding.marketValue, sector: holding.sector }));
  const after = before.map((holding) => ({ ...holding }));
  const existing = after.find((holding) => holding.symbol === symbol);
  if (existing) existing.marketValue += addedValue;
  else after.push({ symbol, marketValue: addedValue, sector: security?.sector ?? null });

  const describe = async (positions: typeof before) => (await describePositions(positions, cash, benchmark, riskFree)).summary;

  const [baseline, proposed, history] = await Promise.all([describe(before), describe(after), past ? performanceSince(transactions, benchmark, symbol, past) : null]);
  return { symbol, name: security?.name ?? symbol, amount: add.amount, purchase: past ? { ...past, history } : null, baseline, proposed };
}

type PastPurchase = { date: string; price: number; shares: number; lastPrice: number; valueNow: number; gain: number; return: number };

/** Buy `amount` dollars at the close of the first session on or after `date` (prices are split-adjusted). */
async function pastPurchase(symbol: string, amount: number, date: string): Promise<PastPurchase> {
  const years = Math.min(10, (Date.now() - Date.parse(date)) / (365.25 * 86_400_000) + 0.1);
  const candles = await getCandles(symbol, Math.max(0.3, years));
  const start = toDay(date);
  const entry = candles.find((candle) => candle.t >= start);
  const last = candles[candles.length - 1];
  if (!entry || !last) throw new HttpError(400, `No ${symbol} price history on or after ${date}.`);
  const shares = amount / entry.c;
  const valueNow = shares * last.c;
  return {
    date: new Date(entry.t * 1000).toISOString().slice(0, 10),
    price: entry.c,
    shares,
    lastPrice: last.c,
    valueNow,
    gain: valueNow - amount,
    return: valueNow / amount - 1,
  };
}

/** Actual performance since the purchase date next to the same ledger with the extra buy booked. */
async function performanceSince(transactions: TransactionRow[], benchmark: string, symbol: string, purchase: PastPurchase) {
  const extra: TransactionRow = {
    id: 'whatif',
    portfolio_id: transactions[0]?.portfolio_id ?? '',
    symbol,
    side: 'buy',
    quantity: purchase.shares,
    price: purchase.price,
    fees: 0,
    traded_at: purchase.date,
    note: null,
    created_at: new Date(`${purchase.date}T23:59:59Z`),
    broker_execution_id: null,
    kind: 'trade',
    split_factor: 1,
  };
  const [actual, proposed] = await Promise.all([performanceHistory(transactions, benchmark), performanceHistory([...transactions, extra], benchmark)]);
  const from = toDay(purchase.date);
  const byDay = new Map(actual.map((point) => [point.t, point]));
  const points = proposed.filter((point) => point.t >= from).map((point) => ({ t: point.t, proposed: point, actual: byDay.get(point.t) ?? null }));
  if (!points.length) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const since = (end: { twr: number } | null, start: { twr: number } | null) => (end && start && start.twr ? end.twr / start.twr - 1 : null);
  // The first day's return is measured from the prior close so the purchase day itself counts.
  const prior = proposed[proposed.indexOf(first.proposed) - 1] ?? first.proposed;
  const priorActual = byDay.get(prior.t) ?? first.actual;
  return {
    benchmark,
    actualReturn: since(last.actual, priorActual),
    proposedReturn: since(last.proposed, prior),
    benchmarkReturn: last.proposed.benchmark / prior.benchmark - 1,
    actualValue: last.actual?.value ?? 0,
    proposedValue: last.proposed.value,
    points: points.map((point) => ({
      t: point.t,
      actual: point.actual && priorActual ? (point.actual.twr / priorActual.twr - 1) * 100 : 0,
      proposed: (point.proposed.twr / prior.twr - 1) * 100,
      benchmark: (point.proposed.benchmark / prior.benchmark - 1) * 100,
    })),
  };
}

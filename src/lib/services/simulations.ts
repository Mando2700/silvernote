import 'server-only';

import type { Candle } from '@/lib/data/types';
import { betaFromCloses, concentration } from '@/lib/finance/stats';
import { buildRiskModel, riskStatistics, type Holding } from '@/lib/services/portfolio';
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

/** Compare risk, concentration, sectors and stress results before and after adding a position. */
export async function whatIf(holdings: Holding[], cash: number, benchmark: string, riskFree: number, add: { symbol: string; amount: number }) {
  const symbol = add.symbol.toUpperCase();
  const [security] = await getSecuritiesBySymbols([symbol]);
  const before = holdings.map((holding) => ({ symbol: holding.symbol, marketValue: holding.marketValue, sector: holding.sector }));
  const after = before.map((holding) => ({ ...holding }));
  const existing = after.find((holding) => holding.symbol === symbol);
  if (existing) existing.marketValue += add.amount;
  else after.push({ symbol, marketValue: add.amount, sector: security?.sector ?? null });

  const describe = async (positions: typeof before) => {
    const model = await buildRiskModel(positions, benchmark, 252 * 2);
    const stats = riskStatistics(model, riskFree);
    const total = positions.reduce((sum, position) => sum + position.marketValue, 0) + cash;
    const sectors = new Map<string, number>();
    for (const position of positions) sectors.set(position.sector ?? 'Other', (sectors.get(position.sector ?? 'Other') ?? 0) + position.marketValue);
    const stress = await runStressTests(positions.map((position) => ({ symbol: position.symbol, value: position.marketValue })));
    return {
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
      concentration: concentration(positions.map((position) => position.marketValue)),
      sectors: [...sectors.entries()].map(([sector, value]) => ({ sector, weight: total ? value / total : 0 })).sort((a, b) => b.weight - a.weight),
      stress: stress.map((scenario) => ({ id: scenario.id, name: scenario.name, portfolioReturn: scenario.portfolioReturn, maxDrawdown: scenario.maxDrawdown })),
      excluded: model.excluded,
    };
  };

  const [baseline, proposed] = await Promise.all([describe(before), describe(after)]);
  return { symbol, name: security?.name ?? symbol, amount: add.amount, baseline, proposed };
}

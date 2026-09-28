import { describe, expect, it } from 'vitest';

import {
  annualizedVolatility,
  backfillReturns,
  beta,
  cholesky,
  concentration,
  correlation,
  dailyReturns,
  equityCurve,
  maxDrawdown,
  mean,
  sharpe,
  stdev,
  valueAtRisk,
} from './stats';

describe('basic statistics', () => {
  it('computes mean and sample standard deviation', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it('measures correlation and beta', () => {
    const market = [0.01, -0.02, 0.015, 0.005, -0.01, 0.02];
    const levered = market.map((value) => value * 2);
    expect(correlation(market, levered)).toBeCloseTo(1, 10);
    expect(correlation(market, market.map((value) => -value))).toBeCloseTo(-1, 10);
    expect(beta(levered, market)).toBeCloseTo(2, 10);
  });

  it('annualizes volatility with the square root of 252 trading days', () => {
    const returns = Array.from({ length: 100 }, (_, index) => (index % 2 ? 0.01 : -0.01));
    expect(annualizedVolatility(returns)).toBeCloseTo(stdev(returns) * Math.sqrt(252), 10);
  });

  it('gives a higher Sharpe ratio to steadier returns with the same mean', () => {
    const steady = Array.from({ length: 252 }, (_, index) => 0.001 + (index % 2 ? 0.002 : -0.002));
    const choppy = Array.from({ length: 252 }, (_, index) => 0.001 + (index % 2 ? 0.02 : -0.02));
    expect(sharpe(steady, 0.02)!).toBeGreaterThan(sharpe(choppy, 0.02)!);
  });
});

describe('drawdowns and returns', () => {
  it('turns closes into daily returns keyed by date', () => {
    const returns = dailyReturns([
      { t: 1, c: 100 },
      { t: 2, c: 110 },
      { t: 3, c: 99 },
    ]);
    expect(returns.get(2)).toBeCloseTo(0.1, 10);
    expect(returns.get(3)).toBeCloseTo(-0.1, 10);
  });

  it('finds the deepest peak-to-trough fall and where it happened', () => {
    const curve = [1, 1.2, 0.9, 1.1, 0.6, 1.5];
    const result = maxDrawdown(curve);
    expect(result.value).toBeCloseTo(0.6 / 1.2 - 1, 10);
    expect(result.peakIndex).toBe(1);
    expect(result.troughIndex).toBe(4);
  });

  it('compounds returns into an equity curve', () => {
    expect(equityCurve([0.1, -0.5])).toEqual([1, 1.1, 0.55]);
  });
});

describe('risk measures', () => {
  it('reports value at risk as a positive loss', () => {
    const returns = Array.from({ length: 100 }, (_, index) => (index - 50) / 1000); // −5% … +4.9%
    const var95 = valueAtRisk(returns, 0.95);
    expect(var95).not.toBeNull();
    expect(var95!.historical).toBeGreaterThan(0.04);
    expect(var95!.historical).toBeLessThan(0.05);
    expect(var95!.expectedShortfall).toBeGreaterThanOrEqual(var95!.historical);
  });

  it('needs at least 20 observations for value at risk', () => {
    expect(valueAtRisk([0.01, -0.02])).toBeNull();
  });

  it('measures concentration with the Herfindahl index', () => {
    const equal = concentration([1, 1, 1, 1]);
    expect(equal.hhi).toBeCloseTo(0.25, 10);
    expect(equal.effectiveN).toBeCloseTo(4, 10);
    const lopsided = concentration([7, 1, 1, 1]);
    expect(lopsided.top1).toBeCloseTo(0.7, 10);
    expect(lopsided.effectiveN).toBeLessThan(2);
  });

  it('factors a covariance matrix so that L·Lᵀ rebuilds it', () => {
    const matrix = [
      [0.04, 0.012, 0.006],
      [0.012, 0.09, 0.018],
      [0.006, 0.018, 0.0625],
    ];
    const lower = cholesky(matrix);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const rebuilt = lower[row].reduce((sum, value, k) => sum + value * lower[col][k], 0);
        expect(rebuilt).toBeCloseTo(matrix[row][col], 12);
      }
    }
  });
});

describe('backfillReturns', () => {
  it('fills pre-listing days from beta × benchmark without extending the short sample alpha', () => {
    const market = new Map<number, number>();
    for (let day = 1; day <= 200; day += 1) market.set(day, day % 2 ? 0.01 : -0.01);
    const young = new Map<number, number>();
    // Listed on day 141: 2× the market plus a hot +1%/day run.
    for (let day = 141; day <= 200; day += 1) young.set(day, 2 * (market.get(day) as number) + 0.01);
    const old = new Map(market);

    const { dates, matrix, firstReal } = backfillReturns([old, young], market);
    expect(dates).toHaveLength(200);
    expect(firstReal).toEqual([0, 140]);
    expect(matrix[1].slice(140)).toEqual([...young.values()]);
    const early = matrix[1].slice(0, 140);
    early.forEach((value, index) => expect(value).toBeCloseTo(2 * (market.get(index + 1) as number), 10));
  });
});

describe('multi-day value-at-risk', () => {
  it('scales volatility by √days and the mean by days', () => {
    const returns = Array.from({ length: 200 }, (_, index) => (index % 2 ? 0.012 : -0.008));
    const one = valueAtRisk(returns, 0.95, 1)!;
    const ten = valueAtRisk(returns, 0.95, 10)!;
    const sd = one.parametric + 0.002; // z·σ, since the mean daily return is 0.002
    expect(ten.parametric).toBeCloseTo(sd * Math.sqrt(10) - 0.002 * 10, 10);
  });
});

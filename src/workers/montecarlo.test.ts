import { describe, expect, it } from 'vitest';

import { simulate, type MonteCarloInput } from './montecarlo.worker';

const base: MonteCarloInput = {
  weights: [1],
  returns: [Array.from({ length: 504 }, () => 0.0004)],
  startValue: 10_000,
  monthlyContribution: 0,
  years: 1,
  simulations: 400,
  method: 'bootstrap',
  seed: 7,
};

describe('Monte Carlo simulate', () => {
  it('compounds a constant daily return exactly', () => {
    const result = simulate(base);
    const expected = 10_000 * 1.0004 ** 252;
    expect(result.months).toBe(12);
    expect(result.percentiles.p5.at(-1)).toBeCloseTo(expected, 6);
    expect(result.percentiles.p95.at(-1)).toBeCloseTo(expected, 6);
    expect(result.probabilityOfLoss).toBe(0);
    expect(result.medianMaxDrawdown).toBe(0);
  });

  it('is reproducible for a given seed', () => {
    const noisy: MonteCarloInput = { ...base, returns: [Array.from({ length: 504 }, (_, day) => Math.sin(day * 1.7) * 0.02 + 0.0003)] };
    expect(simulate(noisy).finalValues).toEqual(simulate(noisy).finalValues);
    expect(simulate({ ...noisy, seed: 8 }).finalValues).not.toEqual(simulate(noisy).finalValues);
  });

  it('keeps percentile bands ordered and counts contributions', () => {
    const result = simulate({ ...base, method: 'normal', returns: [Array.from({ length: 504 }, (_, day) => Math.sin(day) * 0.015 + 0.0003)], monthlyContribution: 500, years: 5 });
    const last = result.months;
    expect(result.percentiles.p5[last]).toBeLessThan(result.percentiles.p50[last]);
    expect(result.percentiles.p50[last]).toBeLessThan(result.percentiles.p95[last]);
    expect(result.contributions[last]).toBe(10_000 + 500 * 60);
    expect(Number.isNaN(result.medianCagr)).toBe(true);
  });

  it('re-centres the expected return when one is given', () => {
    const flat = { ...base, returns: [Array.from({ length: 504 }, (_, day) => (day % 2 ? 0.01 : -0.0099))] };
    const target = simulate({ ...flat, annualReturn: 0.12, simulations: 4000, years: 10 });
    expect(target.medianCagr).toBeGreaterThan(0.08);
    expect(target.medianCagr).toBeLessThan(0.14);
  });
});

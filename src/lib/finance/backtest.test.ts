import { describe, expect, it } from 'vitest';

import { createEvaluator, runBacktest, type Panel, type PanelPoint, type Strategy } from './backtest';

const DATES = ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31', '2024-06-30', '2024-07-31'];

function pt(overall: number, price: number, momentum = 50, marketCap = 10e9): PanelPoint {
  return { overall, price, marketCap, sub: { momentum } };
}

/** A: high score, rising momentum, +10%/month. B: low score, flat. C: score crosses 80 in April, −5%/month after. */
function panel(): Panel {
  return {
    dates: DATES,
    series: new Map([
      ['AAA', DATES.map((_, i) => pt(85, 100 * 1.1 ** i, 40 + i * 5))],
      ['BBB', DATES.map(() => pt(40, 50, 60))],
      ['CCC', DATES.map((_, i) => pt(i >= 3 ? 90 : 60, i >= 3 ? 20 * 0.95 ** (i - 3) : 20, 50 + i, 2e9))],
      ['DDD', DATES.map((_, i) => (i < 2 ? null : pt(70, 10)))],
    ]),
    sectors: new Map([
      ['AAA', 'Technology'],
      ['BBB', 'Utilities'],
      ['CCC', 'Technology'],
      ['DDD', 'Energy'],
    ]),
    benchmark: DATES.map((_, i) => 400 * 1.01 ** i),
  };
}

const base: Strategy = { entry: [], exit: [], rebalance: 1, maxPositions: 10, rankBy: 'overall', weighting: 'equal', costBps: 0 };

describe('conditions', () => {
  it('evaluates thresholds, trends, returns and cross-sectional ranks', () => {
    const { test, value } = createEvaluator(panel(), {});
    expect(test('AAA', 2, { field: 'overall', op: 'gt', value: 80 })).toBe(true);
    expect(test('BBB', 2, { field: 'overall', op: 'gt', value: 80 })).toBe(false);
    expect(test('AAA', 2, { field: 'momentum', op: 'rising' })).toBe(true);
    expect(test('AAA', 2, { field: 'momentum', op: 'rising', value: 6 })).toBe(false);
    expect(test('AAA', 0, { field: 'momentum', op: 'rising' })).toBe(false);
    expect(value('AAA', 3, 'return3m')).toBeCloseTo(0.331);
    expect(test('AAA', 3, { field: 'overall', op: 'top', value: 25 })).toBe(false);
    expect(test('CCC', 3, { field: 'overall', op: 'top', value: 25 })).toBe(true);
    expect(test('BBB', 3, { field: 'overall', op: 'bottom', value: 25 })).toBe(true);
    expect(test('DDD', 1, { field: 'overall', op: 'gt', value: 0 })).toBe(false);
  });

  it('applies universe filters', () => {
    const { eligible } = createEvaluator(panel(), { minMarketCap: 5, sectors: ['Technology'] });
    expect(eligible('AAA', 0)).toBe(true);
    expect(eligible('CCC', 0)).toBe(false);
    expect(eligible('BBB', 0)).toBe(false);
  });
});

describe('runBacktest', () => {
  it('holds names that meet the rules and compounds their returns', () => {
    const result = runBacktest(panel(), { ...base, entry: [{ field: 'overall', op: 'gt', value: 80 }, { field: 'momentum', op: 'rising' }] });
    // Month 0 has no prior momentum, so the first holding starts at month 1 and earns 10% a month for 5 months.
    expect(result.positions).toEqual([0, 1, 1, 2, 2, 2]);
    expect(result.dates).toHaveLength(7);
    expect(result.benchmark.at(-1)).toBeCloseTo(1.01 ** 6);
    expect(result.picks.map((pick) => pick.symbol)).toEqual(['CCC', 'AAA']);
    // AAA alone for Feb→Apr, then AAA+CCC half-half.
    const expected = 1.1 * 1.1 * ((1.1 + 0.95) / 2) ** 3;
    expect(result.equity.at(-1)).toBeCloseTo(expected, 1);
  });

  it('uses exit rules and records trades', () => {
    const result = runBacktest(panel(), { ...base, entry: [{ field: 'overall', op: 'gt', value: 50 }], exit: [{ field: 'return1m', op: 'lt', value: 0 }] });
    const exited = result.trades.find((trade) => trade.symbol === 'CCC');
    expect(exited?.reason).toBe('Exit rule');
    expect(exited?.exitDate).toBe('2024-05-31');
    expect(result.openPositions.map((trade) => trade.symbol).sort()).toEqual(['AAA', 'DDD']);
  });

  it('caps positions by rank and charges trading costs', () => {
    const free = runBacktest(panel(), { ...base, maxPositions: 1 });
    const costly = runBacktest(panel(), { ...base, maxPositions: 1, costBps: 100 });
    expect(Math.max(...free.positions)).toBe(1);
    expect(costly.equity.at(-1)).toBeLessThan(free.equity.at(-1) as number);
    expect(free.stats.turnover).toBeGreaterThan(0);
  });

  it('respects the window and rejects an empty one', () => {
    const result = runBacktest(panel(), { ...base, start: '2024-03-01', end: '2024-06-30' });
    expect(result.dates).toEqual(['2024-03-31', '2024-04-30', '2024-05-31', '2024-06-30']);
    expect(() => runBacktest(panel(), { ...base, start: '2030-01-01' })).toThrow();
  });

  it('reports risk statistics against the benchmark', () => {
    const result = runBacktest(panel(), { ...base, entry: [{ field: 'overall', op: 'gt', value: 80 }] });
    expect(result.stats.cagr).toBeGreaterThan(result.benchmarkStats.cagr);
    expect(result.stats.maxDrawdown).toBeLessThanOrEqual(0);
    expect(result.yearly).toHaveLength(1);
    expect(result.stats.hitRate).not.toBeNull();
  });
});

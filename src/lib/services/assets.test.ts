import { describe, expect, it } from 'vitest';

import { maxDrawdown, performance, volatility } from './assets';

const DAY = 86_400;
const bar = (t: number, c: number) => ({ t, o: c, h: c, l: c, c, v: null });

describe('performance', () => {
  const now = 400 * DAY;
  // One close a day, rising by 1 from 100.
  const candles = Array.from({ length: 401 }, (_, day) => bar(day * DAY, 100 + day));

  it('measures each horizon from the close at or before its start', () => {
    const byLabel = Object.fromEntries(performance(candles, now).map((period) => [period.label, period.value]));
    expect(byLabel['1W']).toBeCloseTo(500 / 493 - 1);
    expect(byLabel['1Y']).toBeCloseTo(500 / 135 - 1);
  });

  it('leaves out horizons older than the history', () => {
    const byLabel = Object.fromEntries(performance(candles, now).map((period) => [period.label, period.value]));
    expect(byLabel['3Y']).toBeNull();
  });
});

describe('volatility', () => {
  it('is zero for a steady compounding series', () => {
    const candles = Array.from({ length: 40 }, (_, day) => bar(day, 100 * 1.01 ** day));
    expect(volatility(candles, 30, 252)).toBeCloseTo(0);
  });
});

describe('maxDrawdown', () => {
  it('finds the deepest fall from a prior peak', () => {
    expect(maxDrawdown([bar(1, 100), bar(2, 120), bar(3, 90), bar(4, 130), bar(5, 117)])).toBeCloseTo(-0.25);
  });
});

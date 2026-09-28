import { describe, expect, it } from 'vitest';

import { aggregateCandles, resolutionForRange } from './candles';

const day = (iso: string, o: number, h: number, l: number, c: number, v: number | null = 10) => ({
  t: Date.parse(`${iso}T00:00:00Z`) / 1000,
  o,
  h,
  l,
  c,
  v,
});

describe('candle density', () => {
  it('uses daily bars up to a year, weekly for 3y, and monthly beyond', () => {
    expect(['1m', '3m', '6m', 'ytd', '1y'].map(resolutionForRange)).toEqual(['day', 'day', 'day', 'day', 'day']);
    expect(resolutionForRange('3y')).toBe('week');
    expect(['5y', '10y'].map(resolutionForRange)).toEqual(['month', 'month']);
  });

  it('rolls daily sessions into Monday-anchored weekly bars', () => {
    const daily = [
      day('2026-09-17', 10, 12, 9, 11), // Thursday
      day('2026-09-18', 11, 13, 10, 12), // Friday
      day('2026-09-21', 12, 15, 11, 14), // Monday
      day('2026-09-22', 14, 14, 8, 9, null),
    ];
    const weekly = aggregateCandles(daily, 'week');
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toEqual({ t: daily[0].t, o: 10, h: 13, l: 9, c: 12, v: 20 });
    expect(weekly[1]).toEqual({ t: daily[2].t, o: 12, h: 15, l: 8, c: 9, v: 10 });
    expect(daily[0].c).toBe(11);
  });

  it('rolls daily sessions into calendar-month bars', () => {
    const daily = [
      day('2026-08-28', 10, 12, 9, 11),
      day('2026-08-31', 11, 13, 10, 12),
      day('2026-09-02', 12, 15, 11, 14),
      day('2026-09-30', 14, 14, 8, 9, null),
    ];
    const monthly = aggregateCandles(daily, 'month');
    expect(monthly).toHaveLength(2);
    expect(monthly[0]).toEqual({ t: daily[0].t, o: 10, h: 13, l: 9, c: 12, v: 20 });
    expect(monthly[1]).toEqual({ t: daily[2].t, o: 12, h: 15, l: 8, c: 9, v: 10 });
  });
});

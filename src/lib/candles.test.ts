import { describe, expect, it } from 'vitest';

import { marketSession } from '@/lib/session';

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
  it('uses daily bars up to six months, weekly for 1y-3y, and monthly beyond', () => {
    expect(['1d', '1w', '1m', '3m', '6m', 'ytd'].map(resolutionForRange)).toEqual(['5m', '15m', '1h', 'halfday', 'day', 'day']);
    expect(['1y', '3y'].map(resolutionForRange)).toEqual(['2day', 'week']);
    expect(['5y', '10y'].map(resolutionForRange)).toEqual(['2week', 'month']);
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

describe('marketSession', () => {
  it('classifies New York wall-clock times', () => {
    expect(marketSession(Date.parse('2026-09-30T11:00:00Z'))).toBe('pre'); // 07:00 EDT
    expect(marketSession(Date.parse('2026-09-30T15:00:00Z'))).toBe('regular');
    expect(marketSession(Date.parse('2026-09-30T21:00:00Z'))).toBe('post');
    expect(marketSession(Date.parse('2026-09-30T02:00:00Z'))).toBe('closed');
    expect(marketSession(Date.parse('2026-10-03T15:00:00Z'))).toBe('closed'); // Saturday
  });
});

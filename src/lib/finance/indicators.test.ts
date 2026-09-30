import { describe, expect, it } from 'vitest';

import { bollinger, ema, macd, rsi, sma } from '@/lib/finance/indicators';

const bars = Array.from({ length: 60 }, (_, index) => ({ t: index, c: 100 + index }));

describe('indicators', () => {
  it('computes SMA and EMA on a straight line', () => {
    expect(sma(bars, 5)[0]).toEqual({ t: 4, value: 102 });
    expect(ema(bars, 5).at(-1)?.value).toBeCloseTo(157, 5); // EMA lags a linear trend by (n−1)/2 bars
  });
  it('RSI is 100 when prices only rise, ~50 when they alternate', () => {
    expect(rsi(bars).at(-1)?.value).toBe(100);
    const choppy = Array.from({ length: 60 }, (_, index) => ({ t: index, c: 100 + (index % 2) }));
    expect(rsi(choppy).at(-1)?.value).toBeGreaterThan(40);
    expect(rsi(choppy).at(-1)?.value).toBeLessThan(60);
  });
  it('Bollinger bands collapse on a flat series and MACD histogram is defined', () => {
    const flat = Array.from({ length: 30 }, (_, index) => ({ t: index, c: 50 }));
    const bands = bollinger(flat);
    expect(bands.upper.at(-1)?.value).toBe(50);
    expect(macd(bars).histogram.length).toBeGreaterThan(0);
  });
});

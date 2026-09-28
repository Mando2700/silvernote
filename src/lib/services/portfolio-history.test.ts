import { describe, expect, it, vi } from 'vitest';

import type { Candle } from '@/lib/data/types';

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
const bar = (iso: string, c: number): Candle => ({ t: day(iso), o: c, h: c, l: c, c, v: 0 });

const history = new Map<string, Candle[]>([
  ['SPY', [bar('2026-03-02', 100), bar('2026-03-03', 101), bar('2026-03-04', 102), bar('2026-03-05', 103)]],
  // A real +60% day on 03-04 must count; there is no bar on 03-03.
  ['MOON', [bar('2026-03-02', 10), bar('2026-03-04', 16), bar('2026-03-05', 16)]],
  // No history at all (e.g. a fund the price source doesn't carry).
  ['NOHIST', []],
]);

vi.mock('@/lib/services/prices', () => ({
  getCandlesForMany: vi.fn(async (symbols: string[]) => new Map(symbols.map((symbol) => [symbol, history.get(symbol) ?? []]))),
  getRiskFreeRate: vi.fn(async () => 0.04),
}));

const { buildPositions, performanceHistory } = await import('./portfolio');

const row = (symbol: string, side: 'buy' | 'sell', quantity: number, price: number, traded_at: string, kind: 'trade' | 'removal' = 'trade') => ({
  id: `${symbol}-${traded_at}-${side}`,
  portfolio_id: 'p',
  symbol,
  side,
  quantity,
  price,
  fees: 0,
  traded_at,
  note: null,
  created_at: new Date(`${traded_at}T12:00:00Z`),
  broker_execution_id: null,
  kind,
  split_factor: 1,
});

describe('performanceHistory', () => {
  it('keeps real moves above 50% in the time-weighted return', async () => {
    const points = await performanceHistory([row('MOON', 'buy', 10, 10, '2026-03-02')], 'SPY');
    expect(points.at(-1)?.twr).toBeCloseTo(160);
  });

  it('does not book a loss for a holding without price history', async () => {
    const points = await performanceHistory([row('MOON', 'buy', 10, 10, '2026-03-02'), row('NOHIST', 'buy', 5, 20, '2026-03-03')], 'SPY');
    const byDay = new Map(points.map((point) => [point.t, point]));
    // On 03-03 MOON has no bar (flat) and NOHIST is carried at its trade price: no change.
    expect(byDay.get(day('2026-03-03'))?.twr).toBeCloseTo(100);
  });

  it('treats a balancing removal as an outflow, not a loss', async () => {
    const points = await performanceHistory([row('MOON', 'buy', 10, 10, '2026-03-02'), row('MOON', 'sell', 5, 0, '2026-03-05', 'removal')], 'SPY');
    expect(points.at(-1)?.twr).toBeCloseTo(160);
  });
});

describe('buildPositions with balancing rows', () => {
  it('realizes nothing on a removal', () => {
    const positions = buildPositions([
      { symbol: 'A', side: 'buy', quantity: 10, price: 100, fees: 0, traded_at: '2026-01-02' },
      { symbol: 'A', side: 'sell', quantity: 4, price: 500, fees: 0, traded_at: '2026-02-02', kind: 'removal' },
    ]);
    expect(positions.get('A')).toMatchObject({ shares: 6, realized: 0 });
    expect(positions.get('A')?.cost).toBeCloseTo(600);
  });

  it('charges only the fees of the shares actually sold', () => {
    const positions = buildPositions([
      { symbol: 'B', side: 'buy', quantity: 4, price: 50, fees: 0, traded_at: '2026-01-02' },
      { symbol: 'B', side: 'sell', quantity: 8, price: 60, fees: 8, traded_at: '2026-01-05' },
    ]);
    expect(positions.get('B')?.realized).toBeCloseTo(36);
  });
});

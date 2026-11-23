import { describe, expect, it } from 'vitest';

import { buildPositions, realizedBySale } from './positions';

const trades = [
  { id: 'b1', symbol: 'AAPL', side: 'buy' as const, quantity: 10, price: 100, fees: 10, traded_at: '2025-01-02' },
  { id: 'b2', symbol: 'AAPL', side: 'buy' as const, quantity: 10, price: 120, fees: 0, traded_at: '2025-02-02' },
  { id: 's1', symbol: 'AAPL', side: 'sell' as const, quantity: 5, price: 150, fees: 5, traded_at: '2025-03-02' },
  { id: 'r1', symbol: 'AAPL', side: 'sell' as const, quantity: 5, price: 150, fees: 0, traded_at: '2025-04-02', kind: 'removal' as const },
  { id: 's2', symbol: 'AAPL', side: 'sell' as const, quantity: 20, price: 90, fees: 0, traded_at: '2025-05-02' },
];

describe('realizedBySale', () => {
  it('matches buildPositions realized P&L, per sell', () => {
    const sales = realizedBySale(trades);
    // Average cost 2210 / 20 = 110.5.
    expect(sales.get('s1')?.realized).toBeCloseTo(5 * 150 - 5 - 5 * 110.5);
    expect(sales.get('s1')?.costBasis).toBeCloseTo(552.5);
    expect(sales.has('r1')).toBe(false);
    // Only 10 shares left to sell.
    expect(sales.get('s2')?.realized).toBeCloseTo(10 * 90 - 10 * 110.5);
    const total = [...sales.values()].reduce((sum, sale) => sum + sale.realized, 0);
    expect(total).toBeCloseTo(buildPositions(trades).get('AAPL')!.realized);
  });
});

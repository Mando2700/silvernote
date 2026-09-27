import { describe, expect, it } from 'vitest';

import { buildPositions } from './portfolio';

const trade = (symbol: string, side: 'buy' | 'sell', quantity: number, price: number, traded_at: string, fees = 0) => ({ symbol, side, quantity, price, fees, traded_at });

describe('buildPositions (average cost)', () => {
  it('averages the cost of several buys, fees included', () => {
    const positions = buildPositions([trade('AAPL', 'buy', 10, 100, '2024-01-02', 1), trade('AAPL', 'buy', 10, 120, '2024-02-01', 1)]);
    const aapl = positions.get('AAPL')!;
    expect(aapl.shares).toBe(20);
    expect(aapl.cost).toBeCloseTo(2202, 10);
    expect(aapl.firstBought).toBe('2024-01-02');
  });

  it('realizes P&L against the running average cost on a partial sale', () => {
    const positions = buildPositions([
      trade('MSFT', 'buy', 10, 100, '2024-01-02'),
      trade('MSFT', 'buy', 10, 200, '2024-01-03'),
      trade('MSFT', 'sell', 5, 180, '2024-01-04', 2),
    ]);
    const msft = positions.get('MSFT')!;
    // Average cost 150: realized (180 − 150) × 5 − 2 fees.
    expect(msft.realized).toBeCloseTo(148, 10);
    expect(msft.shares).toBe(15);
    expect(msft.cost).toBeCloseTo(2250, 10);
  });

  it('closes the position cleanly and never sells more than it holds', () => {
    const positions = buildPositions([trade('NVDA', 'buy', 4, 50, '2024-01-02'), trade('NVDA', 'sell', 10, 60, '2024-01-05')]);
    const nvda = positions.get('NVDA')!;
    expect(nvda.shares).toBe(0);
    expect(nvda.cost).toBe(0);
    expect(nvda.realized).toBeCloseTo(40, 10);
  });

  it('applies trades in date order regardless of input order', () => {
    const positions = buildPositions([trade('XOM', 'sell', 5, 110, '2024-03-01'), trade('XOM', 'buy', 10, 100, '2024-01-02')]);
    const xom = positions.get('XOM')!;
    expect(xom.shares).toBe(5);
    expect(xom.realized).toBeCloseTo(50, 10);
  });
});

import { describe, expect, it } from 'vitest';

import { computePlTax, makeRateBefore } from '@/lib/finance/tax-pl';

const rates = makeRateBefore([
  { date: '2024-03-01', rate: 4.0 },
  { date: '2024-06-03', rate: 4.1 },
  { date: '2025-02-03', rate: 4.2 },
  { date: '2025-05-02', rate: 3.8 },
  { date: '2026-04-01', rate: 3.7 },
]);

describe('computePlTax', () => {
  it('uses FIFO, the rate from the business day before, and 19%', () => {
    const result = computePlTax(
      [
        { id: 'b1', symbol: 'X', side: 'buy', quantity: 10, price: 100, fees: 0, traded_at: '2024-03-04' },
        { id: 'b2', symbol: 'X', side: 'buy', quantity: 10, price: 200, fees: 0, traded_at: '2024-06-04' },
        { id: 's1', symbol: 'X', side: 'sell', quantity: 10, price: 150, fees: 0, traded_at: '2025-02-04' },
      ],
      rates,
    );
    // FIFO sells the $100 lot: proceeds 10·150·4.2 = 6300, cost 10·100·4.0 = 4000.
    expect(result.disposals[0]).toMatchObject({ bought: '2024-03-04', buyRate: 4.0, sellRate: 4.2 });
    expect(result.years[0]).toMatchObject({ year: 2025, incomePln: 2300, taxBasePln: 2300, taxPln: 437 });
  });

  it('carries losses forward at most 50% per year', () => {
    const result = computePlTax(
      [
        { id: 'b1', symbol: 'X', side: 'buy', quantity: 10, price: 100, fees: 0, traded_at: '2024-03-04' },
        { id: 's1', symbol: 'X', side: 'sell', quantity: 10, price: 50, fees: 0, traded_at: '2025-02-04' },
        { id: 'b2', symbol: 'Y', side: 'buy', quantity: 10, price: 100, fees: 0, traded_at: '2025-05-05' },
        { id: 's2', symbol: 'Y', side: 'sell', quantity: 10, price: 300, fees: 0, traded_at: '2026-04-02' },
      ],
      rates,
    );
    const loss = -(10 * 50 * 4.2 - 10 * 100 * 4.0); // 1900
    const y2026 = result.years.find((year) => year.year === 2026);
    expect(y2026?.lossDeductionPln).toBeCloseTo(loss / 2);
    expect(result.unusedLosses[0].left).toBeCloseTo(loss / 2);
  });
});

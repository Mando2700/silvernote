import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/providers/fx', () => ({
  usdPerUnit: vi.fn(async (currency: string) => ({ USD: 1, EUR: 1.1, PLN: 0.25 })[currency] ?? null),
}));

const { valueBond } = await import('./bonds');
const { cashInUsd } = await import('./ibkr');

describe('matured bonds', () => {
  it('keep their repaid face value in the portfolio until removed', () => {
    const bond = valueBond(
      {
        id: 'b', portfolio_id: 'p', name: 'T 4% 2025', cusip: null, kind: 'treasury', face: 10_000, coupon: 4, frequency: 2,
        maturity: '2025-06-30', purchase_date: '2023-06-30', purchase_price: 98, market_price: null, spread_bps: null,
        day_count: 'act/act', rating: null, note: null,
      },
      null,
      '2026-01-15',
    );
    expect(bond.matured).toBe(true);
    expect(bond.marketValue).toBeCloseTo(10_000);
    expect(bond.unrealized).toBeCloseTo(200);
  });
});

describe('IBKR cash', () => {
  it('converts each currency to USD and keeps a margin loan negative', async () => {
    expect((await cashInUsd({ cashByCurrency: { USD: -1000, EUR: 100, PLN: 400 }, baseCash: 0, baseCurrency: 'USD' })).cash).toBeCloseTo(-1000 + 110 + 100);
  });

  it('does not guess when a currency has no rate', async () => {
    expect(await cashInUsd({ cashByCurrency: { USD: 10, XYZ: 5 }, baseCash: null, baseCurrency: null })).toMatchObject({ cash: null });
  });

  it('converts a base-currency total when there are no per-currency rows', async () => {
    expect((await cashInUsd({ cashByCurrency: {}, baseCash: 1000, baseCurrency: 'EUR' })).cash).toBeCloseTo(1100);
  });
});

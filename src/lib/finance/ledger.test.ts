import { describe, expect, it } from 'vitest';

import { adjustForSplits, compareTrades, findOversells, newOversell, splitMultiplier, type DatedClose } from './ledger';

const trade = (id: string, side: 'buy' | 'sell', traded_at: string, quantity: number, created_at?: string) => ({ id, symbol: 'X', side, traded_at, quantity, created_at });

describe('replay order', () => {
  it('orders by date, then execution time, then buys before sells', () => {
    const rows = [
      trade('late-buy', 'buy', '2026-01-05', 1, '2026-01-05T15:00:00Z'),
      trade('early-sell', 'sell', '2026-01-05', 1, '2026-01-05T10:00:00Z'),
      trade('prior', 'buy', '2026-01-04', 1),
    ];
    expect([...rows].sort(compareTrades).map((row) => row.id)).toEqual(['prior', 'early-sell', 'late-buy']);
    expect([trade('s', 'sell', '2026-01-05', 1), trade('b', 'buy', '2026-01-05', 1)].sort(compareTrades).map((row) => row.id)).toEqual(['b', 's']);
  });
});

describe('oversells', () => {
  it('catches a sell dated before the shares were bought', () => {
    const ledger = [trade('buy', 'buy', '2026-03-01', 10), trade('sell', 'sell', '2026-02-01', 5)];
    expect(findOversells(ledger).map((entry) => entry.trade.id)).toEqual(['sell']);
  });

  it('only blocks oversells the change introduces', () => {
    const legacy = [trade('old-sell', 'sell', '2025-01-01', 3), trade('buy', 'buy', '2026-01-01', 10)];
    expect(newOversell(legacy, [...legacy, trade('ok', 'sell', '2026-02-01', 10)], (row) => row.id)).toBeNull();
    const deleting = [trade('buy', 'buy', '2026-01-01', 10), trade('sell', 'sell', '2026-02-01', 8)];
    expect(newOversell(deleting, deleting.slice(1), (row) => row.id)?.trade.id).toBe('sell');
  });
});

describe('splits', () => {
  // Split-adjusted closes around a 10-for-1 split on 2024-06-10.
  const closes: DatedClose[] = [
    { date: '2024-06-06', close: 121 },
    { date: '2024-06-07', close: 120.9 },
    { date: '2024-06-10', close: 121.8 },
  ];
  const splits = [{ date: '2024-06-10', factor: 10 }];

  it('restates a trade entered in pre-split shares', () => {
    expect(splitMultiplier({ price: 1209, traded_at: '2024-06-07' }, splits, closes)).toBe(10);
  });

  it('leaves a trade that was already entered in adjusted shares', () => {
    expect(splitMultiplier({ price: 120.9, traded_at: '2024-06-07', created_at: '2026-01-01T00:00:00Z' }, splits, closes)).toBe(1);
  });

  it('ignores trades after the split and spin-off style ratios', () => {
    expect(splitMultiplier({ price: 121.8, traded_at: '2024-06-10' }, splits, closes)).toBe(1);
    expect(splitMultiplier({ price: 100, traded_at: '2024-06-07' }, [{ date: '2024-06-10', factor: 1.061 }], closes)).toBe(1);
  });

  it('falls back to when the trade was entered when there is no price history', () => {
    expect(splitMultiplier({ price: 1209, traded_at: '2024-06-07', created_at: '2024-06-07T15:00:00Z' }, splits, undefined)).toBe(10);
    expect(splitMultiplier({ price: 120.9, traded_at: '2024-06-07', created_at: '2025-01-01T00:00:00Z' }, splits, undefined)).toBe(1);
  });

  it('keeps cost unchanged and never touches balancing rows', () => {
    const [raw, opening] = adjustForSplits(
      [
        { symbol: 'NVDA', quantity: 3, price: 1209, traded_at: '2024-06-07', kind: 'trade' as const },
        { symbol: 'NVDA', quantity: 30, price: 1209, traded_at: '2024-06-07', kind: 'opening' as const },
      ],
      () => splits,
      () => closes,
    );
    expect(raw).toMatchObject({ quantity: 30, price: 120.9, split_factor: 10 });
    expect(raw.quantity * raw.price).toBeCloseTo(3 * 1209);
    expect(opening).toMatchObject({ quantity: 30, price: 1209, split_factor: 1 });
  });

  it('infers a split from prices when the split history is unavailable', () => {
    const [raw, crash] = adjustForSplits(
      [
        { symbol: 'NVDA', quantity: 3, price: 1209, traded_at: '2024-06-07' },
        // Bought at twice the close on a day the stock halved: the prior close agrees with the price, so no split.
        { symbol: 'CRASH', quantity: 1, price: 100, traded_at: '2024-06-07' },
      ],
      () => null,
      (symbol) =>
        symbol === 'NVDA'
          ? closes
          : [
              { date: '2024-06-06', close: 101 },
              { date: '2024-06-07', close: 50 },
              { date: '2024-06-10', close: 49 },
            ],
    );
    expect(raw).toMatchObject({ quantity: 30, split_factor: 10 });
    expect(crash).toMatchObject({ quantity: 1, split_factor: 1 });
  });
});


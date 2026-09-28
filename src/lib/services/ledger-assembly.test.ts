import { describe, expect, it, vi } from 'vitest';

// CRWD split 4-for-1 on 2026-07-01; IBKR now reports 0.8 shares.
vi.mock('@/lib/db', () => ({
  q: vi.fn(async () => []),
  q1: vi.fn(async () => ({ positions: [{ symbol: 'CRWD', quantity: 0.8, costBasis: 700, costPrice: 875, markPrice: 400 }], positions_as_of: '2026-09-25' })),
}));
vi.mock('@/lib/services/splits', () => ({
  adjustTransactionsForSplits: vi.fn(async (rows: Array<{ symbol: string; quantity: number; price: number; traded_at: string; kind?: string }>) =>
    rows.map((row) =>
      row.symbol === 'CRWD' && row.kind === 'trade' && row.traded_at < '2026-07-01'
        ? { ...row, quantity: row.quantity * 4, price: row.price / 4, split_factor: 4 }
        : { ...row, split_factor: 1 },
    ),
  ),
}));

const { assembleLedger, buildPositions } = await import('./portfolio');

const stored = (id: string, quantity: number, price: number, traded_at: string, broker_execution_id: string | null) => ({
  id,
  portfolio_id: 'p',
  symbol: 'CRWD',
  side: 'buy' as const,
  quantity,
  price,
  fees: 0,
  traded_at,
  note: null,
  created_at: new Date(`${traded_at}T15:00:00Z`),
  broker_execution_id,
  kind: (broker_execution_id?.startsWith('ibkr:balance:') ? 'opening' : 'trade') as 'trade' | 'opening',
});

describe('assembleLedger', () => {
  it('derives balancing rows from the broker snapshot after the split adjustment, ignoring stale stored ones', async () => {
    const ledger = await assembleLedger('p', [
      stored('a', 0.2, 3500, '2026-05-06', 'ibkr:trade:1'),
      // Booked by a sync that couldn't see the split: 0.6 extra shares that don't exist.
      stored('b', 0.6, 875, '2026-05-05', 'ibkr:balance:open:CRWD'),
    ]);
    expect(ledger.map((row) => row.id)).toEqual(['a']);
    expect(buildPositions(ledger).get('CRWD')?.shares).toBeCloseTo(0.8);
  });

  it('books an opening when the synced history holds fewer shares than the broker', async () => {
    const ledger = await assembleLedger('p', [stored('a', 0.1, 3500, '2026-05-06', 'ibkr:trade:1')]);
    const opening = ledger.find((row) => row.kind === 'opening');
    expect(opening).toMatchObject({ id: 'balance:open:CRWD', quantity: expect.closeTo(0.4, 6) });
    const position = buildPositions(ledger).get('CRWD');
    expect(position?.shares).toBeCloseTo(0.8);
    expect(position?.cost).toBeCloseTo(700);
  });
});

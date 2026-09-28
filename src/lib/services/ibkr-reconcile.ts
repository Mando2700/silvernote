import type { FlexPosition } from '@/lib/data/providers/ibkr';
import { buildPositions, type PositionInput } from '@/lib/finance/positions';

type Tx = PositionInput;
export type Adjustment = { symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; tradedAt: string; kind: 'open' | 'adjust' };

const EPSILON = 1e-6;

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * `transactions` must be in today's share units (restated for splits), like the IBKR positions.
 *
 * Flex statements only reach back a year, so trade history alone rarely rebuilds the real account.
 * Book the gap as synthetic rows: an opening buy before the first trade (priced so the average-cost
 * basis lands on IBKR's reported cost basis), or a closing sell when the history holds more than IBKR.
 * After these rows, every symbol's shares equal the IBKR position.
 */
export function reconcile(transactions: Tx[], positions: FlexPosition[], asOf: string): Adjustment[] {
  const earliest = transactions.reduce<string | null>((min, tx) => (!min || tx.traded_at < min ? tx.traded_at : min), null);
  const latest = transactions.reduce<string>((max, tx) => (tx.traded_at > max ? tx.traded_at : max), asOf);
  const openDate = earliest ? addDays(earliest, -1) : asOf;

  const target = new Map(positions.map((position) => [position.symbol, position]));
  const net = new Map<string, number>();
  const lastPrice = new Map<string, number>();
  for (const tx of [...transactions].sort((a, b) => a.traded_at.localeCompare(b.traded_at))) {
    net.set(tx.symbol, (net.get(tx.symbol) ?? 0) + (tx.side === 'buy' ? tx.quantity : -tx.quantity));
    lastPrice.set(tx.symbol, tx.price);
  }

  const openings = new Map<string, number>();
  const adjustments: Adjustment[] = [];
  for (const symbol of new Set([...net.keys(), ...target.keys()])) {
    const gap = (target.get(symbol)?.quantity ?? 0) - (net.get(symbol) ?? 0);
    if (gap > EPSILON) openings.set(symbol, gap);
    else if (gap < -EPSILON) {
      const position = target.get(symbol);
      adjustments.push({ symbol, side: 'sell', quantity: -gap, price: position?.markPrice || lastPrice.get(symbol) || 0, tradedAt: latest, kind: 'adjust' });
    }
  }
  if (!openings.size) return adjustments;

  // Average-cost basis is linear in the opening price, so two replays pin it down exactly.
  const replay = (price: number) =>
    buildPositions([
      ...[...openings].map(([symbol, quantity]) => ({ symbol, side: 'buy' as const, quantity, price, fees: 0, traded_at: openDate, created_at: new Date(0) })),
      ...transactions,
    ]);
  const atZero = replay(0);
  const atOne = replay(1);
  for (const [symbol, quantity] of openings) {
    const position = target.get(symbol);
    const base = atZero.get(symbol)?.cost ?? 0;
    const slope = (atOne.get(symbol)?.cost ?? 0) - base;
    const price = position && slope > EPSILON ? Math.max(0, (position.costBasis - base) / slope) : position?.costPrice || position?.markPrice || lastPrice.get(symbol) || 0;
    adjustments.unshift({ symbol, side: 'buy', quantity, price, tradedAt: openDate, kind: 'open' });
  }
  return adjustments;
}

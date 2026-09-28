/** Average-cost position keeping over a trade ledger. Pure: no I/O. */

import { sortTrades, type TradeKind } from '@/lib/finance/ledger';

export type Position = { symbol: string; shares: number; cost: number; realized: number; firstBought: string | null };

export type PositionInput = {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fees: number;
  traded_at: string;
  created_at?: Date | string | null;
  kind?: TradeKind;
};

/**
 * Average-cost position keeping: sells realize P&L against the running average cost. Removals
 * (synthetic rows that take shares out without a sale) reduce shares and cost but realize nothing.
 */
export function buildPositions(transactions: PositionInput[]) {
  const positions = new Map<string, Position>();
  for (const tx of sortTrades(transactions)) {
    const position = positions.get(tx.symbol) ?? { symbol: tx.symbol, shares: 0, cost: 0, realized: 0, firstBought: null };
    if (tx.side === 'buy') {
      position.cost += tx.quantity * tx.price + tx.fees;
      position.shares += tx.quantity;
      position.firstBought ??= tx.traded_at;
    } else {
      const quantity = Math.min(tx.quantity, position.shares);
      const average = position.shares > 0 ? position.cost / position.shares : 0;
      if (tx.kind !== 'removal') {
        // Fees follow the shares actually sold when a sell exceeds the position.
        const fees = tx.quantity > 0 ? (tx.fees * quantity) / tx.quantity : 0;
        position.realized += quantity * tx.price - fees - average * quantity;
      }
      position.cost -= average * quantity;
      position.shares -= quantity;
      if (position.shares < 1e-9) {
        position.shares = 0;
        position.cost = 0;
      }
    }
    positions.set(tx.symbol, position);
  }
  return positions;
}

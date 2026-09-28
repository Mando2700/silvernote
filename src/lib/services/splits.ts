import 'server-only';

import { cached, ProviderError } from '@/lib/data/http';
import { fetchSplits } from '@/lib/data/providers/yahoo';
import { adjustForSplits, type DatedClose, type Split, type TradeKind } from '@/lib/finance/ledger';
import { getCandlesForMany } from '@/lib/services/prices';

const globalForSplits = globalThis as unknown as { __silvernoteSplitOutage?: number };

/**
 * Split history per symbol, refreshed daily (a stale copy is served if a refresh fails). Null when it
 * can't be loaded at all; after a failure Yahoo is left alone for a few minutes.
 */
export async function getSplits(symbol: string): Promise<Split[] | null> {
  const upper = symbol.toUpperCase();
  const outageUntil = globalForSplits.__silvernoteSplitOutage ?? 0;
  return cached(`splits:${upper}`, 24 * 3600, async () => {
    if (Date.now() < outageUntil) throw new Error('split source recently unavailable');
    try {
      return await fetchSplits(upper);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return [];
      globalForSplits.__silvernoteSplitOutage = Date.now() + 10 * 60_000;
      throw error;
    }
  }).catch((error) => {
    console.warn(`[silvernote] split history unavailable for ${upper}:`, (error as Error).message);
    return null;
  });
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Map<T, R>();
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        results.set(item, await fn(item));
      }
    }),
  );
  return results;
}

type Row = { symbol: string; quantity: number; price: number; traded_at: string; created_at?: Date | string | null; kind?: TradeKind };

/**
 * Trades restated in today's share units, so share counts line up with today's quotes and the
 * split-adjusted price history. Price history is loaded for symbols that have split since their
 * oldest trade (it tells a raw trade from one already entered in adjusted units), and for symbols
 * whose split history is unavailable (then a trade priced a clean split ratio off the adjusted closes counts).
 */
export async function adjustTransactionsForSplits<T extends Row>(rows: T[]): Promise<Array<T & { split_factor: number }>> {
  if (!rows.length) return [];
  const symbols = [...new Set(rows.map((row) => row.symbol.toUpperCase()))];
  const splits = await mapConcurrent(symbols, 4, getSplits);
  const oldest = new Map<string, string>();
  for (const row of rows) {
    const symbol = row.symbol.toUpperCase();
    if (!oldest.has(symbol) || row.traded_at < (oldest.get(symbol) as string)) oldest.set(symbol, row.traded_at);
  }
  // Price history is needed where a split followed a trade, and where the split history is unavailable.
  const affected = symbols.filter((symbol) => {
    const known = splits.get(symbol);
    return known === null || known === undefined || known.some((split) => split.date > (oldest.get(symbol) as string));
  });
  const closes = new Map<string, DatedClose[]>();
  if (affected.length) {
    const earliest = affected.map((symbol) => oldest.get(symbol) as string).sort()[0];
    const years = Math.min(10, (Date.now() - Date.parse(earliest)) / (365.25 * 86_400_000) + 0.1);
    const candles = await getCandlesForMany(affected, Math.max(0.3, years));
    for (const [symbol, rowsForSymbol] of candles) {
      closes.set(symbol, rowsForSymbol.map((candle) => ({ date: new Date(candle.t * 1000).toISOString().slice(0, 10), close: candle.c })));
    }
  }
  return adjustForSplits(
    rows,
    (symbol) => splits.get(symbol.toUpperCase()),
    (symbol) => closes.get(symbol.toUpperCase()),
  );
}

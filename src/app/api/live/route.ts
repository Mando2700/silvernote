import { HttpError } from '@/lib/auth';
import { route, searchParam } from '@/lib/api';
import { memo } from '@/lib/data/http';
import * as nasdaq from '@/lib/data/providers/nasdaq';
import { MAX_LIVE_SYMBOLS, type LiveTick } from '@/lib/services/live';

export const dynamic = 'force-dynamic';

/**
 * Latest prices for the symbols on screen, polled by the page every few seconds in the session. A short request
 * instead of a held-open stream: a stream keeps a function provisioned the whole time, which is the meter that runs
 * out on a free plan. Nasdaq answers 20 stocks per call; a set asked for within 10 s is served from memory.
 */
export const GET = route(async ({ request }) => {
  const symbols = [
    ...new Set(
      (searchParam(request, 'symbols') ?? '')
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)),
    ),
  ]
    .slice(0, MAX_LIVE_SYMBOLS)
    .sort();
  if (!symbols.length) throw new HttpError(400, 'No symbols.');
  return memo(`live:${symbols.join(',')}`, 10_000, async () => {
    const quotes = await nasdaq.fetchBatchQuotes(symbols);
    const now = Date.now();
    const ticks: LiveTick[] = [...quotes].map(([symbol, quote]) => ({ symbol, price: quote.price, change: quote.change, changePct: quote.changePct, timestamp: now }));
    return { ticks };
  });
});

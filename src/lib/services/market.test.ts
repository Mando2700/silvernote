import { describe, expect, it, vi } from 'vitest';

const fetchQuote = vi.fn(async (symbol: string, assetClass: 'stocks' | 'etf') =>
  // Nasdaq only answers for funds under the "etf" asset class.
  assetClass === 'etf' && symbol === 'VOO' ? { symbol, price: 710.79, change: 3.8, changePct: 0.54, previousClose: 706.99, volume: 1, timestamp: 0, source: 'Nasdaq' } : null,
);

vi.mock('@/lib/data/providers/nasdaq', () => ({ fetchQuote }));
vi.mock('@/lib/data/providers/finnhub', () => ({ finnhubEnabled: () => false }));
// Straight to the loader: no database cache between runs.
vi.mock('@/lib/data/http', async (original) => ({ ...(await original<typeof import('@/lib/data/http')>()), cached: <T,>(_key: string, _ttl: number, load: () => Promise<T>) => load() }));
vi.mock('@/lib/services/universe', () => ({ getSecuritiesBySymbols: vi.fn(async () => []), getSecurity: vi.fn(async () => null) }));

const { getQuotes } = await import('./market');

describe('getQuotes', () => {
  it('prices funds outside the stock universe, with no cap on how many', async () => {
    const symbols = ['VOO', ...Array.from({ length: 14 }, (_, index) => `ZZ${index}`)];
    const quotes = await getQuotes(symbols);
    expect(quotes.VOO?.price).toBe(710.79);
    // Every missing symbol was tried (stocks first, then as a fund), not just the first 12.
    expect(new Set(fetchQuote.mock.calls.map(([symbol]) => symbol)).size).toBe(15);
  });
});

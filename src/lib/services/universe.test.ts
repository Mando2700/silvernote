import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BatchQuote } from '@/lib/data/providers/nasdaq';
import type { SecurityRow } from '@/lib/data/types';

const pg = new PGlite();
const params = (values: unknown[] = []) => values.map((value) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : value));
vi.mock('@/lib/db', () => ({
  q: async (text: string, values?: unknown[]) => (await pg.query(text, params(values))).rows,
  q1: async (text: string, values?: unknown[]) => (await pg.query(text, params(values))).rows[0] ?? null,
}));
vi.mock('@/lib/data/http', () => ({ cached: (_key: string, _ttl: number, load: () => unknown) => load(), memo: (_key: string, _ttl: number, load: () => unknown) => load() }));
vi.mock('@/lib/data/providers/sec', () => ({ fetchTickerMap: async () => new Map(), fetchSubmissions: async () => ({ sic: null }) }));

const calls: string[] = [];
let screener: SecurityRow[] = [];
let live: Record<string, BatchQuote> = {};
vi.mock('@/lib/data/providers/nasdaq', () => ({
  fetchStockUniverse: async () => {
    calls.push('screener');
    return screener;
  },
  fetchBatchQuotes: async (symbols: string[], onBatch?: (quotes: Map<string, BatchQuote>, done: number, total: number) => Promise<void>) => {
    calls.push(`quotes:${symbols.join(',')}`);
    const quotes = new Map(symbols.filter((symbol) => live[symbol]).map((symbol) => [symbol, live[symbol]]));
    await onBatch?.(quotes, 1, 1);
    return quotes;
  },
}));

const { refreshUniverse } = await import('./universe');

function listing(symbol: string, price: number, marketCap: number): SecurityRow {
  return { symbol, name: `${symbol} Inc.`, exchange: null, cik: null, sector: 'Technology', industry: null, country: 'United States', ipoYear: null, price, change: 1, changePct: 1, volume: 100, marketCap, isCommon: true };
}

async function row(symbol: string) {
  return (await pg.query<{ price: number; change_pct: number; market_cap: number; price_at: Date | null }>('select price, change_pct, market_cap, price_at from public.securities where symbol = $1', [symbol])).rows[0];
}

beforeEach(async () => {
  await pg.exec(`
    drop table if exists public.securities, public.transactions, public.watchlist_items;
    create table public.securities (symbol text primary key, name text not null, exchange text, cik text, sector text, industry text, country text,
      ipo_year integer, price double precision, change double precision, change_pct double precision, volume double precision, market_cap double precision,
      is_common boolean not null default true, listed boolean not null default true, updated_at timestamptz not null default now(), price_at timestamptz);
    create table public.transactions (user_id uuid not null, symbol text not null, side text not null, quantity double precision not null);
    create table public.watchlist_items (user_id uuid not null, symbol text not null);
  `);
  calls.length = 0;
  // Enough filler listings to pass the "complete download" check; nobody follows them and they have no live quote.
  screener = Array.from({ length: 1000 }, (_, index) => listing(`F${index}`, 10, 1e6));
  live = {};
});

describe('refreshUniverse', () => {
  it('quotes held and watched stocks before downloading the universe', async () => {
    await pg.exec(`
      insert into public.securities (symbol, name, price, market_cap) values ('HELD', 'Held', 50, 5e9), ('WATCH', 'Watch', 20, 2e9), ('SOLD', 'Sold', 5, 1e8);
      insert into public.transactions values ('00000000-0000-0000-0000-000000000001', 'HELD', 'buy', 3),
        ('00000000-0000-0000-0000-000000000001', 'SOLD', 'buy', 2), ('00000000-0000-0000-0000-000000000001', 'SOLD', 'sell', 2);
      insert into public.watchlist_items values ('00000000-0000-0000-0000-000000000001', 'WATCH');
    `);
    live = { HELD: { price: 60, change: 10, changePct: 20, volume: 1 }, WATCH: { price: 22, change: 2, changePct: 10, volume: 1 } };
    screener.push(listing('HELD', 50, 5e9), listing('WATCH', 20, 2e9), listing('SOLD', 5, 1e8));

    await refreshUniverse();

    expect(calls[0]).toBe('quotes:HELD,WATCH');
    expect(calls[1]).toBe('screener');
    // The sweep skips what was already quoted.
    expect(calls[2]).not.toMatch(/\bHELD\b|\bWATCH\b/);
    expect(calls[2]).toMatch(/\bSOLD\b/);
  });

  it("keeps a live quote over the screener's session-old price and rescales market cap to it", async () => {
    await pg.exec(`insert into public.securities (symbol, name, price, change_pct, market_cap, price_at) values ('CEG', 'Constellation', 300.4, 12.25, 9.4e10, now() - interval '1 hour')`);
    screener.push(listing('CEG', 267.62, 8.4e10));

    await refreshUniverse();

    const ceg = await row('CEG');
    expect(ceg.price).toBe(300.4);
    expect(ceg.change_pct).toBe(12.25);
    expect(ceg.market_cap).toBeCloseTo((8.4e10 * 300.4) / 267.62);
  });

  it('falls back to the screener where there is no recent live quote, and leaves those rows unstamped', async () => {
    await pg.exec(`insert into public.securities (symbol, name, price, market_cap, price_at) values ('OLD', 'Old', 1, 1e6, now() - interval '3 days')`);
    screener.push(listing('OLD', 2, 2e6), listing('NEW', 7, 7e6));

    await refreshUniverse();

    expect((await row('OLD')).price).toBe(2);
    const fresh = await row('NEW');
    expect(fresh.price).toBe(7);
    expect(fresh.price_at).toBeNull();
  });

  it('stamps rows priced by a live quote', async () => {
    screener.push(listing('NVDA', 238.9, 5.8e12));
    live = { NVDA: { price: 239.24, change: 0.34, changePct: 0.14, volume: 1 } };

    await refreshUniverse();

    const nvda = await row('NVDA');
    expect(nvda.price).toBe(239.24);
    expect(nvda.price_at).toBeInstanceOf(Date);
  });
});

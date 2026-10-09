import 'server-only';

import { q, q1 } from '@/lib/db';
import { cached, memo } from '@/lib/data/http';
import { type BatchQuote, fetchBatchQuotes, fetchStockUniverse } from '@/lib/data/providers/nasdaq';
import { fetchSubmissions, fetchTickerMap } from '@/lib/data/providers/sec';
import { sectorFromSic } from '@/lib/data/sectors';
import type { SecurityRow } from '@/lib/data/types';

export type UniverseRow = {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  country: string | null;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  market_cap: number | null;
  cik: string | null;
  exchange: string | null;
  ipo_year: number | null;
  is_common: boolean;
  /** When `price` last came from a live quote; null while only the (session-old) screener has priced it. */
  price_at: Date | null;
  updated_at: Date;
};

/**
 * A quote younger than this outranks the screener's price. Every sweep re-quotes the whole market (off hours too), so only a
 * symbol the quote API stopped answering for falls back to the screener.
 */
const QUOTED = "coalesce(securities.price_at > now() - interval '36 hours', false)";

/** Write live quotes straight to their rows, rescaling market cap to the new price. */
async function saveQuotes(quotes: Map<string, BatchQuote>) {
  if (!quotes.size) return;
  const payload = [...quotes].map(([symbol, quote]) => ({ symbol, price: quote.price, change: quote.change, change_pct: quote.changePct, volume: quote.volume }));
  await q(
    `update public.securities s set
       market_cap = case when s.price > 0 then s.market_cap * t.price / s.price else s.market_cap end,
       price = t.price, change = t.change, change_pct = t.change_pct, volume = coalesce(t.volume, s.volume),
       price_at = now(), updated_at = now()
     from json_to_recordset($1::json) as t(symbol text, price double precision, change double precision, change_pct double precision, volume double precision)
     where s.symbol = t.symbol`,
    [payload],
  );
}

/** Stocks someone holds or watches: quoted first, so the pages people look at are fresh within seconds of a refresh starting. */
async function followedStocks() {
  const rows = await q<{ symbol: string }>(
    `with followed as (
       select symbol from public.transactions group by user_id, symbol
       having sum(case when side = 'buy' then quantity else -quantity end) > 0.000001
       union
       select symbol from public.watchlist_items
     )
     select s.symbol from followed f join public.securities s on s.symbol = f.symbol
     where s.listed order by s.market_cap desc nulls last`,
  );
  return rows.map((row) => row.symbol);
}

/**
 * Refresh the US stock universe: listings, sectors and market caps from Nasdaq's screener, SEC CIKs, and a live quote for every
 * common stock. Quotes are saved batch by batch (followed names first), so prices go live progressively and an interrupted run
 * keeps what it got. `onProgress` gets a status line and how far through the whole refresh it is (0–1). Past `deadline` (epoch ms)
 * the sweep stops starting batches; `left` counts the stocks it didn't reach, and the next run quotes those first.
 */
export async function refreshUniverse(onProgress?: (message: string, fraction: number) => void, deadline?: number) {
  const followed = await followedStocks();
  onProgress?.(`Quoting ${followed.length} held and watched stocks…`, 0.01);
  const first = await fetchBatchQuotes(followed, saveQuotes);

  onProgress?.('Downloading the US stock universe…', 0.04);
  const rows = await fetchStockUniverse();
  if (rows.length < 1000) throw new Error(`Universe download looked incomplete (${rows.length} rows).`);
  onProgress?.('Matching companies to SEC filers…', 0.06);
  const tickerMap = await fetchTickerMap().catch(() => new Map<string, { cik: string; name: string; exchange: string }>());
  const enriched: SecurityRow[] = rows.map((row) => {
    const sec = tickerMap.get(row.symbol);
    return { ...row, cik: sec?.cik ?? null, exchange: sec?.exchange || null };
  });
  // Nasdaq leaves some listings (e.g. share classes) unclassified: fall back to the SEC's SIC code.
  const unclassified = enriched.filter((row) => !row.sector && row.cik && row.isCommon).slice(0, 200);
  if (unclassified.length) onProgress?.(`Classifying ${unclassified.length} companies from SEC SIC codes…`, 0.07);
  for (const row of unclassified) {
    const sic = await cached(`sic:${row.cik}`, 90 * 86_400, async () => (await fetchSubmissions(row.cik as string)).sic).catch(() => null);
    row.sector = sectorFromSic(sic);
  }
  onProgress?.(`Saving ${enriched.length.toLocaleString()} listings…`, 0.09);
  const payload = enriched.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    cik: row.cik,
    sector: row.sector,
    industry: row.industry,
    country: row.country,
    ipo_year: row.ipoYear,
    price: row.price,
    change: row.change,
    change_pct: row.changePct,
    volume: row.volume,
    market_cap: row.marketCap,
    is_common: row.isCommon,
  }));
  // Upsert in chunks so a single statement never gets too large. The screener's (session-old) price only fills rows without a
  // recent live quote; where one is kept, the screener's market cap is rescaled to it.
  for (let index = 0; index < payload.length; index += 1500) {
    const chunk = payload.slice(index, index + 1500);
    await q(
      `insert into public.securities (symbol, name, exchange, cik, sector, industry, country, ipo_year, price, change, change_pct, volume, market_cap, is_common, listed, updated_at)
       select symbol, name, exchange, cik, sector, industry, country, ipo_year, price, change, change_pct, volume, market_cap, is_common, true, now()
       from json_to_recordset($1::json) as t(symbol text, name text, exchange text, cik text, sector text, industry text, country text,
         ipo_year integer, price double precision, change double precision, change_pct double precision, volume double precision,
         market_cap double precision, is_common boolean)
       on conflict (symbol) do update set
         name = excluded.name, exchange = coalesce(excluded.exchange, securities.exchange), cik = coalesce(excluded.cik, securities.cik),
         sector = coalesce(excluded.sector, securities.sector), industry = coalesce(excluded.industry, securities.industry),
         country = excluded.country, ipo_year = excluded.ipo_year, is_common = excluded.is_common, listed = true, updated_at = now(),
         price = case when ${QUOTED} then securities.price else excluded.price end,
         change = case when ${QUOTED} then securities.change else excluded.change end,
         change_pct = case when ${QUOTED} then securities.change_pct else excluded.change_pct end,
         volume = case when ${QUOTED} then securities.volume else excluded.volume end,
         market_cap = case when ${QUOTED} and excluded.price > 0 then excluded.market_cap * securities.price / excluded.price else excluded.market_cap end`,
      [chunk],
    );
  }

  // Every other common stock, saved as each batch lands: the stalest live quote first (what a time-limited run didn't reach), then by size.
  const commons = enriched.filter((row) => row.isCommon && !first.has(row.symbol));
  const quotedAt = new Map(
    (await q<{ symbol: string; price_at: Date }>('select symbol, price_at from public.securities where price_at is not null')).map((row) => [row.symbol, new Date(row.price_at).getTime()]),
  );
  const rest = commons.sort((a, b) => (quotedAt.get(a.symbol) ?? 0) - (quotedAt.get(b.symbol) ?? 0) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  onProgress?.('Refreshing prices…', 0.1);
  let reached = 0;
  const quotes = await fetchBatchQuotes(
    rest.map((row) => row.symbol),
    async (batch, finished, total) => {
      await saveQuotes(batch);
      reached = Math.min(finished * 20, rest.length);
      onProgress?.(`Refreshing prices · ${reached.toLocaleString()} of ${rest.length.toLocaleString()} stocks`, 0.1 + 0.88 * (finished / total));
    },
    deadline,
  );
  // Anything not in today's list has been delisted or renamed.
  await q(`update public.securities set listed = false where updated_at < now() - interval '3 days'`);
  return { count: enriched.length, quoted: first.size + quotes.size, left: rest.length - reached, withCik: enriched.filter((row) => row.cik).length };
}

export async function universeStatus() {
  return q1<{ count: number; common: number; updated_at: Date | null }>(
    `select count(*)::int as count, count(*) filter (where is_common)::int as common, max(updated_at) as updated_at
     from public.securities where listed`,
  );
}

export async function getSecurity(symbol: string) {
  return q1<UniverseRow>('select * from public.securities where symbol = $1', [symbol.toUpperCase()]);
}

export async function searchSecurities(term: string, limit = 12) {
  const query = term.trim();
  if (!query) return [];
  return memo(`search:${query.toLowerCase()}:${limit}`, 60_000, () =>
    q<Pick<UniverseRow, 'symbol' | 'name' | 'sector' | 'market_cap' | 'price' | 'change_pct'>>(
      `select symbol, name, sector, market_cap, price, change_pct
       from public.securities
       where listed and (symbol ilike $1 || '%' or name ilike '%' || $1 || '%')
       order by (symbol = upper($1)) desc, (symbol ilike $1 || '%') desc, is_common desc, market_cap desc nulls last
       limit $2`,
      [query, limit],
    ),
  );
}

export async function getSecuritiesBySymbols(symbols: string[]) {
  if (!symbols.length) return [];
  return q<UniverseRow>('select * from public.securities where symbol = any($1::text[])', [symbols.map((symbol) => symbol.toUpperCase())]);
}

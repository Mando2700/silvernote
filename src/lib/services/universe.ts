import 'server-only';

import { q, q1 } from '@/lib/db';
import { cached, memo } from '@/lib/data/http';
import { fetchBatchQuotes, fetchStockUniverse } from '@/lib/data/providers/nasdaq';
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
  updated_at: Date;
};

/** Pull the full US stock list (with prices and market caps) and attach SEC CIKs. */
export async function refreshUniverse(onProgress?: (message: string) => void) {
  onProgress?.('Downloading the US stock universe…');
  const rows = await fetchStockUniverse();
  if (rows.length < 1000) throw new Error(`Universe download looked incomplete (${rows.length} rows).`);
  // The screener trails the quote API by a session: refresh every common stock from current quotes.
  onProgress?.('Refreshing prices…');
  const common = rows.filter((row) => row.isCommon).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const fresh = await fetchBatchQuotes(common.map((row) => row.symbol)).catch(() => new Map());
  for (const row of rows) {
    const quote = fresh.get(row.symbol);
    if (!quote) continue;
    if (row.price && row.marketCap) row.marketCap = (row.marketCap * quote.price) / row.price;
    row.price = quote.price;
    row.change = quote.change;
    row.changePct = quote.changePct;
    row.volume = quote.volume ?? row.volume;
  }
  onProgress?.('Matching companies to SEC filers…');
  const tickerMap = await fetchTickerMap().catch(() => new Map<string, { cik: string; name: string; exchange: string }>());
  const enriched: SecurityRow[] = rows.map((row) => {
    const sec = tickerMap.get(row.symbol);
    return { ...row, cik: sec?.cik ?? null, exchange: sec?.exchange || null };
  });
  // Nasdaq leaves some listings (e.g. share classes) unclassified: fall back to the SEC's SIC code.
  const unclassified = enriched.filter((row) => !row.sector && row.cik && row.isCommon).slice(0, 200);
  if (unclassified.length) onProgress?.(`Classifying ${unclassified.length} companies from SEC SIC codes…`);
  for (const row of unclassified) {
    const sic = await cached(`sic:${row.cik}`, 90 * 86_400, async () => (await fetchSubmissions(row.cik as string)).sic).catch(() => null);
    row.sector = sectorFromSic(sic);
  }
  onProgress?.(`Saving ${enriched.length.toLocaleString()} securities…`);
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
  // Upsert in chunks so a single statement never gets too large.
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
         country = excluded.country, ipo_year = excluded.ipo_year, price = excluded.price, change = excluded.change,
         change_pct = excluded.change_pct, volume = excluded.volume, market_cap = excluded.market_cap,
         is_common = excluded.is_common, listed = true, updated_at = now()`,
      [chunk],
    );
  }
  // Anything not in today's list has been delisted or renamed.
  await q(`update public.securities set listed = false where updated_at < now() - interval '3 days'`);
  return { count: enriched.length, withCik: enriched.filter((row) => row.cik).length };
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

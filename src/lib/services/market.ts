import 'server-only';

import { q } from '@/lib/db';
import { cached, memo } from '@/lib/data/http';
import * as finnhub from '@/lib/data/providers/finnhub';
import * as fmp from '@/lib/data/providers/fmp';
import * as nasdaq from '@/lib/data/providers/nasdaq';
import { fetchSubmissions } from '@/lib/data/providers/sec';
import type { CompanyProfile, Filing, NewsItem, Quote } from '@/lib/data/types';
import { getSecuritiesBySymbols, getSecurity } from '@/lib/services/universe';

export const INDEX_PROXIES = [
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'Nasdaq 100' },
  { symbol: 'DIA', name: 'Dow 30' },
  { symbol: 'IWM', name: 'Russell 2000' },
] as const;

// ─── Quotes ─────────────────────────────────────────────────────────────────

/** One live quote: Finnhub (real-time) when configured, otherwise Nasdaq (delayed). */
export async function getLiveQuote(symbol: string): Promise<Quote | null> {
  const upper = symbol.toUpperCase();
  return memo(`quote:${upper}`, 20_000, async () => {
    if (finnhub.finnhubEnabled()) {
      const quote = await finnhub.fetchQuote(upper).catch(() => null);
      if (quote?.price) return quote;
    }
    const assetClass = INDEX_PROXIES.some((item) => item.symbol === upper) ? 'etf' : 'stocks';
    return nasdaq.fetchQuote(upper, assetClass).catch(() => null);
  });
}

/**
 * Quotes for many symbols at once. The universe table is refreshed from Nasdaq's full-market
 * snapshot on a schedule, so this costs one database read, not one request per symbol.
 */
export async function getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const upper = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  const rows = await getSecuritiesBySymbols(upper);
  const result: Record<string, Quote> = {};
  for (const row of rows) {
    result[row.symbol] = {
      symbol: row.symbol,
      price: row.price,
      change: row.change,
      changePct: row.change_pct,
      previousClose: row.price !== null && row.change !== null ? row.price - row.change : null,
      volume: row.volume,
      timestamp: new Date(row.updated_at).getTime(),
      source: 'Nasdaq',
    };
  }
  const missing = upper.filter((symbol) => !result[symbol]);
  await Promise.all(
    missing.slice(0, 12).map(async (symbol) => {
      const quote = await getLiveQuote(symbol);
      if (quote) result[symbol] = quote;
    }),
  );
  return result;
}

export async function getIndexQuotes() {
  const quotes = await Promise.all(INDEX_PROXIES.map((item) => getLiveQuote(item.symbol)));
  return INDEX_PROXIES.map((item, index) => ({ ...item, quote: quotes[index] }));
}

// ─── Profiles ───────────────────────────────────────────────────────────────

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile> {
  const upper = symbol.toUpperCase();
  const security = await getSecurity(upper);
  const base = await cached(`profile:${upper}`, 7 * 86_400, async () => {
    const [description, submissions, fmpProfile, finnhubProfile] = await Promise.all([
      nasdaq.fetchCompanyDescription(upper).catch(() => null),
      security?.cik ? fetchSubmissions(security.cik).catch(() => null) : Promise.resolve(null),
      fmp.fmpEnabled() ? fmp.fetchProfile(upper).catch(() => null) : Promise.resolve(null),
      finnhub.finnhubEnabled() ? finnhub.fetchProfile(upper).catch(() => null) : Promise.resolve(null),
    ]);
    return {
      description: fmpProfile?.description ?? description?.description ?? null,
      website: fmpProfile?.website ?? finnhubProfile?.weburl ?? description?.website ?? submissions?.website ?? null,
      ceo: fmpProfile?.ceo ?? null,
      employees: fmpProfile?.fullTimeEmployees ? Number(fmpProfile.fullTimeEmployees) || null : null,
      ipoDate: fmpProfile?.ipoDate ?? finnhubProfile?.ipo ?? null,
      logo: fmpProfile?.image ?? finnhubProfile?.logo ?? null,
      sic: submissions?.sic ?? null,
      sicDescription: submissions?.sicDescription ?? null,
      fiscalYearEnd: submissions?.fiscalYearEnd ?? null,
      country: fmpProfile?.country ?? finnhubProfile?.country ?? security?.country ?? null,
      exchange: fmpProfile?.exchange ?? finnhubProfile?.exchange ?? security?.exchange ?? null,
    };
  });
  const summary = await cached(`summary:${upper}`, 6 * 3600, () => nasdaq.fetchSummary(upper)).catch(() => null);
  return {
    symbol: upper,
    name: security?.name ?? upper,
    description: base.description,
    sector: security?.sector ?? summary?.sector ?? null,
    industry: security?.industry ?? summary?.industry ?? null,
    exchange: summary?.exchange ?? base.exchange,
    country: base.country,
    website: base.website,
    ceo: base.ceo,
    employees: base.employees,
    ipoDate: base.ipoDate ?? (security?.ipo_year ? String(security.ipo_year) : null),
    logo: base.logo,
    cik: security?.cik ?? null,
    sic: base.sic,
    sicDescription: base.sicDescription,
    fiscalYearEnd: base.fiscalYearEnd,
    oneYearTarget: summary?.oneYearTarget ?? null,
    forwardPE: summary?.forwardPE ?? null,
    dividendYield: summary?.dividendYield ?? null,
    annualDividend: summary?.annualDividend ?? null,
    exDividendDate: summary?.exDividendDate ?? null,
    averageVolume: summary?.averageVolume ?? null,
    high52: summary?.high52 ?? null,
    low52: summary?.low52 ?? null,
  };
}

// ─── News & filings ─────────────────────────────────────────────────────────

function dedupe(items: NewsItem[]) {
  const seen = new Set<string>();
  const result: NewsItem[] = [];
  for (const item of items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
    if (seen.has(key) || seen.has(item.url)) continue;
    seen.add(key);
    seen.add(item.url);
    result.push(item);
  }
  return result;
}

export async function getCompanyNews(symbol: string): Promise<NewsItem[]> {
  const upper = symbol.toUpperCase();
  return cached(`news:${upper}`, 5 * 60, async () => {
    const results = await Promise.allSettled([
      finnhub.finnhubEnabled() ? finnhub.fetchCompanyNews(upper, 21) : Promise.resolve([]),
      nasdaq.fetchSymbolNews(upper),
    ]);
    const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    return dedupe(items).slice(0, 60);
  });
}

export async function getMarketNews(): Promise<NewsItem[]> {
  return cached('news:market', 3 * 60, async () => {
    const results = await Promise.allSettled([
      finnhub.finnhubEnabled() ? finnhub.fetchMarketNews('general') : Promise.resolve([]),
      nasdaq.fetchCategoryNews('Markets'),
      nasdaq.fetchCategoryNews('Earnings'),
      nasdaq.fetchCategoryNews('Stocks'),
      nasdaq.fetchCategoryNews('Technology'),
      nasdaq.fetchPublisherNews(),
    ]);
    return dedupe(results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))).slice(0, 200);
  });
}

export async function getNewsForSymbols(symbols: string[], perSymbol = 8) {
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].slice(0, 40);
  const lists: NewsItem[][] = [];
  const queue = [...unique];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (;;) {
        const symbol = queue.shift();
        if (!symbol) return;
        lists.push((await getCompanyNews(symbol).catch(() => [])).slice(0, perSymbol));
      }
    }),
  );
  return dedupe(lists.flat());
}

export async function getFilings(symbol: string): Promise<Filing[]> {
  const security = await getSecurity(symbol);
  if (!security?.cik) return [];
  return cached(`filings:${security.cik}`, 6 * 3600, async () => (await fetchSubmissions(security.cik as string)).filings);
}

// ─── Peers & sector context ─────────────────────────────────────────────────

export async function getPeerSymbols(symbol: string, limit = 8): Promise<{ symbols: string[]; source: string }> {
  const upper = symbol.toUpperCase();
  const security = await getSecurity(upper);
  if (finnhub.finnhubEnabled()) {
    const peers = await cached(`peers:${upper}`, 7 * 86_400, () => finnhub.fetchPeers(upper)).catch(() => []);
    const known = (await getSecuritiesBySymbols(peers)).filter((row) => row.symbol !== upper && row.is_common && (!row.cik || row.cik !== security?.cik));
    if (known.length >= 3) return { symbols: known.map((row) => row.symbol).slice(0, limit), source: 'Finnhub peers' };
  }
  if (!security?.industry && !security?.sector) return { symbols: [], source: 'none' };
  // Closest companies by market value within the same industry (or sector as a fallback).
  const field = security.industry ? 'industry' : 'sector';
  const rows = await q<{ symbol: string }>(
    `select symbol from public.securities
     where listed and is_common and ${field} = $1 and symbol <> $2 and market_cap is not null
       and (cik is null or cik is distinct from $5)
     order by abs(ln(greatest(market_cap, 1)) - ln(greatest($3::double precision, 1))) asc
     limit $4`,
    [security[field], upper, security.market_cap ?? 1e9, limit, security.cik],
  );
  return { symbols: rows.map((row) => row.symbol), source: security.industry ? 'Same industry, closest in size' : 'Same sector, closest in size' };
}

export async function getAnalystSignals(symbol: string) {
  if (!finnhub.finnhubEnabled()) return null;
  const upper = symbol.toUpperCase();
  return cached(`analyst:${upper}`, 12 * 3600, async () => {
    const [recommendations, surprises] = await Promise.all([
      finnhub.fetchRecommendations(upper).catch(() => []),
      finnhub.fetchEarningsSurprises(upper).catch(() => []),
    ]);
    return { recommendations: recommendations.slice(0, 6), surprises: surprises.slice(0, 8) };
  }).catch(() => null);
}

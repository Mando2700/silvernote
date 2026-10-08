import 'server-only';

import { q } from '@/lib/db';
import { ASSET_KIND_LABEL, getAsset } from '@/lib/data/assets';
import { cached, runUrgent, within } from '@/lib/data/http';
import * as finnhub from '@/lib/data/providers/finnhub';
import * as fmp from '@/lib/data/providers/fmp';
import * as nasdaq from '@/lib/data/providers/nasdaq';
import { fetchSubmissions } from '@/lib/data/providers/sec';
import { fetchYahooDaily, fetchYahooDay } from '@/lib/data/providers/yahoo';
import type { CompanyProfile, ExtendedQuote, Filing, NewsItem, Quote } from '@/lib/data/types';
import { isMarketOpen } from '@/lib/services/prices';
import { regularSession } from '@/lib/session';
import { getSecuritiesBySymbols, getSecurity } from '@/lib/services/universe';

/** Index-tracking funds: quoted everywhere, used for charts, benchmarks and as the index strip's fallback. */
export const INDEX_PROXIES = [
  { symbol: 'SPY', name: 'S&P 500', index: '^GSPC' },
  { symbol: 'QQQ', name: 'Nasdaq 100', index: '^NDX' },
  { symbol: 'DIA', name: 'Dow 30', index: '^DJI' },
  { symbol: 'IWM', name: 'Russell 2000', index: '^RUT' },
] as const;

// ─── Quotes ─────────────────────────────────────────────────────────────────

/** Symbols Nasdaq files as funds: its quote API only answers for them under the "etf" asset class. */
const knownFunds = new Set<string>(INDEX_PROXIES.map((item) => item.symbol));

/** One live quote: Finnhub (real-time) when configured, otherwise Nasdaq (delayed), trying stocks and funds. */
export async function getLiveQuote(symbol: string): Promise<Quote | null> {
  const upper = symbol.toUpperCase();
  return cached(`quote:${upper}`, 20, async () => {
    if (getAsset(upper)) return assetQuote(upper);
    if (finnhub.finnhubEnabled()) {
      const quote = await finnhub.fetchQuote(upper).catch(() => null);
      if (quote?.price) return quote;
    }
    const order: Array<'stocks' | 'etf'> = knownFunds.has(upper) ? ['etf', 'stocks'] : ['stocks', 'etf'];
    for (const assetClass of order) {
      const quote = await nasdaq.fetchQuote(upper, assetClass).catch(() => null);
      if (quote?.price) {
        if (assetClass === 'etf') knownFunds.add(upper);
        return quote;
      }
    }
    return null;
  });
}

/** Commodities and crypto: Yahoo's last price against the prior close. */
async function assetQuote(symbol: string): Promise<Quote | null> {
  const day = await fetchYahooDay(symbol).catch(() => null);
  if (!day) return null;
  return {
    symbol,
    price: day.price,
    change: day.change,
    changePct: day.changePct,
    previousClose: day.previousClose,
    timestamp: day.time,
    source: 'Yahoo',
  };
}

const STALE_REQUOTE_LIMIT = 60;

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
      timestamp: new Date(row.price_at ?? row.updated_at).getTime(),
      source: 'Nasdaq',
    };
  }
  // Right after the open the snapshot still holds yesterday's close and move until the next refresh lands, and rows the
  // quote sweep hasn't reached carry the screener's session-old price: re-quote those live (a portfolio's worth; bigger lists keep the snapshot).
  const sessionOpen = regularSession(Date.now() / 1000).open * 1000;
  const quotedAt = new Map(rows.map((row) => [row.symbol, row.price_at ? new Date(row.price_at).getTime() : 0]));
  const stale = isMarketOpen() ? upper.filter((symbol) => result[symbol] && (quotedAt.get(symbol) ?? 0) < sessionOpen).slice(0, STALE_REQUOTE_LIMIT) : [];
  // Funds and anything else outside the stock universe: live quotes, a few at a time (every symbol, no cap).
  const missing = upper.filter((symbol) => !result[symbol]);
  const queue = [...missing, ...stale];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (;;) {
        const symbol = queue.shift();
        if (!symbol) return;
        const quote = await getLiveQuote(symbol);
        if (quote) result[symbol] = quote;
      }
    }),
  );
  return result;
}

/** How long a page waits for extended-hours prices; slower ones land in the cache for the next refresh. */
const EXTENDED_QUOTES_BUDGET_MS = 2_500;

/**
 * Pre-market and after-hours prices from Nasdaq (Finnhub's quote carries none), keyed by symbol.
 * Empty during the regular session; symbols without extended trading, or not loaded within the
 * budget, are left out.
 */
export async function getExtendedQuotes(symbols: string[]): Promise<Record<string, ExtendedQuote>> {
  const result: Record<string, ExtendedQuote> = {};
  if (isMarketOpen()) return result;
  const queue = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].filter((symbol) => !getAsset(symbol));
  const loading = Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (;;) {
        const symbol = queue.shift();
        if (!symbol) return;
        const extended = await cached(`extended:${symbol}`, 60, async () => {
          const order: Array<'stocks' | 'etf'> = knownFunds.has(symbol) ? ['etf', 'stocks'] : ['stocks', 'etf'];
          for (const assetClass of order) {
            const quote = await nasdaq.fetchQuote(symbol, assetClass).catch(() => null);
            if (quote?.price) {
              if (assetClass === 'etf') knownFunds.add(symbol);
              return quote.extended ?? null;
            }
          }
          return null;
        });
        if (extended) result[symbol] = extended;
      }
    }),
  );
  await within(loading, EXTENDED_QUOTES_BUDGET_MS);
  return { ...result };
}

/** Today's minute bars against the prior close, shared through the cache by every chart that shows them. */
export function getIntraday(symbol: string) {
  const upper = symbol.toUpperCase();
  return cached(`intraday:${upper}`, 60, () => nasdaq.fetchIntraday(upper));
}

export async function getIndexQuotes() {
  const quotes = await Promise.all(INDEX_PROXIES.map((item) => getLiveQuote(item.symbol)));
  return INDEX_PROXIES.map((item, index) => ({ ...item, quote: quotes[index] }));
}

// ─── Profiles ───────────────────────────────────────────────────────────────

/**
 * `fast` is the first paint of the company page: it leaves out the Nasdaq summary (forward P/E, 52-week range,
 * target, dividend) and the rate-limited Finnhub/FMP lookups, which queue for seconds on a cold symbol. The
 * description, website and filing details alone come back in about a second. `lite` adds the Nasdaq summary back but
 * still skips Finnhub/FMP (CEO, headcount, IPO date, logo), which the company page does not show.
 */
export async function getCompanyProfile(symbol: string, options: { fast?: boolean; lite?: boolean } = {}): Promise<CompanyProfile> {
  const upper = symbol.toUpperCase();
  const asset = getAsset(upper);
  if (asset) return assetProfile(asset);
  const security = await getSecurity(upper);
  // Nasdaq's summary is the slowest call here and does not depend on the base profile: start it alongside.
  const summaryRequest = options.fast ? Promise.resolve(null) : cached(`summary:${upper}`, 6 * 3600, () => nasdaq.fetchSummary(upper)).catch(() => null);
  const identity = () =>
    cached(`profile-id:${upper}`, 7 * 86_400, async () => {
      const [description, submissions] = await Promise.all([
        nasdaq.fetchCompanyDescription(upper).catch(() => null),
        security?.cik ? fetchSubmissions(security.cik).catch(() => null) : Promise.resolve(null),
      ]);
      return {
        description: description?.description ?? null,
        website: description?.website ?? submissions?.website ?? null,
        sic: submissions?.sic ?? null,
        sicDescription: submissions?.sicDescription ?? null,
        fiscalYearEnd: submissions?.fiscalYearEnd ?? null,
      };
    });
  const base = options.fast || options.lite
    ? {
        ...(await identity()),
        ceo: null,
        employees: null,
        ipoDate: null,
        logo: null,
        country: security?.country ?? null,
        exchange: security?.exchange ?? null,
      }
    : await cached(`profile:${upper}`, 7 * 86_400, async () => {
        const [id, fmpProfile, finnhubProfile] = await Promise.all([
          identity(),
          fmp.fmpEnabled() ? fmp.fetchProfile(upper).catch(() => null) : Promise.resolve(null),
          finnhub.finnhubEnabled() ? finnhub.fetchProfile(upper).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          description: fmpProfile?.description ?? id.description,
          website: fmpProfile?.website ?? finnhubProfile?.weburl ?? id.website,
          ceo: fmpProfile?.ceo ?? null,
          employees: fmpProfile?.fullTimeEmployees ? Number(fmpProfile.fullTimeEmployees) || null : null,
          ipoDate: fmpProfile?.ipoDate ?? finnhubProfile?.ipo ?? null,
          logo: fmpProfile?.image ?? finnhubProfile?.logo ?? null,
          sic: id.sic,
          sicDescription: id.sicDescription,
          fiscalYearEnd: id.fiscalYearEnd,
          country: fmpProfile?.country ?? finnhubProfile?.country ?? security?.country ?? null,
          exchange: fmpProfile?.exchange ?? finnhubProfile?.exchange ?? security?.exchange ?? null,
        };
      });
  const summary = await summaryRequest;
  // Nasdaq only publishes dividend fields for Nasdaq listings; NYSE names (KO, JPM, …) come from Finnhub's indicated rate.
  const dividend =
    !options.fast && summary?.dividendYield == null && finnhub.finnhubEnabled()
      ? await cached(`fh-dividend:${upper}`, 12 * 3600, async () => {
          const metric = await finnhub.fetchMetrics(upper);
          const yieldPct = Number(metric.dividendYieldIndicatedAnnual ?? metric.currentDividendYieldTTM);
          const perShare = Number(metric.dividendPerShareAnnual ?? metric.dividendPerShareTTM);
          return {
            dividendYield: Number.isFinite(yieldPct) && yieldPct > 0 ? yieldPct / 100 : null,
            annualDividend: Number.isFinite(perShare) && perShare > 0 ? perShare : null,
          };
        }).catch(() => null)
      : null;
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
    dividendYield: summary?.dividendYield ?? dividend?.dividendYield ?? null,
    annualDividend: summary?.annualDividend ?? dividend?.annualDividend ?? null,
    exDividendDate: summary?.exDividendDate ?? null,
    averageVolume: summary?.averageVolume ?? null,
    high52: summary?.high52 ?? null,
    low52: summary?.low52 ?? null,
  };
}

/** A commodity or crypto profile: the description from the registry and the 52-week range from Yahoo. */
async function assetProfile(asset: NonNullable<ReturnType<typeof getAsset>>): Promise<CompanyProfile> {
  const year = await cached(`asset-52w:${asset.symbol}`, 6 * 3600, () => fetchYahooDaily(asset.yahoo, '1y')).catch(() => []);
  const closes = year.map((point) => point.c);
  return {
    symbol: asset.symbol,
    name: asset.name,
    description: asset.description,
    sector: ASSET_KIND_LABEL[asset.kind],
    industry: null,
    exchange: null,
    country: null,
    website: null,
    ceo: null,
    employees: null,
    ipoDate: null,
    logo: null,
    cik: null,
    sic: null,
    sicDescription: null,
    fiscalYearEnd: null,
    oneYearTarget: null,
    forwardPE: null,
    dividendYield: null,
    annualDividend: null,
    exDividendDate: null,
    averageVolume: null,
    high52: closes.length ? Math.max(...closes) : null,
    low52: closes.length ? Math.min(...closes) : null,
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

/**
 * `headlines` is for a glance (the company overview): Finnhub plus whatever Nasdaq's slower RSS feed returns within
 * a moment, kept briefly. The full merge is left to the News tab.
 */
export async function getCompanyNews(symbol: string, options: { headlines?: boolean } = {}): Promise<NewsItem[]> {
  const upper = symbol.toUpperCase();
  if (options.headlines) {
    return cached(`news-glance:${upper}`, 60, async () => {
      const [finnhubItems, nasdaqItems] = await Promise.all([
        finnhub.finnhubEnabled() ? runUrgent(() => finnhub.fetchCompanyNews(upper, 21)).catch(() => []) : Promise.resolve([]),
        within(nasdaq.fetchSymbolNews(upper), 800).catch(() => []),
      ]);
      return dedupe([...finnhubItems, ...(nasdaqItems ?? [])]).slice(0, 10);
    });
  }
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
  return cached(`filings-v3:${security.cik}`, 6 * 3600, async () => (await fetchSubmissions(security.cik as string)).filings);
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

import 'server-only';

import { XMLParser } from 'fast-xml-parser';

import { cleanSecurityName, isCommonStock, normalizeSymbol } from '@/lib/data/eligibility';
import { mapSector } from '@/lib/data/sectors';
import { BROWSER_UA, fetchJson, fetchText, limiters, parseLooseNumber } from '@/lib/data/http';
import type { Candle, NewsItem, Quote, SecurityRow } from '@/lib/data/types';

/**
 * Nasdaq's public website API: the whole US stock universe (with sector, industry and market cap)
 * in one call, ten years of daily history, delayed quotes, company descriptions and RSS news.
 * No key required. It is unofficial, so every caller treats failures as "try another source".
 */

const BASE = 'https://api.nasdaq.com/api';
const HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

type Envelope<T> = { data: T | null; status?: { rCode?: number; bCodeMessage?: unknown } };

async function get<T>(path: string) {
  const payload = await fetchJson<Envelope<T>>(`${BASE}${path}`, {
    provider: 'nasdaq',
    limiter: limiters.nasdaq,
    headers: HEADERS,
    timeoutMs: 25_000,
  });
  return payload.data;
}

/** Nasdaq writes class shares with a slash ("BRK/A"); its quote API expects a dot ("BRK.A"). */
function apiSymbol(symbol: string) {
  return encodeURIComponent(symbol.replace('/', '.').toUpperCase());
}

type ScreenerRow = {
  symbol: string;
  name: string;
  lastsale: string;
  netchange: string;
  pctchange: string;
  volume: string;
  marketCap: string;
  country: string;
  ipoyear: string;
  industry: string;
  sector: string;
};

export async function fetchStockUniverse(): Promise<SecurityRow[]> {
  const data = await get<{ rows: ScreenerRow[] }>('/screener/stocks?tableonly=true&download=true');
  const rows = data?.rows ?? [];
  return rows
    .filter((row) => row.symbol && row.name)
    .map((row) => {
      const symbol = normalizeSymbol(row.symbol);
      const industry = row.industry?.trim() || null;
      const sector = mapSector({ symbol, nasdaqSector: row.sector?.trim() || null, industry });
      return {
        symbol,
        name: cleanSecurityName(row.name),
        exchange: null,
        cik: null,
        sector,
        industry,
        country: row.country?.trim() || null,
        ipoYear: parseLooseNumber(row.ipoyear),
        price: parseLooseNumber(row.lastsale),
        change: parseLooseNumber(row.netchange),
        changePct: parseLooseNumber(row.pctchange),
        volume: parseLooseNumber(row.volume),
        marketCap: parseLooseNumber(row.marketCap) || null,
        isCommon: isCommonStock({ symbol: row.symbol, name: row.name }),
      } satisfies SecurityRow;
    });
}

type WatchlistRow = { symbol: string; lastSalePrice?: string; netChange?: string; percentageChange?: string; volume?: string };

/**
 * Latest quotes, 20 stocks per call (the endpoint silently drops the rest). The screener lags a session behind the quote API, so
 * the universe refresh overlays these on the largest companies.
 */
export async function fetchBatchQuotes(symbols: string[]) {
  const quotes = new Map<string, { price: number; change: number | null; changePct: number | null; volume: number | null }>();
  // One unknown ticker fails the whole request, so failed batches are split and retried.
  const load = async (batch: string[]): Promise<void> => {
    const query = batch.map((symbol) => `symbol=${apiSymbol(symbol).toLowerCase()}%7cstocks`).join('&');
    const rows = await get<WatchlistRow[]>(`/quote/watchlist?${query}`).catch(() => null);
    if (!rows) {
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await load(batch.slice(0, middle));
        await load(batch.slice(middle));
      }
      return;
    }
    for (const row of rows) {
      const price = parseLooseNumber(row.lastSalePrice);
      if (!row.symbol || price === null || price <= 0) continue;
      quotes.set(normalizeSymbol(row.symbol), {
        price,
        change: parseLooseNumber(row.netChange),
        changePct: parseLooseNumber(row.percentageChange),
        volume: parseLooseNumber(row.volume),
      });
    }
  };
  for (let index = 0; index < symbols.length; index += 20) await load(symbols.slice(index, index + 20));
  return quotes;
}

type HistoricalRow = { date: string; close: string; volume: string; open: string; high: string; low: string };

function parseUsDate(value: string) {
  const [month, day, year] = value.split('/').map(Number);
  if (!month || !day || !year) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

export async function fetchDailyHistory(
  symbol: string,
  options: { from: string; to: string; assetClass?: 'stocks' | 'etf' | 'index' },
): Promise<Candle[]> {
  const assetClass = options.assetClass ?? 'stocks';
  const data = await get<{ tradesTable?: { rows?: HistoricalRow[] | null } }>(
    `/quote/${apiSymbol(symbol)}/historical?assetclass=${assetClass}&fromdate=${options.from}&todate=${options.to}&limit=9999`,
  );
  const rows = data?.tradesTable?.rows ?? [];
  const candles: Candle[] = [];
  for (const row of rows) {
    const t = parseUsDate(row.date);
    const c = parseLooseNumber(row.close);
    if (t === null || c === null || c <= 0) continue;
    const o = parseLooseNumber(row.open) ?? c;
    const h = parseLooseNumber(row.high) ?? Math.max(o, c);
    const l = parseLooseNumber(row.low) ?? Math.min(o, c);
    candles.push({ t, o: o || c, h: h || c, l: l || c, c, v: parseLooseNumber(row.volume) });
  }
  return candles.sort((a, b) => a.t - b.t);
}

type InfoPayload = {
  symbol: string;
  companyName: string;
  exchange: string;
  primaryData?: {
    lastSalePrice?: string;
    netChange?: string;
    percentageChange?: string;
    lastTradeTimestamp?: string;
    isRealTime?: boolean;
    volume?: string;
  };
  keyStats?: { fiftyTwoWeekHighLow?: { value?: string } };
};

export async function fetchQuote(symbol: string, assetClass: 'stocks' | 'etf' = 'stocks'): Promise<Quote | null> {
  const data = await get<InfoPayload>(`/quote/${apiSymbol(symbol)}/info?assetclass=${assetClass}`);
  const primary = data?.primaryData;
  if (!primary) return null;
  const price = parseLooseNumber(primary.lastSalePrice);
  if (price === null) return null;
  const change = parseLooseNumber(primary.netChange);
  const stamp = primary.lastTradeTimestamp?.replace(/^.*?(?:as of|DATA AS OF)\s*/i, '');
  const parsed = stamp ? Date.parse(stamp) : NaN;
  return {
    symbol: normalizeSymbol(symbol),
    price,
    change,
    changePct: parseLooseNumber(primary.percentageChange),
    previousClose: change !== null ? price - change : null,
    volume: parseLooseNumber(primary.volume),
    timestamp: Number.isFinite(parsed) ? parsed : Date.now(),
    source: 'Nasdaq',
    realtime: Boolean(primary.isRealTime),
  };
}

type Labeled = { label?: string; value?: string | null };

type ForecastRow = { consensusEPSForecast?: unknown };

/** Next-twelve-months consensus EPS: the sum of the next four quarterly estimates. */
async function fetchForwardEps(symbol: string) {
  const data = await get<{ quarterlyForecast?: { rows?: ForecastRow[] | null } }>(`/analyst/${apiSymbol(symbol)}/earnings-forecast`).catch(() => null);
  const rows = (data?.quarterlyForecast?.rows ?? []).slice(0, 4);
  const values = rows.map((row) => parseLooseNumber(row.consensusEPSForecast));
  if (values.length < 4 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

type YearlyForecastRow = { fiscalEnd?: string; consensusEPSForecast?: unknown; highEPSForecast?: unknown; lowEPSForecast?: unknown; noOfEstimates?: unknown };

/** Consensus EPS for the next fiscal years (usually two to three), with the analyst range. */
export async function fetchYearlyEpsForecast(symbol: string) {
  const data = await get<{ yearlyForecast?: { rows?: YearlyForecastRow[] | null } }>(`/analyst/${apiSymbol(symbol)}/earnings-forecast`);
  return (data?.yearlyForecast?.rows ?? [])
    .map((row) => ({
      fiscalEnd: row.fiscalEnd ?? '',
      eps: parseLooseNumber(row.consensusEPSForecast),
      high: parseLooseNumber(row.highEPSForecast),
      low: parseLooseNumber(row.lowEPSForecast),
      analysts: parseLooseNumber(row.noOfEstimates),
    }))
    .filter((row) => row.fiscalEnd && row.eps !== null);
}

export async function fetchSummary(symbol: string) {
  const [data, forwardEps] = await Promise.all([
    get<{ summaryData?: Record<string, Labeled> }>(`/quote/${apiSymbol(symbol)}/summary?assetclass=stocks`),
    fetchForwardEps(symbol),
  ]);
  const summary = data?.summaryData ?? {};
  const value = (key: string) => summary[key]?.value ?? null;
  const [high52, low52] = (value('FiftTwoWeekHighLow') ?? '').split('/').map(parseLooseNumber);
  return {
    exchange: value('Exchange'),
    sector: value('Sector'),
    industry: value('Industry'),
    oneYearTarget: parseLooseNumber(value('OneYrTarget') ?? value('OneYearTarget')),
    averageVolume: parseLooseNumber(value('AverageVolume')),
    previousClose: parseLooseNumber(value('PreviousClose')),
    marketCap: parseLooseNumber(value('MarketCap')),
    peRatio: parseLooseNumber(value('PERatio')),
    forwardPE: parseLooseNumber(value('ForwardPE1Yr')) ?? (() => {
      const price = parseLooseNumber(value('PreviousClose'));
      return price !== null && forwardEps !== null && forwardEps > 0 ? price / forwardEps : null;
    })(),
    eps: parseLooseNumber(value('EarningsPerShare')),
    annualDividend: parseLooseNumber(value('AnnualizedDividend')),
    exDividendDate: value('ExDividendDate'),
    dividendYield: (() => {
      const yieldValue = parseLooseNumber(value('Yield'));
      return yieldValue === null ? null : yieldValue / 100;
    })(),
    high52: high52 ?? null,
    low52: low52 ?? null,
  };
}

export async function fetchCompanyDescription(symbol: string) {
  const data = await get<Record<string, Labeled>>(`/company/${apiSymbol(symbol)}/company-profile`);
  if (!data) return null;
  const read = (key: string) => {
    const value = data[key]?.value;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return {
    name: read('CompanyName'),
    description: read('CompanyDescription'),
    sector: read('Sector'),
    industry: read('Industry'),
    region: read('Region'),
    website: read('CompanyUrl'),
  };
}

// ─── RSS news ───────────────────────────────────────────────────────────────

const xml = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });

type RssItem = { title?: string; link?: string; description?: string; pubDate?: string; guid?: string; creator?: string; category?: string; tickers?: string };

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

async function fetchRss(url: string, fallbackSource = 'Nasdaq'): Promise<NewsItem[]> {
  const text = await fetchText(url, { provider: 'nasdaq-rss', limiter: limiters.news, headers: { 'User-Agent': BROWSER_UA } });
  const parsed = xml.parse(text) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const raw = parsed.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .filter((item) => item.title && item.link)
    .map((item) => {
      const published = item.pubDate ? Date.parse(item.pubDate) : NaN;
      const symbols = [...new Set(String(item.tickers ?? '').split(',').map((entry) => normalizeSymbol(entry)).filter(Boolean))];
      return {
        id: `nasdaq:${item.link}`,
        title: stripHtml(String(item.title)),
        url: String(item.link),
        source: item.creator ? String(item.creator) : fallbackSource,
        publishedAt: new Date(Number.isFinite(published) ? published : Date.now()).toISOString(),
        summary: item.description ? stripHtml(String(item.description)).replace(/^\s*Key Points\s*/i, '').slice(0, 400) || undefined : undefined,
        symbols,
        provider: 'nasdaq' as const,
        category: item.category ? String(item.category) : undefined,
      };
    });
}

export function fetchSymbolNews(symbol: string) {
  return fetchRss(`https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(symbol.replace('.', '-'))}`);
}

export function fetchCategoryNews(category: 'Markets' | 'Earnings' | 'Stocks' | 'Technology' | 'Commodities') {
  return fetchRss(`https://www.nasdaq.com/feed/rssoutbound?category=${encodeURIComponent(category)}`);
}

/** Other free, keyless market feeds that publish faster than Nasdaq's syndicated articles. */
const PUBLISHER_FEEDS = [
  { source: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
  { source: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664' },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
];

export async function fetchPublisherNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(PUBLISHER_FEEDS.map((feed) => fetchRss(feed.url, feed.source)));
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

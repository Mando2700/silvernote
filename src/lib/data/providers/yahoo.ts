import 'server-only';

import { getAsset } from '@/lib/data/assets';
import { fetchJson, limiters } from '@/lib/data/http';
import type { Candle } from '@/lib/data/types';
import type { Split } from '@/lib/finance/ledger';

/**
 * Yahoo Finance chart API (keyless, unofficial): used only for the split history, which none of the
 * other free sources expose. When it fails, callers infer splits from prices instead.
 */

type ChartPayload = {
  chart?: {
    result?: Array<{ events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> } }> | null;
    error?: { description?: string } | null;
  };
};

function newYorkDate(epochSeconds: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Every split on record for a US ticker, oldest first (factor = new shares per old share). */
export async function fetchSplits(symbol: string): Promise<Split[]> {
  const ticker = encodeURIComponent(symbol.toUpperCase().replace('.', '-'));
  const payload = await fetchJson<ChartPayload>(`https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?range=max&interval=3mo&events=split`, {
    provider: 'yahoo',
    limiter: limiters.yahoo,
    // Yahoo rate-limits full browser user agents that arrive without its cookies; a bare one is served.
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const events = payload.chart?.result?.[0]?.events?.splits ?? {};
  return Object.values(events)
    .filter((event) => event.numerator > 0 && event.denominator > 0 && Number.isFinite(event.date))
    .map((event) => ({ date: newYorkDate(event.date), factor: event.numerator / event.denominator }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

type IntradayPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
    }> | null;
  };
};

/** Yahoo's symbol for an app ticker: commodities and crypto map to their own, share classes use a dash. */
export function yahooTicker(symbol: string) {
  return getAsset(symbol)?.yahoo ?? symbol.toUpperCase().replace('.', '-');
}

/** Regular-session intraday OHLC bars (`interval` like 5m / 15m / 60m) for roughly the last `days` calendar days. */
export async function fetchIntradayCandles(symbol: string, interval: string, days: number): Promise<Candle[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - Math.ceil(days * 86_400);
  return fetchCandles(symbol, interval, period1, period2);
}

/** Daily OHLC bars from `from` (YYYY-MM-DD) to now: the history for commodities and crypto, which Nasdaq doesn't serve. */
export async function fetchDailyCandles(symbol: string, from: string): Promise<Candle[]> {
  return fetchCandles(symbol, '1d', Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000), Math.floor(Date.now() / 1000));
}

async function fetchCandles(symbol: string, interval: string, period1: number, period2: number): Promise<Candle[]> {
  const ticker = encodeURIComponent(yahooTicker(symbol));
  const payload = await fetchJson<IntradayPayload>(
    `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=${interval}&includePrePost=false`,
    { provider: 'yahoo', limiter: limiters.yahoo, headers: { 'User-Agent': 'Mozilla/5.0' } },
  );
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const times = result?.timestamp ?? [];
  const candles: Candle[] = [];
  times.forEach((t, index) => {
    const o = quote?.open?.[index];
    const h = quote?.high?.[index];
    const l = quote?.low?.[index];
    const c = quote?.close?.[index];
    if (o == null || h == null || l == null || c == null) return;
    candles.push({ t, o, h, l, c, v: quote?.volume?.[index] ?? null });
  });
  return candles;
}

type DayPayload = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }> | null;
  };
};

export type YahooDay = { symbol: string; price: number; previousClose: number | null; change: number | null; changePct: number | null; time: number; spark: number[]; currency: string | null };

/**
 * Last price, prior close and today's 5-minute path for any Yahoo symbol: indices (^GSPC), futures
 * (CL=F), currencies (EURUSD=X), yields (^TNX) and crypto (BTC-USD) — none of which the other free
 * sources quote.
 */
export async function fetchYahooDay(symbol: string): Promise<YahooDay | null> {
  const payload = await fetchJson<DayPayload>(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(getAsset(symbol)?.yahoo ?? symbol)}?range=1d&interval=5m`, {
    provider: 'yahoo',
    limiter: limiters.yahoo,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const result = payload.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  if (!result || typeof price !== 'number' || !Number.isFinite(price)) return null;
  const previousClose = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? null;
  const change = previousClose ? price - previousClose : null;
  return {
    symbol,
    price,
    previousClose,
    change,
    changePct: change !== null && previousClose ? (change / previousClose) * 100 : null,
    time: (result.meta?.regularMarketTime ?? Math.floor(Date.now() / 1000)) * 1000,
    spark: (result.indicators?.quote?.[0]?.close ?? []).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    currency: result.meta?.currency ?? null,
  };
}

/** Daily closes for any Yahoo symbol over `range` (e.g. 1y, 5y), oldest first. */
export async function fetchYahooDaily(symbol: string, range = '1y'): Promise<Array<{ t: number; c: number }>> {
  const payload = await fetchJson<DayPayload>(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, {
    provider: 'yahoo',
    limiter: limiters.yahoo,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const result = payload.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  return (result?.timestamp ?? [])
    .map((t, index) => ({ t, c: closes[index] }))
    .filter((point): point is { t: number; c: number } => typeof point.c === 'number' && Number.isFinite(point.c));
}

type MetaPayload = {
  chart?: {
    result?: Array<{
      meta?: {
        fullExchangeName?: string;
        shortName?: string;
        currency?: string;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
        firstTradeDate?: number;
      };
    }> | null;
  };
};

export type YahooMeta = {
  exchange: string | null;
  /** The contract being quoted, e.g. "Gold Dec 26" for the front-month future. */
  contract: string | null;
  currency: string | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  high52: number | null;
  low52: number | null;
  /** Epoch seconds of the first day Yahoo has data for. */
  firstTrade: number | null;
};

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Today's range and volume, the 52-week range and the listing details Yahoo keeps on any chart. */
export async function fetchYahooMeta(symbol: string): Promise<YahooMeta | null> {
  const payload = await fetchJson<MetaPayload>(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker(symbol))}?range=1d&interval=1d`, {
    provider: 'yahoo',
    limiter: limiters.yahoo,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const meta = payload.chart?.result?.[0]?.meta;
  if (!meta) return null;
  return {
    exchange: meta.fullExchangeName ?? null,
    contract: meta.shortName ?? null,
    currency: meta.currency ?? null,
    dayHigh: num(meta.regularMarketDayHigh),
    dayLow: num(meta.regularMarketDayLow),
    volume: num(meta.regularMarketVolume),
    high52: num(meta.fiftyTwoWeekHigh),
    low52: num(meta.fiftyTwoWeekLow),
    firstTrade: num(meta.firstTradeDate),
  };
}

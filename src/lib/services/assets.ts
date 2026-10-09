import 'server-only';

import { getAsset, GLOBEX_HOURS } from '@/lib/data/assets';
import { cached } from '@/lib/data/http';
import { type CoinDetails, fetchCoin } from '@/lib/data/providers/coingecko';
import { fetchYahooMeta, type YahooMeta } from '@/lib/data/providers/yahoo';
import type { Candle } from '@/lib/data/types';
import { getCandles } from '@/lib/services/prices';

const DAY = 86_400;

export type AssetPerformance = { label: string; value: number | null };

export type AssetDetails = {
  symbol: string;
  kind: 'commodity' | 'crypto';
  market: YahooMeta | null;
  performance: AssetPerformance[];
  /** Annualized standard deviation of daily returns over the last 30 sessions. */
  volatility30d: number | null;
  /** Deepest peak-to-trough fall in daily closes over the last year (negative). */
  maxDrawdown1y: number | null;
  /** Highest and lowest close in the stored history, which reaches back `historyYears`. */
  historyHigh: { price: number; t: number } | null;
  historyLow: { price: number; t: number } | null;
  historyYears: number | null;
  contract: { size: string; tick: string; hours: string } | null;
  coin: CoinDetails | null;
};

/** The last close at or before `t`. */
function closeAt(candles: Candle[], t: number) {
  let found: number | null = null;
  for (const candle of candles) {
    if (candle.t > t) break;
    found = candle.c;
  }
  return found;
}

export function performance(candles: Candle[], now = Date.now() / 1000): AssetPerformance[] {
  const last = candles[candles.length - 1];
  const first = candles[0];
  const change = (start: number) => {
    if (!last || !first || first.t > start + 7 * DAY) return null;
    const base = closeAt(candles, start);
    return base ? last.c / base - 1 : null;
  };
  const yearStart = Date.UTC(new Date(now * 1000).getUTCFullYear(), 0, 1) / 1000;
  return [
    { label: '1W', value: change(now - 7 * DAY) },
    { label: '1M', value: change(now - 30 * DAY) },
    { label: '3M', value: change(now - 91 * DAY) },
    { label: 'YTD', value: change(yearStart - DAY) },
    { label: '1Y', value: change(now - 365 * DAY) },
    { label: '3Y', value: change(now - 3 * 365 * DAY) },
    { label: '5Y', value: change(now - 5 * 365 * DAY) },
    { label: '10Y', value: change(now - 10 * 365 * DAY) },
  ];
}

export function volatility(candles: Candle[], sessions: number, periodsPerYear: number) {
  const closes = candles.slice(-(sessions + 1)).map((candle) => candle.c);
  if (closes.length < sessions / 2) return null;
  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * periodsPerYear);
}

export function maxDrawdown(candles: Candle[]) {
  let peak = -Infinity;
  let worst = 0;
  for (const candle of candles) {
    peak = Math.max(peak, candle.c);
    worst = Math.min(worst, candle.c / peak - 1);
  }
  return candles.length ? worst : null;
}

export async function getAssetDetails(symbol: string): Promise<AssetDetails | null> {
  const asset = getAsset(symbol);
  if (!asset) return null;
  const [market, coin, candles] = await Promise.all([
    cached(`asset-meta:${asset.symbol}`, 60, () => fetchYahooMeta(asset.symbol)).catch(() => null),
    asset.coingecko ? cached(`coingecko:${asset.coingecko}`, 10 * 60, () => fetchCoin(asset.coingecko as string)).catch(() => null) : Promise.resolve(null),
    getCandles(asset.symbol, 10).catch(() => []),
  ]);
  const now = Date.now() / 1000;
  const year = candles.filter((candle) => candle.t >= now - 365 * DAY);
  let high: Candle | null = null;
  let low: Candle | null = null;
  for (const candle of candles) {
    if (!high || candle.c > high.c) high = candle;
    if (!low || candle.c < low.c) low = candle;
  }
  return {
    symbol: asset.symbol,
    kind: asset.kind,
    market,
    performance: performance(candles, now),
    // Crypto trades every day of the year; futures roughly 252 sessions.
    volatility30d: volatility(candles, 30, asset.kind === 'crypto' ? 365 : 252),
    maxDrawdown1y: maxDrawdown(year),
    historyHigh: high ? { price: high.c, t: high.t } : null,
    historyLow: low ? { price: low.c, t: low.t } : null,
    historyYears: candles.length ? Math.round(((now - candles[0].t) / (365.25 * DAY)) * 10) / 10 : null,
    contract: asset.contract ? { ...asset.contract, hours: GLOBEX_HOURS } : null,
    coin,
  };
}

import 'server-only';

import { q, q1 } from '@/lib/db';
import { memo } from '@/lib/data/http';
import { fetchDailyHistory as fmpHistory, fmpEnabled } from '@/lib/data/providers/fmp';
import { fetchFredSeries } from '@/lib/data/providers/fred';
import { fetchDailyHistory } from '@/lib/data/providers/nasdaq';
import type { Candle } from '@/lib/data/types';

/** Funds and indexes the app references that live in Nasdaq's "etf" asset class. */
const ETF_SYMBOLS = new Set([
  'SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'VOO', 'VT', 'EFA', 'EEM', 'AGG', 'TLT', 'IEF', 'SHY', 'GLD', 'SLV', 'USO', 'HYG', 'LQD',
  'XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC', 'SMH', 'ARKK', 'VNQ', 'BND', 'SCHD',
]);

type StoredRow = { candles: Array<[number, number, number, number, number, number | null]>; first_date: string | null; last_date: string | null; fetched_at: Date };

const toCandle = ([t, o, h, l, c, v]: [number, number, number, number, number, number | null]): Candle => ({ t, o, h, l, c, v });
const toTuple = (candle: Candle): [number, number, number, number, number, number | null] => [candle.t, candle.o, candle.h, candle.l, candle.c, candle.v];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Most recent weekday whose US session has closed (holidays are tolerated by the refetch throttle). */
export function lastSessionDate(now = new Date()) {
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const afterClose = ny.getHours() > 16 || (ny.getHours() === 16 && ny.getMinutes() >= 15);
  const date = new Date(Date.UTC(ny.getFullYear(), ny.getMonth(), ny.getDate()));
  if (!afterClose) date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
}

export function isMarketOpen(now = new Date()) {
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = ny.getHours() * 60 + ny.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function merge(existing: Candle[], incoming: Candle[]) {
  const map = new Map<number, Candle>();
  for (const candle of existing) map.set(candle.t, candle);
  for (const candle of incoming) map.set(candle.t, candle);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

async function download(symbol: string, from: string, to: string): Promise<{ candles: Candle[]; source: string }> {
  const assetClass = ETF_SYMBOLS.has(symbol) ? 'etf' : 'stocks';
  try {
    let candles = await fetchDailyHistory(symbol, { from, to, assetClass });
    if (!candles.length && assetClass === 'stocks') candles = await fetchDailyHistory(symbol, { from, to, assetClass: 'etf' });
    if (candles.length) return { candles, source: 'nasdaq' };
  } catch {
    // fall through to FMP
  }
  if (fmpEnabled()) {
    const candles = await fmpHistory(symbol, from).catch(() => []);
    if (candles.length) return { candles, source: 'fmp' };
  }
  return { candles: [], source: 'none' };
}

/**
 * Daily candles for at least `years` of history (Nasdaq serves up to ~10 years).
 * Stored per symbol and topped up incrementally once the next session closes.
 */
export async function getCandles(symbol: string, years = 2): Promise<Candle[]> {
  const upper = symbol.toUpperCase();
  return memo(`candles:${upper}:${years}`, 60_000, async () => {
    const row = await q1<StoredRow>(
      'select candles, first_date::text as first_date, last_date::text as last_date, fetched_at from public.price_history where symbol = $1',
      [upper],
    );
    const wantedStart = new Date(Date.now() - years * 365.25 * 86_400_000);
    const session = lastSessionDate();
    const existing = row ? row.candles.map(toCandle) : [];
    const coversStart = row?.first_date ? row.first_date <= isoDate(new Date(wantedStart.getTime() + 10 * 86_400_000)) : false;
    const upToDate = row?.last_date ? row.last_date >= session : false;
    const recentlyFetched = row ? Date.now() - new Date(row.fetched_at).getTime() < 4 * 3_600_000 : false;
    if (row && coversStart && (upToDate || recentlyFetched)) return trimTo(existing, wantedStart);

    let from = isoDate(wantedStart);
    if (row && coversStart && row.last_date) {
      from = isoDate(new Date(Date.parse(row.last_date) - 7 * 86_400_000));
    }
    const { candles, source } = await download(upper, from, isoDate(new Date()));
    const merged = merge(coversStart ? existing : [], candles.length ? candles : []);
    const finalCandles = merged.length ? merged : existing;
    if (finalCandles.length) {
      await q(
        `insert into public.price_history (symbol, candles, first_date, last_date, source, fetched_at)
         values ($1, $2::jsonb, $3::date, $4::date, $5, now())
         on conflict (symbol) do update set candles = excluded.candles, first_date = excluded.first_date,
           last_date = excluded.last_date, source = excluded.source, fetched_at = now()`,
        [
          upper,
          JSON.stringify(finalCandles.map(toTuple)),
          isoDate(new Date(finalCandles[0].t * 1000)),
          isoDate(new Date(finalCandles[finalCandles.length - 1].t * 1000)),
          source,
        ],
      );
    }
    return trimTo(finalCandles, wantedStart);
  });
}

function trimTo(candles: Candle[], start: Date) {
  const cutoff = Math.floor(start.getTime() / 1000);
  return candles.filter((candle) => candle.t >= cutoff);
}

export async function getCandlesForMany(symbols: string[], years = 2, concurrency = 3) {
  const result = new Map<string, Candle[]>();
  const queue = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const symbol = queue.shift();
        if (!symbol) return;
        result.set(symbol, await getCandles(symbol, years).catch(() => []));
      }
    }),
  );
  return result;
}

/** Long history for market proxies (NASDAQ Composite from 1971) — used by the 2008 stress test. */
export async function getIndexHistory(seriesId: 'NASDAQCOM' | 'SP500', start: string, end: string) {
  return memo(`fred:${seriesId}:${start}:${end}`, 24 * 3_600_000, async () => {
    const points = await fetchFredSeries(seriesId, start, end);
    return points.map((point) => ({ t: Math.floor(Date.parse(`${point.date}T00:00:00Z`) / 1000), c: point.value }));
  });
}

/** Annualized 3-month Treasury bill yield (as a fraction), for Sharpe and Sortino. */
export async function getRiskFreeRate() {
  return memo('fred:DGS3MO', 12 * 3_600_000, async () => {
    try {
      const start = isoDate(new Date(Date.now() - 30 * 86_400_000));
      const points = await fetchFredSeries('DGS3MO', start);
      const last = points[points.length - 1];
      return last ? last.value / 100 : 0.04;
    } catch {
      return 0.04;
    }
  });
}

export async function pricesStorageStats() {
  return q1<{ symbols: number }>('select count(*)::int as symbols from public.price_history');
}

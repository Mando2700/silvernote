import 'server-only';

import { q, q1 } from '@/lib/db';
import { getAsset } from '@/lib/data/assets';
import { cached, forget, inBackground, keepAlive, memo, runInBackground } from '@/lib/data/http';
import { fetchDailyHistory as fmpHistory, fmpEnabled } from '@/lib/data/providers/fmp';
import { fetchFredSeries } from '@/lib/data/providers/fred';
import { fetchDailyHistory } from '@/lib/data/providers/nasdaq';
import { fetchDailyCandles } from '@/lib/data/providers/yahoo';
import type { Candle } from '@/lib/data/types';

/** Funds and indexes the app references that live in Nasdaq's "etf" asset class. */
const ETF_SYMBOLS = new Set([
  'SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'VOO', 'VT', 'EFA', 'EEM', 'AGG', 'TLT', 'IEF', 'SHY', 'GLD', 'SLV', 'USO', 'HYG', 'LQD',
  'XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC', 'SMH', 'ARKK', 'VNQ', 'BND', 'SCHD',
]);

type StoredRow = {
  candles: Array<[number, number, number, number, number, number | null]>;
  first_date: string | null;
  last_date: string | null;
  fetched_at: Date;
  adjusted_at: Date | null;
};

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
  if (getAsset(symbol)) {
    const candles = await fetchDailyCandles(symbol, from).catch(() => []);
    return { candles, source: candles.length ? 'yahoo' : 'none' };
  }
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
 * True when freshly downloaded closes disagree with the stored ones on the days they share: the
 * history has been re-adjusted since it was stored (a split or similar), so the stored part is stale.
 */
export function historyRebased(existing: Candle[], incoming: Candle[]) {
  const stored = new Map(existing.map((candle) => [candle.t, candle.c]));
  const ratios = incoming.filter((candle) => stored.has(candle.t)).map((candle) => candle.c / (stored.get(candle.t) as number));
  if (!ratios.length) return false;
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  return Math.abs(median - 1) > 0.02;
}

/**
 * Daily candles for at least `years` of history (Nasdaq serves up to ~10 years), split-adjusted.
 * Stored per symbol and topped up incrementally once the next session closes. A top-up that no
 * longer lines up with the stored closes (a split since) replaces the whole history.
 */
export async function getCandles(symbol: string, years = 2): Promise<Candle[]> {
  const upper = symbol.toUpperCase();
  return memo(`candles:${upper}:${years}`, 60_000, async () => {
    const row = await q1<StoredRow>(`select ${STORED_COLUMNS} from public.price_history where symbol = $1`, [upper]);
    return resolveCandles(upper, years, row);
  });
}

const STORED_COLUMNS = 'candles, first_date::text as first_date, last_date::text as last_date, fetched_at, adjusted_at';

/** A symbol's stored history, downloaded or topped up as needed. */
async function resolveCandles(upper: string, years: number, row: StoredRow | null): Promise<Candle[]> {
  const wantedStart = new Date(Date.now() - years * 365.25 * 86_400_000);
  const session = lastSessionDate();
  const existing = row ? row.candles.map(toCandle) : [];
  const coversStart = row?.first_date ? row.first_date <= isoDate(new Date(wantedStart.getTime() + 10 * 86_400_000)) : false;
  const upToDate = row?.last_date ? row.last_date >= session : false;
  const recentlyFetched = row ? Date.now() - new Date(row.fetched_at).getTime() < 4 * 3_600_000 : false;
  // Rows stored before split checks existed are downloaded again in full once.
  const trusted = Boolean(row?.adjusted_at);
  if (row && trusted && coversStart && (upToDate || recentlyFetched)) return trimTo(existing, wantedStart);
  if (row && !trusted && recentlyFetched && coversStart) return trimTo(existing, wantedStart);
  // A page gets the stored history at once; missing sessions (or older years) download in the
  // background. A history fetched in the last few hours that still starts late is a young listing:
  // there is nothing older to fetch. Jobs wait, as they are there to bring the data up to date.
  if (row && trusted && existing.length && !inBackground()) {
    if (!recentlyFetched) {
      keepAlive(
        runInBackground(() => refreshHistory(upper, row, existing, wantedStart)).finally(() => forget(`candles:${upper}:`)),
      );
    }
    return trimTo(existing, wantedStart);
  }
  return trimTo(await refreshHistory(upper, row, existing, wantedStart), wantedStart);
}

const refreshingHistory = new Map<string, Promise<Candle[]>>();

/** Download what's missing (or everything, when needed) and store it; one download per symbol at a time. */
function refreshHistory(upper: string, row: StoredRow | null, existing: Candle[], wantedStart: Date): Promise<Candle[]> {
  const pending = refreshingHistory.get(upper);
  if (pending) return pending;
  const promise = downloadHistory(upper, row, existing, wantedStart).finally(() => refreshingHistory.delete(upper));
  refreshingHistory.set(upper, promise);
  return promise;
}

async function downloadHistory(upper: string, row: StoredRow | null, existing: Candle[], wantedStart: Date): Promise<Candle[]> {
  const trusted = Boolean(row?.adjusted_at);
  const coversStart = row?.first_date ? row.first_date <= isoDate(new Date(wantedStart.getTime() + 10 * 86_400_000)) : false;
  // Keep at least the history already stored when re-downloading in full.
  const fullFrom = isoDate(row?.first_date && row.first_date < isoDate(wantedStart) ? new Date(`${row.first_date}T00:00:00Z`) : wantedStart);
  let full = !(row && trusted && coversStart && row.last_date);
  let { candles, source } = await download(upper, full ? fullFrom : isoDate(new Date(Date.parse(row?.last_date as string) - 7 * 86_400_000)), isoDate(new Date()));
  if (!full && candles.length && historyRebased(existing, candles)) {
    full = true;
    ({ candles, source } = await download(upper, fullFrom, isoDate(new Date())));
  }
  const downloaded = candles.length > 0;
  const merged = full ? candles : merge(existing, candles);
  const finalCandles = merged.length ? merged : existing;
  if (finalCandles.length) {
    await q(
      `insert into public.price_history (symbol, candles, first_date, last_date, source, fetched_at, adjusted_at)
       values ($1, $2::jsonb, $3::date, $4::date, coalesce($5, 'none'), now(), case when $6 then now() else null end)
       on conflict (symbol) do update set candles = excluded.candles, first_date = excluded.first_date,
         last_date = excluded.last_date, source = coalesce($5, price_history.source), fetched_at = now(),
         adjusted_at = case when $6 then now() else price_history.adjusted_at end`,
      [
        upper,
        JSON.stringify(finalCandles.map(toTuple)),
        isoDate(new Date(finalCandles[0].t * 1000)),
        isoDate(new Date(finalCandles[finalCandles.length - 1].t * 1000)),
        downloaded ? source : null,
        full && downloaded,
      ],
    );
  }
  return finalCandles;
}

function trimTo(candles: Candle[], start: Date) {
  const cutoff = Math.floor(start.getTime() / 1000);
  return candles.filter((candle) => candle.t >= cutoff);
}

export async function getCandlesForMany(symbols: string[], years = 2, concurrency = 3) {
  const result = new Map<string, Candle[]>();
  const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
  // One query for every stored history instead of a round trip per symbol.
  const stored = await q<StoredRow & { symbol: string }>(
    `select symbol, ${STORED_COLUMNS} from public.price_history where symbol = any($1::text[])`,
    [unique],
  ).catch(() => []);
  const rows = new Map(stored.map((row) => [row.symbol, row]));
  const queue = [...unique];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const symbol = queue.shift();
        if (!symbol) return;
        const load = () => resolveCandles(symbol, years, rows.get(symbol) ?? null);
        result.set(symbol, await memo(`candles:${symbol}:${years}`, 60_000, load).catch(() => []));
      }
    }),
  );
  return result;
}

/** Long history for market proxies (NASDAQ Composite from 1971) — used by the 2008 stress test. */
export async function getIndexHistory(seriesId: 'NASDAQCOM' | 'SP500', start: string, end: string) {
  return cached(`fred:${seriesId}:${start}:${end}`, 24 * 3600, async () => {
    const points = await fetchFredSeries(seriesId, start, end);
    return points.map((point) => ({ t: Math.floor(Date.parse(`${point.date}T00:00:00Z`) / 1000), c: point.value }));
  });
}

/** Annualized 3-month Treasury bill yield (as a fraction), for Sharpe and Sortino. */
export async function getRiskFreeRate() {
  // Shared through the cache: FRED can be slow to answer, and the rate moves at most daily.
  return cached('fred:DGS3MO', 12 * 3600, async () => {
    const start = isoDate(new Date(Date.now() - 30 * 86_400_000));
    const points = await fetchFredSeries('DGS3MO', start);
    const last = points[points.length - 1];
    if (!last) throw new Error('no DGS3MO observations');
    return last.value / 100;
  }).catch(() => 0.04);
}

export async function pricesStorageStats() {
  return q1<{ symbols: number }>('select count(*)::int as symbols from public.price_history');
}

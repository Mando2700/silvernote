import type { Candle } from '@/lib/data/types';

export type CandleResolution = '5m' | '15m' | '1h' | 'halfday' | 'day' | '2day' | 'week' | '2week' | 'month';

/**
 * Bar size per chart range. Every range aims at the density of 6M on daily bars (~125 candles):
 * intraday bars for 1D–3M, daily to two-day bars up to a year, then weekly, fortnightly and monthly bars.
 */
export function resolutionForRange(range: string): CandleResolution {
  switch (range) {
    case '1d':
      return '5m';
    case '1w':
      return '15m';
    case '1m':
      return '1h';
    case '3m':
      return 'halfday';
    case '1y':
      return '2day';
    case '3y':
      return 'week';
    case '5y':
      return '2week';
    case '10y':
      return 'month';
    default:
      return 'day';
  }
}

/** Resolutions built from Yahoo intraday bars: the source interval and how many calendar days one page spans. */
export const INTRADAY_SOURCE: Partial<Record<CandleResolution, { interval: string; days: number; maxDays: number }>> = {
  '5m': { interval: '5m', days: 1, maxDays: 59 },
  '15m': { interval: '15m', days: 7, maxDays: 59 },
  '1h': { interval: '60m', days: 31, maxDays: 729 },
  halfday: { interval: '60m', days: 92, maxDays: 729 },
};

export function isIntraday(resolution: CandleResolution) {
  return resolution in INTRADAY_SOURCE;
}

const DAY = 86_400;

/** Monday 00:00 UTC of the week containing `t` (unix seconds). */
function weekStart(t: number) {
  const day = Math.floor(t / DAY);
  // 1970-01-01 was a Thursday, so shift by 3 to make Monday the week boundary.
  return (day - ((day + 3) % 7)) * DAY;
}

/** First-of-month 00:00 UTC of the month containing `t` (unix seconds). */
function monthStart(t: number) {
  const d = new Date(t * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

const newYorkParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });

/** Morning or afternoon half of the New York session containing `t`. */
function halfDayKey(t: number) {
  const parts = newYorkParts.formatToParts(new Date(t * 1000));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return ((get('year') * 13 + get('month')) * 32 + get('day')) * 2 + (get('hour') >= 13 ? 1 : 0);
}

function merge(bars: Candle[], bucketFor: (candle: Candle, index: number) => number): Candle[] {
  const out: Candle[] = [];
  let key: number | null = null;
  bars.forEach((candle, index) => {
    const bucket = bucketFor(candle, index);
    const bar = out[out.length - 1];
    if (bar && bucket === key) {
      bar.h = Math.max(bar.h, candle.h);
      bar.l = Math.min(bar.l, candle.l);
      bar.c = candle.c;
      bar.v = bar.v === null && candle.v === null ? null : (bar.v ?? 0) + (candle.v ?? 0);
    } else {
      out.push({ ...candle });
      key = bucket;
    }
  });
  return out;
}

/** Rolls sorted candles into bars; each bar keeps its first candle's timestamp. Intraday resolutions expect intraday input. */
export function aggregateCandles(candles: Candle[], resolution: CandleResolution): Candle[] {
  switch (resolution) {
    case 'halfday':
      return merge(candles, (candle) => halfDayKey(candle.t));
    case '2day':
      // Pair sessions counting back from the latest, so the newest bar always holds the last two sessions.
      return merge(candles, (_, index) => Math.floor((candles.length - 1 - index) / 2));
    case 'week':
      return merge(candles, (candle) => weekStart(candle.t));
    case '2week':
      return merge(candles, (candle) => Math.floor(weekStart(candle.t) / (14 * DAY)));
    case 'month':
      return merge(candles, (candle) => monthStart(candle.t));
    default:
      return candles;
  }
}

/** New York trading date (YYYY-MM-DD) of a unix timestamp; a fixed 5-hour offset is close enough for session bars. */
export function sessionDate(t: number) {
  return new Date(t * 1000 - 5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Stored daily history only holds completed sessions. Rolls the latest session in `intraday` into
 * one daily bar and appends it when it is newer than the last daily bar, so long-range charts reach today.
 */
export function withLatestSession(daily: Candle[], intraday: Candle[]): Candle[] {
  const latest = intraday[intraday.length - 1];
  if (!latest) return daily;
  const date = sessionDate(latest.t);
  const last = daily[daily.length - 1];
  // Daily bars are stamped at 00:00 UTC of their trading date.
  if (last && new Date(last.t * 1000).toISOString().slice(0, 10) >= date) return daily;
  const session = intraday.filter((candle) => sessionDate(candle.t) === date);
  const volumes = session.map((candle) => candle.v).filter((v): v is number => v !== null);
  const bar: Candle = {
    t: Date.parse(`${date}T00:00:00Z`) / 1000,
    o: session[0].o,
    h: Math.max(...session.map((candle) => candle.h)),
    l: Math.min(...session.map((candle) => candle.l)),
    c: latest.c,
    v: volumes.length ? volumes.reduce((sum, v) => sum + v, 0) : null,
  };
  return [...daily, bar];
}

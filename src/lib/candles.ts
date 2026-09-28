import type { Candle } from '@/lib/data/types';

export type CandleResolution = 'day' | 'week' | 'month';

/**
 * Bar size per chart range, matching Nestor's density ladder: daily bars up to one year,
 * weekly bars for multi-year ranges, and monthly bars past 5 years, so every range lands
 * at roughly 20–260 readable candles instead of ballooning to 500+.
 */
export function resolutionForRange(range: string): CandleResolution {
  if (range === '5y' || range === '10y') return 'month';
  if (range === '3y') return 'week';
  return 'day';
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

/** Rolls sorted daily candles into bars; each bar keeps its first session's timestamp. */
export function aggregateCandles(candles: Candle[], resolution: CandleResolution): Candle[] {
  if (resolution === 'day') return candles;
  const bucketFor = resolution === 'month' ? monthStart : weekStart;
  const bars: Candle[] = [];
  let key: number | null = null;
  for (const candle of candles) {
    const bucket = bucketFor(candle.t);
    const bar = bars[bars.length - 1];
    if (bar && bucket === key) {
      bar.h = Math.max(bar.h, candle.h);
      bar.l = Math.min(bar.l, candle.l);
      bar.c = candle.c;
      bar.v = bar.v === null && candle.v === null ? null : (bar.v ?? 0) + (candle.v ?? 0);
    } else {
      bars.push({ ...candle });
      key = bucket;
    }
  }
  return bars;
}

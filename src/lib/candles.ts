import type { Candle } from '@/lib/data/types';

export type CandleResolution = 'day' | 'week';

/**
 * Bar size per chart range, matching Nestor's density ladder: daily bars up to one year,
 * weekly bars beyond it, so every range lands at roughly 20–520 readable candles.
 */
export function resolutionForRange(range: string): CandleResolution {
  return range === '3y' || range === '5y' || range === '10y' ? 'week' : 'day';
}

const DAY = 86_400;

/** Monday 00:00 UTC of the week containing `t` (unix seconds). */
function weekStart(t: number) {
  const day = Math.floor(t / DAY);
  // 1970-01-01 was a Thursday, so shift by 3 to make Monday the week boundary.
  return (day - ((day + 3) % 7)) * DAY;
}

/** Rolls sorted daily candles into bars; each bar keeps its first session's timestamp. */
export function aggregateCandles(candles: Candle[], resolution: CandleResolution): Candle[] {
  if (resolution === 'day') return candles;
  const bars: Candle[] = [];
  let key: number | null = null;
  for (const candle of candles) {
    const bucket = weekStart(candle.t);
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

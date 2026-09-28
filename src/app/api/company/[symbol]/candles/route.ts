import { route, searchParam, symbolSchema } from '@/lib/api';
import { aggregateCandles, INTRADAY_SOURCE, resolutionForRange } from '@/lib/candles';
import { memo } from '@/lib/data/http';
import { fetchIntradayCandles } from '@/lib/data/providers/yahoo';
import { getCandles } from '@/lib/services/prices';

export const dynamic = 'force-dynamic';

const YEARS: Record<string, number> = { '6m': 0.52, ytd: 1, '1y': 1.02, '3y': 3.05, '5y': 5.05, '10y': 10 };

export const GET = route<{ symbol: string }>(async ({ request, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const range = searchParam(request, 'range') ?? '1y';
  const resolution = resolutionForRange(range);
  // Each extra page reaches one more range-length further back, for charts that load history as they zoom out.
  const pages = Math.min(Math.max(Math.floor(Number(searchParam(request, 'pages') ?? 1)) || 1, 1), 40);

  const intraday = INTRADAY_SOURCE[resolution];
  if (intraday) {
    // 1D reaches back a few extra days so weekends and holidays still show the last session.
    const days = Math.min(intraday.days * pages + (range === '1d' ? 4 : 0), intraday.maxDays);
    let candles = await memo(`candles:${symbol}:${intraday.interval}:${days}`, 60_000, () => fetchIntradayCandles(symbol, intraday.interval, days));
    if (range === '1d' && pages === 1 && candles.length) {
      // Only the latest session.
      const lastDay = new Date(candles[candles.length - 1].t * 1000 - 5 * 3_600_000).toISOString().slice(0, 10);
      candles = candles.filter((candle) => new Date(candle.t * 1000 - 5 * 3_600_000).toISOString().slice(0, 10) === lastDay);
    }
    return { symbol, range, resolution, candles: aggregateCandles(candles, resolution) };
  }

  const years = YEARS[range] ?? 1.02;
  const spanYears = range === 'ytd' ? 1 : years;
  let candles = await getCandles(symbol, Math.min(Math.max(spanYears * pages, 1.02), 40));
  const now = Date.now() / 1000;
  const rangeStart =
    range === 'ytd' ? Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000 : now - years * 365.25 * 86_400;
  const start = rangeStart - (pages - 1) * spanYears * 365.25 * 86_400;
  candles = candles.filter((candle) => candle.t >= start);
  return { symbol, range, resolution, candles: aggregateCandles(candles, resolution) };
});

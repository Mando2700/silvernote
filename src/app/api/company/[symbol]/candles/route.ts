import { route, searchParam, symbolSchema } from '@/lib/api';
import { aggregateCandles, resolutionForRange } from '@/lib/candles';
import { getCandles } from '@/lib/services/prices';

export const dynamic = 'force-dynamic';

const YEARS: Record<string, number> = { '1m': 0.1, '3m': 0.27, '6m': 0.52, ytd: 1, '1y': 1.02, '3y': 3.05, '5y': 5.05, '10y': 10 };

export const GET = route<{ symbol: string }>(async ({ request, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const range = searchParam(request, 'range') ?? '1y';
  const years = YEARS[range] ?? 1.02;
  let candles = await getCandles(symbol, Math.max(years, 1.02));
  const now = Date.now() / 1000;
  const start =
    range === 'ytd' ? Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000 : now - years * 365.25 * 86_400;
  candles = candles.filter((candle) => candle.t >= start);
  const resolution = resolutionForRange(range);
  return { symbol, range, resolution, candles: aggregateCandles(candles, resolution) };
});

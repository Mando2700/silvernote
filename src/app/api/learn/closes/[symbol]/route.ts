import { NextResponse } from 'next/server';

import { route, searchParam, symbolSchema } from '@/lib/api';
import { getCandles } from '@/lib/services/prices';

export const dynamic = 'force-dynamic';

/**
 * Daily split-adjusted closes for lesson widgets. Unlike the chart candles route, it never
 * aggregates to weekly or monthly bars, so daily-return statistics (volatility, beta, VaR) stay valid.
 */
export const GET = route<{ symbol: string }>(async ({ request, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const years = Math.min(10, Math.max(1, Number(searchParam(request, 'years') ?? 3) || 3));
  const candles = await getCandles(symbol, years + 0.02);
  const closes = candles.filter((candle) => candle.c > 0).map((candle) => ({ t: candle.t, c: candle.c }));
  return NextResponse.json({ symbol, years, closes }, { headers: { 'Cache-Control': 'private, max-age=300' } });
});

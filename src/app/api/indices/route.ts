import { route } from '@/lib/api';
import { fetchIntraday } from '@/lib/data/providers/nasdaq';
import { memo } from '@/lib/data/http';
import { getIndexQuotes } from '@/lib/services/market';
import { getCandles } from '@/lib/services/prices';

export const dynamic = 'force-dynamic';

const SPARK_POINTS = 60;

/** Evenly thin a minute series, always keeping the latest point. */
function thin(values: number[], points: number) {
  if (values.length <= points) return values;
  const step = (values.length - 1) / (points - 1);
  return Array.from({ length: points }, (_, index) => values[Math.round(index * step)]);
}

/** Today's session (minute bars) against the prior close; falls back to recent daily closes. */
async function daySpark(symbol: string) {
  const intraday = await memo(`intraday:${symbol}`, 60_000, () => fetchIntraday(symbol)).catch(() => null);
  if (intraday?.bars.length) return { spark: thin(intraday.bars.map((bar) => bar.price), SPARK_POINTS), previousClose: intraday.previousClose };
  const candles = await getCandles(symbol, 0.25).catch(() => []);
  return { spark: candles.slice(-45).map((candle) => candle.c), previousClose: null };
}

export const GET = route(async () => {
  return memo('indices:strip', 30_000, async () => {
    const quotes = await getIndexQuotes();
    const sparks = await Promise.all(quotes.map((item) => daySpark(item.symbol)));
    return quotes.map((item, index) => ({
      symbol: item.symbol,
      name: item.name,
      price: item.quote?.price ?? null,
      change: item.quote?.change ?? null,
      changePct: item.quote?.changePct ?? null,
      spark: sparks[index].spark,
      previousClose: sparks[index].previousClose,
    }));
  });
});

import { route } from '@/lib/api';
import { memo, within } from '@/lib/data/http';
import { getIndexQuotes, getIntraday, INDEX_PROXIES } from '@/lib/services/market';
import { getCandles } from '@/lib/services/prices';

export const dynamic = 'force-dynamic';

const SPARK_POINTS = 60;

/** Evenly thin a minute series, always keeping the latest point. */
function thin(values: number[], points: number) {
  if (values.length <= points) return values;
  const step = (values.length - 1) / (points - 1);
  return Array.from({ length: points }, (_, index) => values[Math.round(index * step)]);
}

/** The sparkline is decoration: never hold the strip's prices back for long waiting on one. */
const SPARK_BUDGET_MS = 2_500;

/** Today's session (minute bars) against the prior close; falls back to recent daily closes. */
async function daySpark(symbol: string) {
  const intraday = await getIntraday(symbol).catch(() => null);
  if (intraday?.bars.length) return { spark: thin(intraday.bars.map((bar) => bar.price), SPARK_POINTS), previousClose: intraday.previousClose };
  const candles = await getCandles(symbol, 0.25).catch(() => []);
  return { spark: candles.slice(-45).map((candle) => candle.c), previousClose: null };
}

export const GET = route(async () => {
  return memo('indices:strip', 30_000, async () => {
    // Sparklines only need the symbols: load them alongside the quotes.
    const [quotes, sparks] = await Promise.all([
      getIndexQuotes(),
      Promise.all(
        INDEX_PROXIES.map(async (item) => (await within(daySpark(item.symbol), SPARK_BUDGET_MS)) ?? { spark: [], previousClose: null }),
      ),
    ]);
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

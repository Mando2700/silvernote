import { route } from '@/lib/api';
import { getIndexQuotes, getIntraday, INDEX_PROXIES } from '@/lib/services/market';
import { cached, memo, within } from '@/lib/data/http';
import { fetchYahooDay } from '@/lib/data/providers/yahoo';
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
    // The real index levels first; the tracking fund (SPY for the S&P 500, …) stands in when they can't be read.
    const levels = await Promise.all(
      INDEX_PROXIES.map((item) => within(cached(`yahoo-day:${item.index}`, 60, () => fetchYahooDay(item.index)).catch(() => null), SPARK_BUDGET_MS)),
    );
    const missing = INDEX_PROXIES.filter((_, index) => !levels[index]);
    const [quotes, sparks] = missing.length
      ? await Promise.all([
          getIndexQuotes(),
          Promise.all(INDEX_PROXIES.map(async (item, index) => (levels[index] ? null : ((await within(daySpark(item.symbol), SPARK_BUDGET_MS)) ?? { spark: [], previousClose: null })))),
        ])
      : [null, null];
    return INDEX_PROXIES.map((item, index) => {
      const level = levels[index];
      if (level) {
        return {
          symbol: item.symbol,
          name: item.name,
          kind: 'index' as const,
          price: level.price,
          change: level.change,
          changePct: level.changePct,
          spark: thin(level.spark, SPARK_POINTS),
          previousClose: level.previousClose,
        };
      }
      const quote = quotes?.[index]?.quote;
      return {
        symbol: item.symbol,
        name: `${item.name} (${item.symbol})`,
        kind: 'fund' as const,
        price: quote?.price ?? null,
        change: quote?.change ?? null,
        changePct: quote?.changePct ?? null,
        spark: sparks?.[index]?.spark ?? [],
        previousClose: sparks?.[index]?.previousClose ?? null,
      };
    });
  });
});

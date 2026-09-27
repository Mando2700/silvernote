import { route } from '@/lib/api';
import { memo } from '@/lib/data/http';
import { getIndexQuotes } from '@/lib/services/market';
import { getCandles } from '@/lib/services/prices';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  return memo('indices:strip', 30_000, async () => {
    const quotes = await getIndexQuotes();
    const sparks = await Promise.all(quotes.map((item) => getCandles(item.symbol, 0.25).catch(() => [])));
    return quotes.map((item, index) => ({
      symbol: item.symbol,
      name: item.name,
      price: item.quote?.price ?? null,
      change: item.quote?.change ?? null,
      changePct: item.quote?.changePct ?? null,
      spark: sparks[index].slice(-45).map((candle) => candle.c),
    }));
  });
});

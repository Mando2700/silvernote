import { route, symbolSchema } from '@/lib/api';
import { getInsiderTrades, summarizeInsiders } from '@/lib/services/sec-insights';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const trades = await getInsiderTrades(symbol);
  return { trades: trades.slice(0, 150), summary: summarizeInsiders(trades), source: 'SEC EDGAR Form 4' };
});

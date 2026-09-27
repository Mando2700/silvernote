import { route, symbolSchema } from '@/lib/api';
import { getAnalystSignals, getCompanyNews, getFilings } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const [news, filings, analyst] = await Promise.all([
    getCompanyNews(symbol).catch(() => []),
    getFilings(symbol).catch(() => []),
    getAnalystSignals(symbol).catch(() => null),
  ]);
  return { news, filings, analyst };
});

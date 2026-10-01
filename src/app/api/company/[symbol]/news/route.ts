import { route, searchParam, symbolSchema } from '@/lib/api';
import { getAnalystSignals, getCompanyNews, getFilings } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ request, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  if (searchParam(request, 'headlines') === '1') return { news: await getCompanyNews(symbol, { headlines: true }).catch(() => []) };
  const [news, filings, analyst] = await Promise.all([
    getCompanyNews(symbol).catch(() => []),
    getFilings(symbol).catch(() => []),
    getAnalystSignals(symbol).catch(() => null),
  ]);
  return { news, filings: filings.slice(0, 120), analyst };
});

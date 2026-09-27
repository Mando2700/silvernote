import { route, searchParam } from '@/lib/api';
import { getMarketHeadlines, getMyFilings, getMyNews } from '@/lib/services/news';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ request, user }) => {
  const scope = searchParam(request, 'scope') ?? 'mine';
  if (scope === 'market') return { scope, items: await getMarketHeadlines() };
  if (scope === 'filings') return { scope, ...(await getMyFilings(user.id)) };
  return { scope: 'mine', ...(await getMyNews(user.id)) };
});

import { route } from '@/lib/api';
import { getPortfolio, getTransactions, performanceHistory, withNasdaq } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const points = await performanceHistory(await getTransactions(portfolio.id), portfolio.benchmark);
  return { benchmark: portfolio.benchmark, points: await withNasdaq(points) };
});

import { route } from '@/lib/api';
import { getHoldings, getPortfolio, getTransactions, performanceHistory, withNasdaq } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const [history, { summary }] = await Promise.all([performanceHistory(await getTransactions(portfolio.id), portfolio.benchmark), getHoldings(portfolio)]);
  // Cash and bonds are part of the headline total, so they are part of the value line too (held at today's level).
  const other = summary.cash + summary.fixedIncome;
  const points = history.map((point) => (point.value > 0 ? { ...point, value: point.value + other } : point));
  return { benchmark: portfolio.benchmark, points: await withNasdaq(points) };
});

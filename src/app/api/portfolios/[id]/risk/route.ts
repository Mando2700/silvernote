import { route, searchParam } from '@/lib/api';
import { q1 } from '@/lib/db';
import { buildRiskModel, getHoldings, getPortfolio, riskFreeFor, riskStatistics } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const { holdings } = await getHoldings(portfolio);
  const days = Math.min(252 * 5, Math.max(126, Number(searchParam(request, 'days') ?? 504)));
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  const riskFree = await riskFreeFor(settings?.data?.riskFreeRate);
  const model = await buildRiskModel(holdings, portfolio.benchmark, days);
  return { stats: riskStatistics(model, riskFree), excluded: model.excluded, benchmark: portfolio.benchmark };
});

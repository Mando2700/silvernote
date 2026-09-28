import { route } from '@/lib/api';
import { q1 } from '@/lib/db';
import { getHoldings, getPortfolio, riskFreeFor } from '@/lib/services/portfolio';
import { monteCarloModel } from '@/lib/services/simulations';

export const dynamic = 'force-dynamic';

/** Inputs for the in-browser Monte Carlo: aligned daily returns of the current holdings. */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const { holdings, summary } = await getHoldings(portfolio);
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  const riskFree = await riskFreeFor(settings?.data?.riskFreeRate);
  const model = await monteCarloModel(holdings, portfolio.benchmark, summary.totalValue, riskFree);
  return {
    ...model,
    returns: model.returns.map((row) => row.map((value) => Math.round(value * 1e6) / 1e6)),
    totalValue: summary.totalValue,
    invested: summary.invested,
    cash: summary.cash,
  };
});

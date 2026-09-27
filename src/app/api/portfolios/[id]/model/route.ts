import { route } from '@/lib/api';
import { q1 } from '@/lib/db';
import { buildRiskModel, getHoldings, getPortfolio, riskFreeFor } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

/** Inputs for the in-browser Monte Carlo: aligned daily returns of the current holdings. */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const { holdings, summary } = await getHoldings(portfolio);
  const model = await buildRiskModel(holdings, portfolio.benchmark, 252 * 5);
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  return {
    symbols: model.symbols,
    weights: model.weights,
    returns: model.returns.map((row) => row.map((value) => Math.round(value * 1e6) / 1e6)),
    benchmark: model.benchmark,
    days: model.dates.length,
    from: model.dates[0] ?? null,
    totalValue: summary.totalValue,
    invested: summary.invested,
    cash: summary.cash,
    excluded: model.excluded,
    riskFree: await riskFreeFor(settings?.data?.riskFreeRate),
  };
});

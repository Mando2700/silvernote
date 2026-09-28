import { route } from '@/lib/api';
import { q1 } from '@/lib/db';
import { annualizedReturn, beta } from '@/lib/finance/stats';
import { buildRiskModel, getHoldings, getPortfolio, portfolioReturns, riskFreeFor } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

/** Long-run equity risk premium over cash used for the market-implied (CAPM) expected return. */
const EQUITY_PREMIUM = 0.05;
/** Share of the blended expected return that comes from this portfolio's own history. */
const HISTORY_WEIGHT = 0.25;

/** Inputs for the in-browser Monte Carlo: aligned daily returns of the current holdings. */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const { holdings, summary } = await getHoldings(portfolio);
  const model = await buildRiskModel(holdings, portfolio.benchmark, 252 * 10);
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  const riskFree = await riskFreeFor(settings?.data?.riskFreeRate);
  const returns = portfolioReturns(model);
  const rawBeta = model.benchmark ? beta(returns, model.benchmark.returns) : null;
  const portfolioBeta = rawBeta !== null && Number.isFinite(rawBeta) ? rawBeta : 1;
  // Cash and bonds are held flat in the simulation, so only the invested share earns a return.
  const investedShare = summary.totalValue > 0 ? summary.invested / summary.totalValue : 1;
  const impliedReturn = investedShare * (riskFree + portfolioBeta * EQUITY_PREMIUM);
  const historicalReturn = investedShare * annualizedReturn(returns);
  return {
    symbols: model.symbols,
    weights: model.weights,
    returns: model.returns.map((row) => row.map((value) => Math.round(value * 1e6) / 1e6)),
    benchmark: model.benchmark?.symbol ?? null,
    days: model.dates.length,
    from: model.dates[0] ?? null,
    totalValue: summary.totalValue,
    invested: summary.invested,
    cash: summary.cash,
    excluded: model.excluded,
    backfilled: model.backfilled,
    riskFree,
    beta: portfolioBeta,
    impliedReturn,
    historicalReturn,
    blendedReturn: (1 - HISTORY_WEIGHT) * impliedReturn + HISTORY_WEIGHT * historicalReturn,
  };
});

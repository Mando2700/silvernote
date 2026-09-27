import { route } from '@/lib/api';
import { getHoldings, getPortfolio } from '@/lib/services/portfolio';
import { runStressTests } from '@/lib/services/simulations';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const { holdings, summary } = await getHoldings(portfolio);
  const scenarios = await runStressTests(holdings.map((holding) => ({ symbol: holding.symbol, value: holding.marketValue })));
  // Cash is assumed to hold its value through each scenario.
  const invested = summary.invested;
  const total = summary.totalValue;
  return {
    totalValue: total,
    scenarios: scenarios.map((scenario) => ({
      ...scenario,
      portfolioReturn: total ? (scenario.portfolioReturn * invested) / total : scenario.portfolioReturn,
      dollarImpact: scenario.portfolioReturn * invested,
    })),
  };
});

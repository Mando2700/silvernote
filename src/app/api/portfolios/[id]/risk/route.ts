import { route, searchParam } from '@/lib/api';
import { q1 } from '@/lib/db';
import { buildRiskModel, getHoldings, getPortfolio, getTransactions, performanceHistory, riskFreeFor, riskStatistics } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const { holdings } = await getHoldings(portfolio);
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  const riskFree = await riskFreeFor(settings?.data?.riskFreeRate);
  const base = { excluded: [] as string[], backfilled: [] as string[], benchmark: portfolio.benchmark };

  if (searchParam(request, 'days') === 'actual') {
    // The account's own time-weighted daily returns (trades and cash included), not today's weights replayed.
    const [points, model] = await Promise.all([performanceHistory(await getTransactions(portfolio.id), portfolio.benchmark), buildRiskModel(holdings, portfolio.benchmark, 504)]);
    const daily = points.slice(1);
    const actual = riskStatistics(
      {
        symbols: ['Portfolio'],
        weights: [1],
        dates: daily.map((point) => point.t),
        returns: [daily.map((point, index) => point.twr / points[index].twr - 1)],
        benchmark: { symbol: portfolio.benchmark, returns: daily.map((point, index) => point.benchmark / points[index].benchmark - 1) },
        excluded: [],
        backfilled: [],
      },
      riskFree,
    );
    const current = riskStatistics(model, riskFree);
    const stats = actual && current ? { ...actual, contributions: current.contributions, correlation: current.correlation } : actual;
    return { ...base, mode: 'actual' as const, stats };
  }

  const requested = Number(searchParam(request, 'days') ?? 504);
  const days = Math.min(252 * 5, Math.max(126, Number.isFinite(requested) ? Math.round(requested) : 504));
  const model = await buildRiskModel(holdings, portfolio.benchmark, days);
  return { ...base, mode: 'holdings' as const, stats: riskStatistics(model, riskFree), excluded: model.excluded, backfilled: model.backfilled };
});

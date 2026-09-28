import { route } from '@/lib/api';
import { getCandles } from '@/lib/services/prices';
import { getPortfolio, getTransactions, performanceHistory } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const points = await performanceHistory(await getTransactions(portfolio.id), portfolio.benchmark);
  if (!points.length) return { benchmark: portfolio.benchmark, points };
  // Nasdaq-100 (QQQ) as a second yardstick, indexed to 100 on the first day like the benchmark.
  const years = Math.min(10, (Date.now() / 1000 - points[0].t) / (365.25 * 86_400) + 0.1);
  const qqq = new Map((await getCandles('QQQ', Math.max(0.3, years)).catch(() => [])).map((candle) => [candle.t, candle.c]));
  let last = qqq.get(points[0].t) ?? null;
  const base = last;
  return {
    benchmark: portfolio.benchmark,
    points: points.map((point) => {
      last = qqq.get(point.t) ?? last;
      return { ...point, nasdaq: base && last ? (last / base) * 100 : 100 };
    }),
  };
});

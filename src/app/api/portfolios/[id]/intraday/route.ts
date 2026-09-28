import { route } from '@/lib/api';
import { fetchIntraday } from '@/lib/data/providers/nasdaq';
import { memo } from '@/lib/data/http';
import { buildPositions, getPortfolio, getTransactions } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

const COMPARE = ['SPY', 'QQQ'];

/** Latest session at minute resolution for today's holdings, indexed to the prior close (= 100). */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const held = [...buildPositions(await getTransactions(portfolio.id))].filter(([, position]) => position.shares > 1e-9);
  const symbols = [...new Set([...held.map(([symbol]) => symbol), ...COMPARE])];
  const series = new Map(
    await Promise.all(symbols.map(async (symbol) => [symbol, await memo(`intraday:${symbol}`, 60_000, () => fetchIntraday(symbol))] as const)),
  );
  const timeline = series.get('SPY')?.bars.map((bar) => bar.t) ?? [];
  if (!timeline.length || !held.length) return { points: [] };

  // Carry each symbol's last print forward so a quiet minute doesn't read as a drop.
  const lookup = (symbol: string) => {
    const data = series.get(symbol);
    const bars = data?.bars ?? [];
    let index = 0;
    let last = data?.previousClose ?? 0;
    return (t: number) => {
      while (index < bars.length && bars[index].t <= t) last = bars[index++].price;
      return last;
    };
  };
  const holdings = held.map(([symbol, position]) => ({ shares: position.shares, at: lookup(symbol), base: series.get(symbol)?.previousClose ?? 0 }));
  const baseValue = holdings.reduce((sum, holding) => sum + holding.shares * holding.base, 0);
  const spy = lookup('SPY');
  const qqq = lookup('QQQ');
  const spyBase = series.get('SPY')?.previousClose || 1;
  const qqqBase = series.get('QQQ')?.previousClose || 1;

  const points = [{ t: timeline[0] - 60, value: baseValue, invested: baseValue, twr: 100, benchmark: 100, nasdaq: 100 }];
  for (const t of timeline) {
    const value = holdings.reduce((sum, holding) => sum + holding.shares * (holding.at(t) || holding.base), 0);
    points.push({ t, value, invested: baseValue, twr: baseValue ? (value / baseValue) * 100 : 100, benchmark: (spy(t) / spyBase) * 100, nasdaq: (qqq(t) / qqqBase) * 100 });
  }
  return { points };
});

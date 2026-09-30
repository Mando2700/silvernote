import { route } from '@/lib/api';
import { within } from '@/lib/data/http';
import { getExtendedQuotes, getIntraday, getQuotes } from '@/lib/services/market';
import { getHoldings, getPortfolio } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

const COMPARE = ['SPY', 'QQQ', 'DIA'];
const INTRADAY_BUDGET_MS = 3_000;

/** Latest session at minute resolution for today's holdings, indexed to the prior close (= 100). */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const { holdings: positions, summary } = await getHoldings(portfolio);
  const held = positions.filter((holding) => holding.shares > 1e-9);
  const symbols = [...new Set([...held.map((holding) => holding.symbol), ...COMPARE])];
  const series = new Map(
    // A symbol whose bars aren't cached yet and are slow to load charts flat this time; they arrive for the next refresh.
    await Promise.all(symbols.map(async (symbol) => [symbol, await within(getIntraday(symbol).catch(() => null), INTRADAY_BUDGET_MS)] as const)),
  );
  // Prior closes come from the same quote feed as the portfolio's day change, so the chart ends where the headline number does.
  const [quotes, extendedQuotes] = await Promise.all([getQuotes(COMPARE), getExtendedQuotes(COMPARE)]);
  const indexBase = (symbol: string) => {
    const extended = extendedQuotes[symbol];
    return (extended && extended.closeChange !== null ? extended.close - extended.closeChange : quotes[symbol]?.previousClose) || series.get(symbol)?.previousClose || 1;
  };
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
  const holdings = held.map((holding) => ({
    shares: holding.shares,
    at: lookup(holding.symbol),
    close: holding.price,
    base: holding.price !== null ? holding.price - holding.dayChange / holding.shares : (series.get(holding.symbol)?.previousClose ?? 0),
  }));
  // Cash and bonds sit in the headline denominator, so they dilute the chart the same way.
  const other = summary.cash + summary.fixedIncome;
  const baseValue = holdings.reduce((sum, holding) => sum + holding.shares * holding.base, 0) + other;
  const spy = lookup('SPY');
  const qqq = lookup('QQQ');
  const dia = lookup('DIA');
  const spyBase = indexBase('SPY');
  const qqqBase = indexBase('QQQ');
  const diaBase = indexBase('DIA');

  const points = [{ t: timeline[0] - 60, value: baseValue, invested: baseValue, twr: 100, benchmark: 100, nasdaq: 100, dow: 100 }];
  for (const t of timeline) {
    const value = holdings.reduce((sum, holding) => sum + holding.shares * (holding.at(t) || holding.base), 0) + other;
    points.push({
      t,
      value,
      invested: baseValue,
      twr: baseValue ? (value / baseValue) * 100 : 100,
      benchmark: (spy(t) / spyBase) * 100,
      nasdaq: (qqq(t) / qqqBase) * 100,
      dow: (dia(t) / diaBase) * 100,
    });
  }

  // The last minute bar is not the closing print: land the final point on the official close the headline uses.
  const last = points[points.length - 1];
  const closeOf = (symbol: string, fallback: number) => extendedQuotes[symbol]?.close ?? quotes[symbol]?.price ?? fallback;
  last.value = holdings.reduce((sum, holding) => sum + holding.shares * (holding.close ?? holding.at(last.t) ?? holding.base), 0) + other;
  last.twr = baseValue ? (last.value / baseValue) * 100 : 100;
  last.benchmark = (closeOf('SPY', spy(last.t)) / spyBase) * 100;
  last.nasdaq = (closeOf('QQQ', qqq(last.t)) / qqqBase) * 100;
  last.dow = (closeOf('DIA', dia(last.t)) / diaBase) * 100;
  return { points };
});

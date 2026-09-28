import { route } from '@/lib/api';
import { q } from '@/lib/db';
import { memo } from '@/lib/data/http';
import { getMarketNews, getQuotes } from '@/lib/services/market';
import { getHoldings, listPortfolios } from '@/lib/services/portfolio';
import { SECTOR_UNIVERSE_SIZE, sectorPerformance } from '@/lib/finance/sectors';
import { getUniverse } from '@/lib/services/screener';

export const dynamic = 'force-dynamic';

async function marketSection() {
  return memo('dashboard:market', 30_000, async () => {
    const universe = await getUniverse();
    const priced = universe.filter((entry) => entry.marketCap && entry.changePct !== null);
    const advancers = priced.filter((entry) => (entry.changePct ?? 0) > 0).length;
    const decliners = priced.filter((entry) => (entry.changePct ?? 0) < 0).length;
    const sectors = sectorPerformance(universe);
    const large = priced.filter((entry) => (entry.marketCap ?? 0) >= 2e9);
    const pick = (entry: (typeof universe)[number]) => ({
      symbol: entry.symbol,
      name: entry.name,
      sector: entry.sector,
      price: entry.price,
      changePct: entry.changePct,
      marketCap: entry.marketCap,
      score: entry.score,
    });
    const byChange = [...large].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
    const leaders = universe
      .filter((entry) => (entry.marketCap ?? 0) >= 10e9 && entry.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 8)
      .map((entry) => ({ ...pick(entry), scoreLabel: entry.scoreLabel }));
    return {
      heatmap: universe.slice(0, SECTOR_UNIVERSE_SIZE).map((entry) => ({ ...pick(entry), industry: entry.industry })),
      breadth: { advancers, decliners, unchanged: priced.length - advancers - decliners, total: priced.length },
      sectors,
      movers: { gainers: byChange.slice(0, 6).map(pick), losers: byChange.slice(-6).reverse().map(pick) },
      leaders,
    };
  });
}

export const GET = route(async ({ user }) => {
  const [market, portfolios, watchlist, notes, news] = await Promise.all([
    marketSection(),
    listPortfolios(user.id),
    q<{ id: string; name: string }>('select id, name from public.watchlists where user_id = $1 order by position, created_at limit 1', [user.id]),
    q<{ id: string; title: string; symbol: string | null; kind: string; at: Date }>(
      `(select id::text, title, symbol, 'note' as kind, updated_at as at from public.notes where user_id = $1 order by updated_at desc limit 6)
       union all
       (select id::text, section as title, symbol, 'thesis' as kind, created_at as at from public.thesis_versions where user_id = $1 order by created_at desc limit 6)
       order by at desc limit 6`,
      [user.id],
    ),
    getMarketNews().catch(() => []),
  ]);

  let portfolio = null;
  if (portfolios[0]) {
    const { summary } = await getHoldings(portfolios[0]);
    portfolio = { id: portfolios[0].id, name: portfolios[0].name, count: portfolios.length, ...summary };
  }

  let watch = null;
  if (watchlist[0]) {
    const items = await q<{ symbol: string }>('select symbol from public.watchlist_items where watchlist_id = $1 order by position, added_at limit 8', [watchlist[0].id]);
    const quotes = await getQuotes(items.map((item) => item.symbol));
    const scores = items.length ? await q<{ symbol: string; overall: number }>('select symbol, overall from public.scores where symbol = any($1::text[])', [items.map((item) => item.symbol)]) : [];
    watch = {
      id: watchlist[0].id,
      name: watchlist[0].name,
      items: items.map((item) => ({
        symbol: item.symbol,
        price: quotes[item.symbol]?.price ?? null,
        changePct: quotes[item.symbol]?.changePct ?? null,
        score: scores.find((row) => row.symbol === item.symbol)?.overall ?? null,
      })),
    };
  }

  return { ...market, portfolio, watchlist: watch, notes, news: news.slice(0, 7), generatedAt: new Date().toISOString() };
});

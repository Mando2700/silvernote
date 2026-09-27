import 'server-only';

import { q } from '@/lib/db';
import type { Filing, NewsItem } from '@/lib/data/types';
import { getFilings, getMarketNews, getNewsForSymbols } from '@/lib/services/market';

export type UserSymbol = { symbol: string; name: string | null; held: boolean; watched: boolean };
export type FilingItem = Filing & { symbol: string; name: string | null };

/** Everything the investor follows: open positions first, then watchlist names. */
export async function getUserSymbols(userId: string, limit = 40): Promise<UserSymbol[]> {
  const rows = await q<{ symbol: string; name: string | null; held: boolean; watched: boolean }>(
    `with held as (
       select t.symbol from public.transactions t
       where t.user_id = $1
       group by t.symbol
       having sum(case when t.side = 'buy' then t.quantity else -t.quantity end) > 0.000001
     ),
     watched as (
       select distinct i.symbol from public.watchlist_items i where i.user_id = $1
     ),
     combined as (
       select symbol, true as held, false as watched from held
       union all
       select symbol, false as held, true as watched from watched
     )
     select c.symbol, s.name, bool_or(c.held) as held, bool_or(c.watched) as watched
     from combined c left join public.securities s on s.symbol = c.symbol
     group by c.symbol, s.name, s.market_cap
     order by bool_or(c.held) desc, s.market_cap desc nulls last
     limit $2`,
    [userId, limit],
  );
  return rows;
}

export async function getMyNews(userId: string): Promise<{ items: NewsItem[]; symbols: UserSymbol[] }> {
  const symbols = await getUserSymbols(userId, 30);
  if (!symbols.length) return { items: [], symbols };
  const items = await getNewsForSymbols(symbols.map((entry) => entry.symbol), 12);
  // Keep only headlines tagged with one of the investor's names when the source provides tags.
  const followed = new Set(symbols.map((entry) => entry.symbol));
  const relevant = items.filter((item) => !item.symbols.length || item.symbols.some((symbol) => followed.has(symbol)));
  return { items: relevant.slice(0, 250), symbols };
}

const KEY_FORMS = /^(10-K|10-Q|8-K|20-F|6-K|40-F|S-1|DEF 14A)/;

export async function getMyFilings(userId: string, days = 45): Promise<{ filings: FilingItem[]; symbols: UserSymbol[] }> {
  const symbols = await getUserSymbols(userId, 30);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const lists = await Promise.all(
    symbols.map(async (entry) =>
      (await getFilings(entry.symbol).catch(() => []))
        .filter((filing) => filing.filedAt >= since && KEY_FORMS.test(filing.form))
        .map((filing) => ({ ...filing, symbol: entry.symbol, name: entry.name })),
    ),
  );
  return { filings: lists.flat().sort((a, b) => b.filedAt.localeCompare(a.filedAt)).slice(0, 200), symbols };
}

export async function getMarketHeadlines() {
  return getMarketNews();
}

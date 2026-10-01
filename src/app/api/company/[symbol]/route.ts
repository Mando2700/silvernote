import { notFound, route, searchParam, symbolSchema } from '@/lib/api';
import { runUrgent, within } from '@/lib/data/http';
import { q, q1 } from '@/lib/db';
import { getCompanyProfile, getLiveQuote } from '@/lib/services/market';
import { getSecurity } from '@/lib/services/universe';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ request, user, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  // ?lean=1 is the company page's first paint: it leaves the profile out (loaded separately from /profile) and
  // waits only briefly for the live quote (unless the symbol has no security row). Provider calls can take seconds on a cold symbol, and the page has a
  // price from the security row and the live stream; the quote lands in the cache for the next 30s refresh.
  const lean = searchParam(request, 'lean') === '1';
  const security = await getSecurity(symbol);
  const [profile, quote, score, watchlists, workspace, fundamentals] = await Promise.all([
    lean ? Promise.resolve(null) : getCompanyProfile(symbol).catch(() => null),
    (lean && security ? within(runUrgent(() => getLiveQuote(symbol)), 600) : runUrgent(() => getLiveQuote(symbol))).then((quote) => quote ?? null).catch(() => null),
    q1('select overall, label, confidence, sub_scores, payload, input_level, calculated_at from public.scores where symbol = $1', [symbol]),
    q<{ id: string; name: string; member: boolean }>(
      `select w.id, w.name, exists(select 1 from public.watchlist_items i where i.watchlist_id = w.id and i.symbol = $2) as member
       from public.watchlists w where w.user_id = $1 order by w.position, w.created_at`,
      [user.id, symbol],
    ),
    q1('select stance, conviction, target_price, horizon, status, updated_at from public.workspaces where user_id = $1 and symbol = $2', [user.id, symbol]),
    q1('select * from public.fundamentals where symbol = $1', [symbol]),
  ]);
  if (!security && !quote) notFound(`No security found for ${symbol}.`);
  return { symbol, security, profile, quote, score, watchlists, workspace, fundamentals };
});

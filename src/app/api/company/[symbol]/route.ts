import { notFound, route, symbolSchema } from '@/lib/api';
import { q, q1 } from '@/lib/db';
import { getCompanyProfile, getLiveQuote } from '@/lib/services/market';
import { getSecurity } from '@/lib/services/universe';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ user, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const security = await getSecurity(symbol);
  const [profile, quote, score, watchlists, workspace, fundamentals] = await Promise.all([
    getCompanyProfile(symbol).catch(() => null),
    getLiveQuote(symbol).catch(() => null),
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

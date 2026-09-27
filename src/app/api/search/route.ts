import { route, searchParam } from '@/lib/api';
import { q } from '@/lib/db';
import { searchSecurities } from '@/lib/services/universe';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ request, user }) => {
  const term = (searchParam(request, 'q') ?? '').trim().slice(0, 60);
  if (!term) return { securities: [], watchlists: [], notes: [], pitches: [] };
  const like = `%${term}%`;
  const [securities, watchlists, notes, pitches] = await Promise.all([
    searchSecurities(term, 10),
    q<{ id: string; name: string }>('select id, name from public.watchlists where user_id = $1 and name ilike $2 order by position limit 5', [user.id, like]),
    q<{ id: string; title: string; symbol: string | null; updated_at: Date }>(
      `select id, title, symbol, updated_at from public.notes where user_id = $1 and (title ilike $2 or content ilike $2 or symbol ilike $2)
       order by updated_at desc limit 6`,
      [user.id, like],
    ),
    q<{ id: string; title: string; symbol: string }>('select id, title, symbol from public.pitches where user_id = $1 and (title ilike $2 or symbol ilike $2) order by updated_at desc limit 4', [user.id, like]),
  ]);
  return { securities, watchlists, notes, pitches };
});

import { route } from '@/lib/api';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Every company the user has a workspace for, with its latest activity. */
export const GET = route(async ({ user }) => {
  return q(
    `select w.symbol, w.stance, w.conviction, w.target_price, w.status, w.updated_at, s.name, s.price, s.change_pct, sc.overall as score,
       (select count(*)::int from public.thesis_versions v where v.user_id = w.user_id and v.symbol = w.symbol) as versions,
       (select max(created_at) from public.thesis_versions v where v.user_id = w.user_id and v.symbol = w.symbol) as last_commit
     from public.workspaces w
     left join public.securities s on s.symbol = w.symbol
     left join public.scores sc on sc.symbol = w.symbol
     where w.user_id = $1 order by w.updated_at desc`,
    [user.id],
  );
});

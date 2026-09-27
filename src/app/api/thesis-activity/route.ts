import { route } from '@/lib/api';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** The latest thesis commits across all companies (for the research timeline). */
export const GET = route(async ({ user }) =>
  q(
    `select v.id, v.symbol, v.section, v.change_note, v.stance, v.conviction, v.target_price, v.price_at, v.created_at, s.name
     from public.thesis_versions v left join public.securities s on s.symbol = v.symbol
     where v.user_id = $1 order by v.created_at desc limit 60`,
    [user.id],
  ),
);

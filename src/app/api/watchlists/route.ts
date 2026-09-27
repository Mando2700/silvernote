import { z } from 'zod';

import { body, route } from '@/lib/api';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const lists = await q<{ id: string; name: string; description: string | null; color: string | null; columns: string[]; position: number; created_at: Date; count: number }>(
    `select w.*, (select count(*)::int from public.watchlist_items i where i.watchlist_id = w.id) as count
     from public.watchlists w where w.user_id = $1 order by w.position, w.created_at`,
    [user.id],
  );
  return lists;
});

export const POST = route(async ({ request, user }) => {
  const input = await body(request, z.object({ name: z.string().trim().min(1).max(60), description: z.string().max(280).optional(), color: z.string().max(20).optional() }));
  const [row] = await q(
    `insert into public.watchlists (user_id, name, description, color, columns, position)
     values ($1, $2, $3, $4, $5::jsonb, coalesce((select max(position) + 1 from public.watchlists where user_id = $1), 0)) returning *`,
    [user.id, input.name, input.description ?? null, input.color ?? null, JSON.stringify(['price', 'changePct', 'sinceAdded', 'marketCap', 'pe', 'revenueGrowth', 'score'])],
  );
  return row;
});

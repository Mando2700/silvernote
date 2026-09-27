import { z } from 'zod';

import { body, notFound, route, searchParam, symbolSchema } from '@/lib/api';
import { q, q1 } from '@/lib/db';
import { getQuotes } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

async function ownList(userId: string, id: string) {
  const list = await q1('select id from public.watchlists where id = $1 and user_id = $2', [id, userId]);
  if (!list) notFound('Watchlist not found.');
}

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  await ownList(user.id, params.id);
  const input = await body(request, z.object({ symbol: symbolSchema, tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(), note: z.string().max(500).optional() }));
  const quote = (await getQuotes([input.symbol]))[input.symbol];
  const [row] = await q(
    `insert into public.watchlist_items (watchlist_id, user_id, symbol, tags, note, added_price, position)
     values ($1, $2, $3, $4::text[], $5, $6, coalesce((select max(position) + 1 from public.watchlist_items where watchlist_id = $1), 0))
     on conflict (watchlist_id, symbol) do update set tags = excluded.tags, note = coalesce(excluded.note, watchlist_items.note)
     returning *`,
    [params.id, user.id, input.symbol, input.tags ?? [], input.note ?? null, quote?.price ?? null],
  );
  return row;
});

export const PATCH = route<{ id: string }>(async ({ request, user, params }) => {
  await ownList(user.id, params.id);
  const input = await body(request, z.object({ symbol: symbolSchema, tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(), note: z.string().max(500).nullable().optional() }));
  const [row] = await q(
    `update public.watchlist_items set tags = coalesce($3::text[], tags), note = case when $4::boolean then $5 else note end
     where watchlist_id = $1 and symbol = $2 returning *`,
    [params.id, input.symbol, input.tags ?? null, input.note !== undefined, input.note ?? null],
  );
  return row ?? notFound();
});

export const DELETE = route<{ id: string }>(async ({ request, user, params }) => {
  await ownList(user.id, params.id);
  const symbol = symbolSchema.parse(searchParam(request, 'symbol') ?? '');
  await q('delete from public.watchlist_items where watchlist_id = $1 and symbol = $2', [params.id, symbol]);
  return { ok: true };
});

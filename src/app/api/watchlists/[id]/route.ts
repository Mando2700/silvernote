import { z } from 'zod';

import { body, notFound, route } from '@/lib/api';
import { q, q1 } from '@/lib/db';
import { getListings } from '@/lib/services/screener';

export const dynamic = 'force-dynamic';

type Item = { symbol: string; tags: string[]; note: string | null; added_price: number | null; added_at: Date; position: number };

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const list = await q1<{ id: string; name: string; description: string | null; columns: string[] }>(
    'select id, name, description, columns from public.watchlists where id = $1 and user_id = $2',
    [params.id, user.id],
  );
  if (!list) notFound('Watchlist not found.');
  const items = await q<Item>('select symbol, tags, note, added_price, added_at, position from public.watchlist_items where watchlist_id = $1 order by position, added_at', [params.id]);
  const universe = await getListings();
  const bySymbol = new Map(universe.map((entry) => [entry.symbol, entry]));
  const alerts = await q<{ symbol: string; count: number }>(
    `select symbol, count(*)::int as count from public.alerts where user_id = $1 and active and symbol = any($2::text[]) group by symbol`,
    [user.id, items.map((item) => item.symbol)],
  );
  const alertCount = new Map(alerts.map((row) => [row.symbol, row.count]));
  return {
    ...list,
    items: items.map((item) => {
      const entry = bySymbol.get(item.symbol);
      return {
        ...item,
        name: entry?.name ?? item.symbol,
        sector: entry?.sector ?? null,
        metrics: entry ?? null,
        sinceAdded: entry?.price && item.added_price ? entry.price / item.added_price - 1 : null,
        alerts: alertCount.get(item.symbol) ?? 0,
      };
    }),
  };
});

export const PATCH = route<{ id: string }>(async ({ request, user, params }) => {
  const input = await body(
    request,
    z.object({ name: z.string().trim().min(1).max(60).optional(), description: z.string().max(280).nullable().optional(), columns: z.array(z.string().max(40)).max(20).optional(), order: z.array(z.string()).max(500).optional() }),
  );
  const [row] = await q(
    `update public.watchlists set name = coalesce($3, name), description = case when $4::boolean then $5 else description end,
       columns = coalesce($6::jsonb, columns), updated_at = now()
     where id = $1 and user_id = $2 returning *`,
    [params.id, user.id, input.name ?? null, input.description !== undefined, input.description ?? null, input.columns ? JSON.stringify(input.columns) : null],
  );
  if (!row) notFound('Watchlist not found.');
  if (input.order) {
    for (const [index, symbol] of input.order.entries()) {
      await q('update public.watchlist_items set position = $3 where watchlist_id = $1 and symbol = $2', [params.id, symbol, index]);
    }
  }
  return row;
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await q('delete from public.watchlists where id = $1 and user_id = $2', [params.id, user.id]);
  return { ok: true };
});

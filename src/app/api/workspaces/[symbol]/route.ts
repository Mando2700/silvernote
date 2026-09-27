import { z } from 'zod';

import { body, route, symbolSchema } from '@/lib/api';
import { q, q1 } from '@/lib/db';
import { THESIS_SECTIONS as SECTIONS } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ user, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const [meta, versions, notes] = await Promise.all([
    q1('select stance, conviction, target_price, horizon, status, created_at, updated_at from public.workspaces where user_id = $1 and symbol = $2', [user.id, symbol]),
    q<{ id: string; section: string; content: string; change_note: string | null; stance: string | null; conviction: number | null; target_price: number | null; price_at: number | null; created_at: Date }>(
      `select id, section, content, change_note, stance, conviction, target_price, price_at, created_at
       from public.thesis_versions where user_id = $1 and symbol = $2 order by created_at desc limit 400`,
      [user.id, symbol],
    ),
    q('select id, title, content, tags, pinned, created_at, updated_at from public.notes where user_id = $1 and symbol = $2 order by pinned desc, updated_at desc limit 50', [user.id, symbol]),
  ]);
  const current: Record<string, (typeof versions)[number] | null> = {};
  for (const section of SECTIONS) current[section] = versions.find((version) => version.section === section) ?? null;
  return { symbol, meta, current, versions, notes };
});

export const PUT = route<{ symbol: string }>(async ({ request, user, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const input = await body(
    request,
    z.object({
      stance: z.enum(['long', 'short', 'watch', 'avoid']).optional(),
      conviction: z.number().int().min(1).max(5).optional(),
      target_price: z.number().positive().max(1e7).nullable().optional(),
      horizon: z.string().max(40).nullable().optional(),
      status: z.string().max(40).optional(),
    }),
  );
  const [row] = await q(
    `insert into public.workspaces (user_id, symbol, stance, conviction, target_price, horizon, status)
     values ($1, $2, coalesce($3, 'watch'), coalesce($4, 3), $5, $6, coalesce($7, 'researching'))
     on conflict (user_id, symbol) do update set
       stance = coalesce($3, workspaces.stance), conviction = coalesce($4, workspaces.conviction),
       target_price = case when $8::boolean then $5 else workspaces.target_price end,
       horizon = case when $9::boolean then $6 else workspaces.horizon end,
       status = coalesce($7, workspaces.status), updated_at = now()
     returning *`,
    [
      user.id,
      symbol,
      input.stance ?? null,
      input.conviction ?? null,
      input.target_price ?? null,
      input.horizon ?? null,
      input.status ?? null,
      input.target_price !== undefined,
      input.horizon !== undefined,
    ],
  );
  return row;
});

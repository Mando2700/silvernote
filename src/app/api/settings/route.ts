import { z } from 'zod';

import { body, route } from '@/lib/api';
import { q, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

const schema = z.object({
  marketColors: z.enum(['red-green', 'blue-orange']).optional(),
  motion: z.enum(['system', 'full', 'reduced']).optional(),
  benchmark: z.string().max(10).optional(),
  riskFreeRate: z.number().min(0).max(0.2).nullable().optional(),
  aiModel: z.string().max(60).nullable().optional(),
});

export const GET = route(async ({ user }) => {
  const row = await q1<{ data: Record<string, unknown> }>('select data from public.user_settings where user_id = $1', [user.id]);
  return { marketColors: 'red-green', motion: 'system', benchmark: 'SPY', riskFreeRate: null, aiModel: null, ...(row?.data ?? {}) };
});

export const PUT = route(async ({ request, user }) => {
  const patch = await body(request, schema);
  const [row] = await q<{ data: Record<string, unknown> }>(
    `insert into public.user_settings (user_id, data) values ($1, $2::jsonb)
     on conflict (user_id) do update set data = public.user_settings.data || excluded.data, updated_at = now()
     returning data`,
    [user.id, JSON.stringify(patch)],
  );
  return row.data;
});

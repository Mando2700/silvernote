import { z } from 'zod';

import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { strategySchema } from '@/lib/backtest-schema';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const PUT = route<{ id: string }>(async ({ request, user, params }) => {
  z.string().uuid().parse(params.id);
  const input = await body(request, z.object({ name: z.string().trim().min(1).max(80), definition: strategySchema }));
  const [row] = await q(
    `update public.backtest_strategies set name = $3, definition = $4::jsonb, updated_at = now()
     where id = $1 and user_id = $2 returning id, name, definition, updated_at`,
    [params.id, user.id, input.name, input.definition],
  );
  if (!row) throw new HttpError(404, 'Strategy not found.');
  return row;
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  z.string().uuid().parse(params.id);
  await q('delete from public.backtest_strategies where id = $1 and user_id = $2', [params.id, user.id]);
  return { ok: true };
});

import { z } from 'zod';

import { body, route } from '@/lib/api';
import { strategySchema } from '@/lib/backtest-schema';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) =>
  q('select id, name, definition, updated_at from public.backtest_strategies where user_id = $1 order by updated_at desc', [user.id]),
);

export const POST = route(async ({ request, user }) => {
  const input = await body(request, z.object({ name: z.string().trim().min(1).max(80), definition: strategySchema }));
  const [row] = await q(
    'insert into public.backtest_strategies (user_id, name, definition) values ($1, $2, $3::jsonb) returning id, name, definition, updated_at',
    [user.id, input.name, input.definition],
  );
  return row;
});

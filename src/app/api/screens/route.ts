import { z } from 'zod';

import { body, route } from '@/lib/api';
import { q } from '@/lib/db';
import { screenDefinition } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) =>
  q('select id, name, definition, created_at, updated_at from public.saved_screens where user_id = $1 order by updated_at desc', [user.id]),
);

export const POST = route(async ({ request, user }) => {
  const input = await body(request, z.object({ name: z.string().trim().min(1).max(80), definition: screenDefinition }));
  const [row] = await q(
    'insert into public.saved_screens (user_id, name, definition) values ($1, $2, $3::jsonb) returning id, name, definition, created_at, updated_at',
    [user.id, input.name, JSON.stringify(input.definition)],
  );
  return row;
});

import { z } from 'zod';

import { body, route } from '@/lib/api';
import { q } from '@/lib/db';
import { screenDefinition } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(async ({ request, user, params }) => {
  const input = await body(request, z.object({ name: z.string().trim().min(1).max(80).optional(), definition: screenDefinition.optional() }));
  const [row] = await q(
    `update public.saved_screens set name = coalesce($3, name), definition = coalesce($4::jsonb, definition), updated_at = now()
     where id = $1 and user_id = $2 returning id, name, definition, created_at, updated_at`,
    [params.id, user.id, input.name ?? null, input.definition ? JSON.stringify(input.definition) : null],
  );
  return row ?? { error: 'not found' };
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await q('delete from public.saved_screens where id = $1 and user_id = $2', [params.id, user.id]);
  return { ok: true };
});

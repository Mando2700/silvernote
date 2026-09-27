import { z } from 'zod';

import { body, notFound, route } from '@/lib/api';
import { deleteAlert, updateAlert } from '@/lib/services/alerts';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(async ({ request, user, params }) => {
  const patch = await body(request, z.object({ active: z.boolean().optional(), threshold: z.number().finite().optional() }));
  return (await updateAlert(user.id, params.id, patch)) ?? notFound();
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await deleteAlert(user.id, params.id);
  return { ok: true };
});

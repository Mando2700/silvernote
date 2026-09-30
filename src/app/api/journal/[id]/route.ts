import { z } from 'zod';

import { body, notFound, route } from '@/lib/api';
import { decisionSchema } from '@/lib/journal-schema';
import { deleteDecision, updateDecision } from '@/lib/services/journal';

export const dynamic = 'force-dynamic';

const patchSchema = decisionSchema.omit({ symbol: true }).partial().extend({
  status: z.enum(['open', 'closed']).optional(),
  exit_price: z.number().positive().nullable().optional(),
  exit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  outcome: z.enum(['right', 'wrong', 'mixed']).nullable().optional(),
  postmortem: z.string().max(20_000).nullable().optional(),
});

export const PATCH = route<{ id: string }>(async ({ request, user, params }) => (await updateDecision(user.id, params.id, await body(request, patchSchema))) ?? notFound());

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await deleteDecision(user.id, params.id);
  return { ok: true };
});

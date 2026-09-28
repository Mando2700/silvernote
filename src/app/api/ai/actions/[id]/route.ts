import { z } from 'zod';

import { body, route } from '@/lib/api';
import { resolveAction } from '@/lib/ai/actions';

export const dynamic = 'force-dynamic';

/** Confirm (apply) or decline a change Grok proposed. */
export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  const id = z.string().uuid().parse(params.id);
  const input = await body(request, z.object({ decision: z.enum(['confirm', 'decline']) }));
  return resolveAction(user.id, id, input.decision);
});

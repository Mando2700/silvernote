import { z } from 'zod';

import { body, route, searchParam } from '@/lib/api';
import { listAttempts, pitchSchema, submitPitch } from '@/lib/services/learn';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const GET = route(async ({ request, user }) => ({ attempts: await listAttempts(user.id, 'pitch', searchParam(request, 'symbol')?.toUpperCase() ?? null) }));

/** Save a practice pitch with its structure score; with `grade`, Grok grades it first. */
export const POST = route(async ({ request, user }) => {
  const input = await body(request, z.object({ draft: pitchSchema, grade: z.boolean().default(false) }));
  return submitPitch(user.id, input.draft, { grade: input.grade });
});

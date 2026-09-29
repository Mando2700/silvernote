import { z } from 'zod';

import { body, route, searchParam } from '@/lib/api';
import { gradeAnswer, listAttempts } from '@/lib/services/learn';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route(async ({ request, user }) => ({ attempts: await listAttempts(user.id, 'answer', searchParam(request, 'question')) }));

/** Grok grades a written answer to an interview question and the attempt is saved. */
export const POST = route(async ({ request, user }) => {
  const input = await body(request, z.object({ questionId: z.string().max(60), answer: z.string().trim().min(20, 'Write a fuller answer first.').max(8000) }));
  return gradeAnswer(user.id, input.questionId, input.answer);
});

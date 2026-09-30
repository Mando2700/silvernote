import { z } from 'zod';

import { body, route, symbolSchema } from '@/lib/api';
import { runEventStudy } from '@/lib/services/lab';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route(async ({ request }) => {
  const input = await body(
    request,
    z.object({
      symbol: symbolSchema,
      source: z.enum(['earnings', '8-K', 'custom']),
      dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).optional(),
      window: z.tuple([z.number().int().min(-30).max(0), z.number().int().min(0).max(60)]).optional(),
      benchmark: symbolSchema.optional(),
      limit: z.number().int().min(1).max(40).optional(),
    }),
  );
  return runEventStudy(input);
});

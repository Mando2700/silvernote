import { z } from 'zod';

import { body, route, searchParam } from '@/lib/api';
import { cancelJob, startJob, type JobKind } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

const kinds = z.enum(['universe', 'fundamentals', 'scores']);

export const POST = route(async ({ request }) => {
  const input = await body(
    request,
    z.object({ kind: kinds, params: z.object({ minMarketCap: z.number().min(0).optional(), symbols: z.array(z.string()).max(500).optional() }).optional() }),
  );
  const id = await startJob(input.kind, input.params ?? {});
  return { id };
});

export const DELETE = route(async ({ request }) => {
  const kind = kinds.parse(searchParam(request, 'kind')) as JobKind;
  return { cancelled: cancelJob(kind) };
});

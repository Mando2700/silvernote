import { z } from 'zod';

import { body, route, searchParam, symbolSchema } from '@/lib/api';
import { earningsPreview, listBriefs, morningBrief, weeklyRedTeam, type BriefKind } from '@/lib/services/briefs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const kinds = z.enum(['morning', 'redteam', 'earnings_preview']);

export const GET = route(async ({ request, user }) => {
  const kind = searchParam(request, 'kind');
  return listBriefs(user.id, kind ? (kinds.parse(kind) as BriefKind) : undefined);
});

/** Generate a brief now (the scheduler also makes them on its own). */
export const POST = route(async ({ request, user }) => {
  const input = await body(request, z.object({ kind: kinds, symbol: symbolSchema.optional(), date: z.string().max(10).optional() }));
  if (input.kind === 'morning') return morningBrief(user.id);
  if (input.kind === 'redteam') return weeklyRedTeam(user.id, 4, input.symbol);
  if (!input.symbol) throw new Error('An earnings preview needs a symbol.');
  return earningsPreview(user.id, input.symbol, input.date);
});

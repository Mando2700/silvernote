import { z } from 'zod';

import { body, route, searchParam, symbolSchema } from '@/lib/api';
import { createAlert, listAlerts } from '@/lib/services/alerts';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ request, user }) => {
  const symbol = searchParam(request, 'symbol');
  return listAlerts(user.id, symbol ? symbolSchema.parse(symbol) : undefined);
});

export const POST = route(async ({ request, user }) => {
  const input = await body(
    request,
    z.object({
      symbol: symbolSchema,
      kind: z.enum(['price_above', 'price_below', 'change_pct', 'score_above', 'score_below', 'score_change']),
      threshold: z.number().finite(),
      note: z.string().max(280).nullable().optional(),
    }),
  );
  return createAlert(user.id, input);
});

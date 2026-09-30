import { z } from 'zod';

import { body, route, searchParam, symbolSchema } from '@/lib/api';
import { ALERT_KINDS, ALERT_METRICS, createAlert, listAlerts } from '@/lib/services/alerts';

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
      kind: z.enum(ALERT_KINDS),
      threshold: z.number().finite(),
      note: z.string().max(280).nullable().optional(),
      metric: z.enum(Object.keys(ALERT_METRICS) as [keyof typeof ALERT_METRICS, ...Array<keyof typeof ALERT_METRICS>]).nullable().optional(),
      source: z.enum(['thesis']).nullable().optional(),
    }),
  );
  return createAlert(user.id, input);
});

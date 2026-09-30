import { z } from 'zod';

import { body, route } from '@/lib/api';
import { getPortfolio } from '@/lib/services/portfolio';
import { rebalancePlan } from '@/lib/services/portfolio-tools';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const input = await body(
    request,
    z.object({
      addCash: z.number().finite().optional(),
      fractional: z.boolean().optional(),
      minTrade: z.number().min(0).optional(),
      sellUntargeted: z.boolean().optional(),
      targets: z.record(z.string().max(16), z.number().min(0).max(1)).optional(),
    }),
  );
  return rebalancePlan(portfolio, input);
});

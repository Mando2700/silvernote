import { z } from 'zod';

import { body, route, symbolSchema } from '@/lib/api';
import { q1 } from '@/lib/db';
import { getHoldings, getPortfolio, riskFreeFor } from '@/lib/services/portfolio';
import { whatIf } from '@/lib/services/simulations';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const input = await body(request, z.object({ symbol: symbolSchema, amount: z.number().positive().max(1e10) }));
  const { holdings } = await getHoldings(portfolio);
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  return whatIf(holdings, portfolio.cash, portfolio.benchmark, await riskFreeFor(settings?.data?.riskFreeRate), input);
});

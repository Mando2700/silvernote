import { z } from 'zod';

import { body, route, symbolSchema } from '@/lib/api';
import { todayInNewYork } from '@/lib/dates';
import { q1 } from '@/lib/db';
import { getHoldings, getPortfolio, getTransactions, riskFreeFor } from '@/lib/services/portfolio';
import { whatIf } from '@/lib/services/simulations';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const input = await body(
    request,
    z.object({
      symbol: symbolSchema,
      amount: z.number().positive().max(1e10),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    }),
  );
  if (input.date && input.date >= todayInNewYork()) input.date = null;
  const [{ holdings }, transactions] = await Promise.all([getHoldings(portfolio), input.date ? getTransactions(portfolio.id) : Promise.resolve([])]);
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  return whatIf(holdings, portfolio.cash, portfolio.benchmark, await riskFreeFor(settings?.data?.riskFreeRate), input, transactions);
});

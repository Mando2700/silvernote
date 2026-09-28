import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { strategySchema } from '@/lib/backtest-schema';
import { q1 } from '@/lib/db';
import { riskFreeFor } from '@/lib/services/portfolio';
import { runStrategy } from '@/lib/services/backtest';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ request, user }) => {
  const strategy = await body(request, strategySchema);
  const settings = await q1<{ data: { riskFreeRate?: number | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  let result;
  try {
    result = await runStrategy(strategy, await riskFreeFor(settings?.data?.riskFreeRate));
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  if (!result) throw new HttpError(409, 'Build the backtest history first.');
  return result;
});

import { z } from 'zod';

import { body, route } from '@/lib/api';
import { getPortfolio } from '@/lib/services/portfolio';
import { getTargets, setTargets } from '@/lib/services/portfolio-tools';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  return { targets: await getTargets(portfolio.id) };
});

export const PUT = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const input = await body(request, z.object({ targets: z.record(z.string().max(16), z.number().min(0).max(1)) }));
  const sum = Object.values(input.targets).reduce((total, weight) => total + weight, 0);
  if (sum > 1.0001) throw new Error(`Targets add up to ${(sum * 100).toFixed(1)}%; keep them at or below 100%.`);
  return { targets: await setTargets(user.id, portfolio.id, input.targets) };
});

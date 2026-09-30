import { route, searchParam } from '@/lib/api';
import { getPortfolio } from '@/lib/services/portfolio';
import { attribution } from '@/lib/services/portfolio-tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const days = Math.min(1825, Math.max(20, Number(searchParam(request, 'days') ?? 365) || 365));
  return attribution(portfolio, days);
});

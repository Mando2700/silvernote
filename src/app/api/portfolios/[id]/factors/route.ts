import { route, searchParam } from '@/lib/api';
import { getPortfolio } from '@/lib/services/portfolio';
import { factorExposure } from '@/lib/services/portfolio-tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route<{ id: string }>(async ({ request, user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const days = Math.min(1260, Math.max(126, Number(searchParam(request, 'days') ?? 504) || 504));
  return factorExposure(portfolio, days);
});

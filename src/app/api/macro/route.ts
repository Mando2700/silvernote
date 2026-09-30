import { route, searchParam } from '@/lib/api';
import { getMacroDashboard, getYieldCurves } from '@/lib/services/macro';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ request }) => {
  const years = Math.min(20, Math.max(1, Number(searchParam(request, 'years') ?? 5) || 5));
  const [dashboard, curve] = await Promise.all([getMacroDashboard(years), getYieldCurves()]);
  return { ...dashboard, curve };
});

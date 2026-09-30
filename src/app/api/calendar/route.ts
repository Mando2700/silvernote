import { z } from 'zod';

import { route, searchParam } from '@/lib/api';
import { todayInNewYork } from '@/lib/dates';
import { getCalendar } from '@/lib/services/calendar';

export const dynamic = 'force-dynamic';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const GET = route(async ({ request, user }) => {
  const from = day.parse(searchParam(request, 'from') ?? todayInNewYork());
  const to = day.parse(searchParam(request, 'to') ?? from);
  const minCap = Number(searchParam(request, 'minCap') ?? 10e9);
  return { days: await getCalendar(user.id, from, to, Number.isFinite(minCap) ? minCap : 10e9) };
});

import { z } from 'zod';

import { body, route } from '@/lib/api';
import { q } from '@/lib/db';
import { concentrationStats, getHoldings, getPortfolio, sectorExposure } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const portfolio = await getPortfolio(user.id, params.id);
  const { holdings, summary, transactions } = await getHoldings(portfolio);
  return {
    portfolio,
    holdings,
    summary,
    transactions,
    sectors: sectorExposure(holdings, portfolio.cash),
    concentration: concentrationStats(holdings),
  };
});

export const PATCH = route<{ id: string }>(async ({ request, user, params }) => {
  await getPortfolio(user.id, params.id);
  const input = await body(request, z.object({ name: z.string().trim().min(1).max(60).optional(), benchmark: z.string().trim().min(1).max(10).optional(), cash: z.number().min(0).max(1e12).optional() }));
  const [row] = await q(
    'update public.portfolios set name = coalesce($3, name), benchmark = coalesce($4, benchmark), cash = coalesce($5, cash) where id = $1 and user_id = $2 returning *',
    [params.id, user.id, input.name ?? null, input.benchmark?.toUpperCase() ?? null, input.cash ?? null],
  );
  return row;
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await q('delete from public.portfolios where id = $1 and user_id = $2', [params.id, user.id]);
  return { ok: true };
});

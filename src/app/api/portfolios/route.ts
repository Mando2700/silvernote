import { z } from 'zod';

import { body, route } from '@/lib/api';
import { q } from '@/lib/db';
import { getHoldings, listPortfolios } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const portfolios = await listPortfolios(user.id);
  return Promise.all(
    portfolios.map(async (portfolio) => {
      const { summary } = await getHoldings(portfolio);
      return { id: portfolio.id, name: portfolio.name, benchmark: portfolio.benchmark, cash: portfolio.cash, created_at: portfolio.created_at, summary };
    }),
  );
});

export const POST = route(async ({ request, user }) => {
  const input = await body(request, z.object({ name: z.string().trim().min(1).max(60), benchmark: z.string().trim().max(10).optional(), cash: z.number().min(0).max(1e12).optional() }));
  const [row] = await q('insert into public.portfolios (user_id, name, benchmark, cash) values ($1, $2, $3, $4) returning *', [
    user.id,
    input.name,
    (input.benchmark ?? 'SPY').toUpperCase(),
    input.cash ?? 0,
  ]);
  return row;
});

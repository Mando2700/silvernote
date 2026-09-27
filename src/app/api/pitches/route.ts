import { z } from 'zod';

import { body, route, symbolSchema } from '@/lib/api';
import { q } from '@/lib/db';
import { buildPitchSections } from '@/lib/pitch';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) =>
  q(
    `select p.id, p.symbol, p.title, p.recommendation, p.target_price, p.created_at, p.updated_at, s.name, s.price
     from public.pitches p left join public.securities s on s.symbol = p.symbol
     where p.user_id = $1 order by p.updated_at desc`,
    [user.id],
  ),
);

/** Create a pitch pre-filled from the company workspace, score and financials. */
export const POST = route(async ({ request, user }) => {
  const input = await body(request, z.object({ symbol: symbolSchema, title: z.string().max(160).optional() }));
  const built = await buildPitchSections(user.id, input.symbol);
  const [row] = await q(
    `insert into public.pitches (user_id, symbol, title, recommendation, target_price, sections)
     values ($1, $2, $3, $4, $5, $6::jsonb) returning *`,
    [user.id, input.symbol, input.title ?? built.title, built.recommendation, built.targetPrice, JSON.stringify(built.sections)],
  );
  return row;
});

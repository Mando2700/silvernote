import { z } from 'zod';

import { body, route, searchParam, symbolSchema } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { q } from '@/lib/db';
import { buildPositions, getPortfolio, getTransactions } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

const schema = z.object({
  symbol: symbolSchema,
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive().max(1e10),
  price: z.number().min(0).max(1e7),
  fees: z.number().min(0).max(1e7).optional(),
  traded_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
});

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  await getPortfolio(user.id, params.id);
  const input = await body(request, schema);
  if (input.traded_at > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Trade date cannot be in the future.');
  if (input.side === 'sell') {
    const position = buildPositions(await getTransactions(params.id)).get(input.symbol);
    if (!position || position.shares + 1e-9 < input.quantity) throw new HttpError(400, `You hold ${position?.shares ?? 0} ${input.symbol}; you can't sell ${input.quantity}.`);
  }
  const [row] = await q(
    `insert into public.transactions (portfolio_id, user_id, symbol, side, quantity, price, fees, traded_at, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9) returning *`,
    [params.id, user.id, input.symbol, input.side, input.quantity, input.price, input.fees ?? 0, input.traded_at, input.note ?? null],
  );
  return row;
});

export const DELETE = route<{ id: string }>(async ({ request, user, params }) => {
  await getPortfolio(user.id, params.id);
  const id = z.string().uuid().parse(searchParam(request, 'id'));
  await q('delete from public.transactions where id = $1 and portfolio_id = $2 and user_id = $3', [id, params.id, user.id]);
  return { ok: true };
});

import { z } from 'zod';

import { body, route, symbolSchema } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { q1, tx } from '@/lib/db';
import { getPortfolio } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

const schema = z.object({
  target: z.union([
    z.object({ portfolioId: z.string().uuid() }),
    z.object({ name: z.string().trim().min(1).max(60), benchmark: z.string().trim().max(10).optional() }),
  ]),
  tradedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cash: z.number().min(0).max(1e12).optional(),
  rows: z
    .array(z.object({ symbol: symbolSchema, quantity: z.number().positive().max(1e10), price: z.number().min(0).max(1e7) }))
    .max(500),
});

/** Save reviewed photo-import rows as opening buys (plus cash) in a new or existing portfolio. */
export const POST = route(async ({ request, user }) => {
  const input = await body(request, schema);
  if (input.tradedAt > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Trade date cannot be in the future.');
  if (!input.rows.length && !input.cash) throw new HttpError(400, 'Nothing to import.');
  if ('portfolioId' in input.target) await getPortfolio(user.id, input.target.portfolioId);
  const target = input.target;

  const portfolioId = await tx(async (db) => {
    let id: string;
    if ('portfolioId' in target) {
      id = target.portfolioId;
      if (input.cash) await db.query('update public.portfolios set cash = cash + $3 where id = $1 and user_id = $2', [id, user.id, input.cash]);
    } else {
      const [row] = await db.query<{ id: string }>('insert into public.portfolios (user_id, name, benchmark, cash) values ($1, $2, $3, $4) returning id', [
        user.id,
        target.name,
        (target.benchmark || 'SPY').toUpperCase(),
        input.cash ?? 0,
      ]);
      id = row.id;
    }
    for (const row of input.rows) {
      await db.query(
        `insert into public.transactions (portfolio_id, user_id, symbol, side, quantity, price, fees, traded_at, note)
         values ($1, $2, $3, 'buy', $4, $5, 0, $6::date, 'Imported from photo')`,
        [id, user.id, row.symbol, row.quantity, row.price, input.tradedAt],
      );
    }
    return id;
  });
  return q1('select id, name from public.portfolios where id = $1', [portfolioId]);
});

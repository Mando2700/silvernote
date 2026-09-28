import { z } from 'zod';

import { body, route, searchParam, symbolSchema } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { latestValidDate } from '@/lib/dates';
import { q } from '@/lib/db';
import { newOversell } from '@/lib/finance/ledger';
import { assembleLedger, getPortfolio, getStoredTransactions } from '@/lib/services/portfolio';

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

type Row = Awaited<ReturnType<typeof getStoredTransactions>>[number];

const shares = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 6 });

/** Reject a change that would make any sell exceed the shares held on its date (in today's share units). */
async function assertLedgerValid(portfolioId: string, before: Row[], after: Row[], action: string) {
  const [ledgerBefore, ledgerAfter] = await Promise.all([assembleLedger(portfolioId, before), assembleLedger(portfolioId, after)]);
  const problem = newOversell(ledgerBefore, ledgerAfter, (trade) => trade.id);
  if (!problem) return;
  const { trade, held } = problem;
  throw new HttpError(
    400,
    `${action} would leave the ${trade.symbol} sale on ${trade.traded_at} selling ${shares(trade.quantity)} shares when only ${shares(held)} were held on that date.`,
  );
}

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  await getPortfolio(user.id, params.id);
  const input = await body(request, schema);
  if (input.traded_at > latestValidDate()) throw new HttpError(400, 'Trade date cannot be in the future.');
  const stored = await getStoredTransactions(params.id);
  const candidate: Row = {
    id: 'new',
    portfolio_id: params.id,
    symbol: input.symbol,
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    fees: input.fees ?? 0,
    traded_at: input.traded_at,
    note: input.note ?? null,
    created_at: new Date(),
    broker_execution_id: null,
    kind: 'trade',
  };
  await assertLedgerValid(params.id, stored, [...stored, candidate], input.side === 'sell' ? 'This sale' : 'This trade');
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
  const stored = await getStoredTransactions(params.id);
  if (stored.some((row) => row.id === id)) {
    await assertLedgerValid(params.id, stored, stored.filter((row) => row.id !== id), 'Deleting this trade');
  }
  await q('delete from public.transactions where id = $1 and portfolio_id = $2 and user_id = $3', [id, params.id, user.id]);
  return { ok: true };
});

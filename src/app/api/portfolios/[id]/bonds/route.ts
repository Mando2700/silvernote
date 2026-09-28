import { z } from 'zod';

import { body, route, searchParam } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { latestValidDate } from '@/lib/dates';
import { q } from '@/lib/db';
import { getBondPortfolio } from '@/lib/services/bonds';
import { getPortfolio } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bond = z.object({
  name: z.string().trim().min(1).max(80),
  cusip: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{9}$/, 'CUSIP must be 9 letters or digits')
    .nullable()
    .optional(),
  kind: z.enum(['treasury', 'agency', 'corporate', 'municipal', 'cd', 'other']),
  face: z.number().positive().max(1e10),
  coupon: z.number().min(0).max(49),
  frequency: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4), z.literal(12)]),
  maturity: isoDate,
  purchase_date: isoDate,
  purchase_price: z.number().positive().max(1000),
  market_price: z.number().positive().max(1000).nullable().optional(),
  spread_bps: z.number().min(-1000).max(5000).nullable().optional(),
  day_count: z.enum(['30/360', 'act/act']).optional(),
  rating: z.string().trim().max(10).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

function validate(input: { maturity?: string; purchase_date?: string }) {
  if (input.purchase_date && input.purchase_date > latestValidDate()) throw new HttpError(400, 'Purchase date cannot be in the future.');
  if (input.maturity && input.purchase_date && input.maturity <= input.purchase_date) throw new HttpError(400, 'Maturity must be after the purchase date.');
}

export const GET = route<{ id: string }>(async ({ user, params }) => {
  await getPortfolio(user.id, params.id);
  return getBondPortfolio(params.id);
});

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  await getPortfolio(user.id, params.id);
  const input = await body(request, bond);
  validate(input);
  const [row] = await q(
    `insert into public.bond_holdings (portfolio_id, user_id, name, cusip, kind, face, coupon, frequency, maturity, purchase_date,
       purchase_price, market_price, spread_bps, day_count, rating, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11, $12, $13, $14, $15, $16) returning id`,
    [
      params.id, user.id, input.name, input.cusip ?? null, input.kind, input.face, input.coupon, input.frequency, input.maturity, input.purchase_date,
      input.purchase_price, input.market_price ?? null, input.spread_bps ?? null,
      input.day_count ?? (input.kind === 'treasury' ? 'act/act' : '30/360'), input.rating ?? null, input.note ?? null,
    ],
  );
  return row;
});

export const PATCH = route<{ id: string }>(async ({ request, user, params }) => {
  await getPortfolio(user.id, params.id);
  const bondId = z.string().uuid().parse(searchParam(request, 'bond'));
  const input = await body(request, bond);
  validate(input);
  const [row] = await q(
    `update public.bond_holdings set name = $4, cusip = $5, kind = $6, face = $7, coupon = $8, frequency = $9, maturity = $10::date,
       purchase_date = $11::date, purchase_price = $12, market_price = $13, spread_bps = $14, day_count = $15, rating = $16, note = $17
     where id = $1 and portfolio_id = $2 and user_id = $3 returning id`,
    [
      bondId, params.id, user.id, input.name, input.cusip ?? null, input.kind, input.face, input.coupon, input.frequency, input.maturity,
      input.purchase_date, input.purchase_price, input.market_price ?? null, input.spread_bps ?? null,
      input.day_count ?? (input.kind === 'treasury' ? 'act/act' : '30/360'), input.rating ?? null, input.note ?? null,
    ],
  );
  if (!row) throw new HttpError(404, 'Bond not found.');
  return row;
});

export const DELETE = route<{ id: string }>(async ({ request, user, params }) => {
  await getPortfolio(user.id, params.id);
  const bondId = z.string().uuid().parse(searchParam(request, 'bond'));
  await q('delete from public.bond_holdings where id = $1 and portfolio_id = $2 and user_id = $3', [bondId, params.id, user.id]);
  return { ok: true };
});

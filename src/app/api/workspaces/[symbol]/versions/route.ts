import { z } from 'zod';

import { body, route, symbolSchema } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { getQuotes } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

/** Commit a new version of one thesis section, stamped with the current stance and price. */
export const POST = route<{ symbol: string }>(async ({ request, user, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const input = await body(
    request,
    z.object({
      section: z.enum(['thesis', 'drivers', 'risks', 'catalysts', 'disconfirming', 'valuation']),
      content: z.string().max(1_000_000),
      change_note: z.string().max(280).optional(),
    }),
  );
  const latest = await q1<{ content: string }>(
    'select content from public.thesis_versions where user_id = $1 and symbol = $2 and section = $3 order by created_at desc limit 1',
    [user.id, symbol, input.section],
  );
  if (latest && latest.content.trim() === input.content.trim()) throw new HttpError(409, 'Nothing changed since the last version.');
  await q(
    `insert into public.workspaces (user_id, symbol) values ($1, $2) on conflict (user_id, symbol) do update set updated_at = now()`,
    [user.id, symbol],
  );
  const meta = await q1<{ stance: string; conviction: number; target_price: number | null }>(
    'select stance, conviction, target_price from public.workspaces where user_id = $1 and symbol = $2',
    [user.id, symbol],
  );
  const price = (await getQuotes([symbol]))[symbol]?.price ?? null;
  const [row] = await q(
    `insert into public.thesis_versions (user_id, symbol, section, content, change_note, stance, conviction, target_price, price_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [user.id, symbol, input.section, input.content, input.change_note ?? null, meta?.stance ?? null, meta?.conviction ?? null, meta?.target_price ?? null, price],
  );
  return row;
});

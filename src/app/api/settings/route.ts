import { z } from 'zod';

import { body, route } from '@/lib/api';
import { q, q1 } from '@/lib/db';
import { TAX_CODES } from '@/lib/finance/tax-rules';

export const dynamic = 'force-dynamic';

const schema = z.object({
  marketColors: z.enum(['red-green', 'blue-orange']).optional(),
  motion: z.enum(['system', 'full', 'reduced']).optional(),
  benchmark: z.string().max(10).optional(),
  riskFreeRate: z.number().min(0).max(0.2).nullable().optional(),
  aiModel: z.string().max(60).nullable().optional(),
  /** Null falls back to the tax country's default rate. */
  taxShortRate: z.number().min(0).max(0.7).nullable().optional(),
  taxLongRate: z.number().min(0).max(0.7).nullable().optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  taxJurisdiction: z.enum(TAX_CODES).optional(),
  /** Yahoo symbols on the dashboard's macro tape. */
  macroTape: z.array(z.string().max(20)).max(16).optional(),
  /** Saved terminal layouts (see components/terminal). */
  terminalLayouts: z.array(z.object({ id: z.string().max(40), name: z.string().max(60), groups: z.record(z.string().max(4), z.string().max(16)).optional(), panels: z.array(z.record(z.string(), z.unknown())).max(12) })).max(20).optional(),
  notify: z
    .object({
      push: z.boolean().optional(),
      telegram: z.boolean().optional(),
      morningBrief: z.boolean().optional(),
      weeklyRedTeam: z.boolean().optional(),
      earningsWatch: z.boolean().optional(),
      macro: z.boolean().optional(),
    })
    .optional(),
});

export const GET = route(async ({ user }) => {
  const row = await q1<{ data: Record<string, unknown> }>('select data from public.user_settings where user_id = $1', [user.id]);
  return { marketColors: 'red-green', motion: 'system', benchmark: 'SPY', riskFreeRate: null, aiModel: null, taxShortRate: null, taxLongRate: null, density: 'comfortable', baseCurrency: 'USD', taxJurisdiction: 'US', notify: {}, ...(row?.data ?? {}) };
});

export const PUT = route(async ({ request, user }) => {
  const patch = await body(request, schema);
  const [row] = await q<{ data: Record<string, unknown> }>(
    `insert into public.user_settings (user_id, data) values ($1, $2::jsonb)
     on conflict (user_id) do update set
       -- Merging into anything but an object (a stray string or array) would append instead of merge.
       data = case when jsonb_typeof(public.user_settings.data) = 'object' then public.user_settings.data else '{}'::jsonb end || excluded.data,
       updated_at = now()
     returning data`,
    [user.id, JSON.stringify(patch)],
  );
  return row.data;
});

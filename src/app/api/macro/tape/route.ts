import { route } from '@/lib/api';
import { q1 } from '@/lib/db';
import { memo } from '@/lib/data/http';
import { getMacroTape } from '@/lib/services/macro';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const row = await q1<{ data: { macroTape?: string[] } }>('select data from public.user_settings where user_id = $1', [user.id]);
  const symbols = row?.data?.macroTape?.length ? row.data.macroTape : undefined;
  return memo(`macro:tape:${(symbols ?? []).join(',')}`, 30_000, () => getMacroTape(symbols));
});

import { route } from '@/lib/api';
import { q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const row = await q1<{ input: string | number | null; output: string | number | null; cost: string | number | null }>(
    'select sum(input_tokens) as input, sum(output_tokens) as output, sum(cost_usd) as cost from public.chat_messages where user_id = $1',
    [user.id],
  );
  return { input: Number(row?.input ?? 0), output: Number(row?.output ?? 0), cost: Number(row?.cost ?? 0) };
});

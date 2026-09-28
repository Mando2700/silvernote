import { notFound, route } from '@/lib/api';
import { listActions, toView } from '@/lib/ai/actions';
import { q, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const thread = await q1('select id, title, context, created_at, updated_at from public.chat_threads where id = $1 and user_id = $2', [params.id, user.id]);
  if (!thread) notFound('Conversation not found.');
  const rows = await q<{ id: string; role: string; content: string; created_at: string; input_tokens: number | null; output_tokens: number | null; cost_usd: string | number | null }>(
    'select id, role, content, created_at, input_tokens, output_tokens, cost_usd from public.chat_messages where thread_id = $1 order by created_at',
    [params.id],
  );
  const actions = await listActions(user.id, { messageIds: rows.filter((row) => row.role === 'assistant').map((row) => row.id) });
  const messages = rows.map(({ input_tokens, output_tokens, cost_usd, ...message }) => ({
    ...message,
    actions: actions.filter((action) => action.message_id === message.id).map(toView),
    usage: input_tokens === null ? undefined : { input: input_tokens, output: output_tokens ?? 0, cost: cost_usd === null ? null : Number(cost_usd) },
  }));
  return { ...thread, messages };
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await q('delete from public.chat_threads where id = $1 and user_id = $2', [params.id, user.id]);
  return { ok: true };
});

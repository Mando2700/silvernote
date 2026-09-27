import { notFound, route } from '@/lib/api';
import { q, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const thread = await q1('select id, title, context, created_at, updated_at from public.chat_threads where id = $1 and user_id = $2', [params.id, user.id]);
  if (!thread) notFound('Conversation not found.');
  const messages = await q('select id, role, content, created_at from public.chat_messages where thread_id = $1 order by created_at', [params.id]);
  return { ...thread, messages };
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await q('delete from public.chat_threads where id = $1 and user_id = $2', [params.id, user.id]);
  return { ok: true };
});

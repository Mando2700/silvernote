import { route } from '@/lib/api';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) =>
  q('select id, title, context, created_at, updated_at from public.chat_threads where user_id = $1 order by updated_at desc limit 100', [user.id]),
);

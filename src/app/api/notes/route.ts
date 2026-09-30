import { z } from 'zod';

import { body, route, searchParam } from '@/lib/api';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ request, user }) => {
  const symbol = searchParam(request, 'symbol');
  const term = searchParam(request, 'q');
  return q(
    `select id, symbol, title, left(content, 280) as snippet, tags, pinned, created_at, updated_at,
       (select count(*)::int from public.note_versions v where v.note_id = n.id) as versions
     from public.notes n
     where user_id = $1 and ($2::text is null or symbol = upper($2)) and ($3::text is null or title ilike '%' || $3 || '%' or content ilike '%' || $3 || '%')
     order by pinned desc, updated_at desc limit 300`,
    [user.id, symbol || null, term || null],
  );
});

export const POST = route(async ({ request, user }) => {
  const input = await body(
    request,
    z.object({
      title: z.string().max(200).default(''),
      content: z.string().max(1_500_000).default(''),
      symbol: z.string().trim().toUpperCase().max(16).nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
    }),
  );
  const [note] = await q<{ id: string }>(
    'insert into public.notes (user_id, symbol, title, content, tags) values ($1, $2, $3, $4, $5::text[]) returning *',
    [user.id, input.symbol || null, input.title, input.content, input.tags ?? []],
  );
  await q('insert into public.note_versions (note_id, user_id, title, content) values ($1, $2, $3, $4)', [note.id, user.id, input.title, input.content]);
  return note;
});

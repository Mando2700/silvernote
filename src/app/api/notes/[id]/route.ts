import { z } from 'zod';

import { body, notFound, route } from '@/lib/api';
import { q, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Note = { id: string; title: string; content: string };

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const note = await q1('select * from public.notes where id = $1 and user_id = $2', [params.id, user.id]);
  if (!note) notFound('Note not found.');
  const versions = await q('select id, title, content, created_at from public.note_versions where note_id = $1 order by created_at desc limit 200', [params.id]);
  return { ...note, versions };
});

/**
 * Autosave updates the note in place. A version snapshot is kept on explicit request, or
 * automatically when the last snapshot is more than ten minutes old, so history stays readable.
 */
export const PATCH = route<{ id: string }>(async ({ request, user, params }) => {
  const input = await body(
    request,
    z.object({
      title: z.string().max(200).optional(),
      content: z.string().max(1_500_000).optional(),
      symbol: z.string().trim().toUpperCase().max(16).nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
      pinned: z.boolean().optional(),
      snapshot: z.boolean().optional(),
    }),
  );
  const current = await q1<Note>('select id, title, content from public.notes where id = $1 and user_id = $2', [params.id, user.id]);
  if (!current) notFound('Note not found.');
  const [note] = await q<Note>(
    `update public.notes set title = coalesce($3, title), content = coalesce($4, content),
       symbol = case when $5::boolean then $6 else symbol end, tags = coalesce($7::text[], tags),
       pinned = coalesce($8, pinned), updated_at = now()
     where id = $1 and user_id = $2 returning *`,
    [params.id, user.id, input.title ?? null, input.content ?? null, input.symbol !== undefined, input.symbol || null, input.tags ?? null, input.pinned ?? null],
  );
  const changed = note.title !== current.title || note.content !== current.content;
  if (changed || input.snapshot) {
    const last = await q1<{ age: number; content: string; title: string }>(
      `select extract(epoch from now() - created_at) as age, content, title from public.note_versions where note_id = $1 order by created_at desc limit 1`,
      [params.id],
    );
    const differsFromLast = !last || last.content !== note.content || last.title !== note.title;
    if (differsFromLast && (input.snapshot || !last || Number(last.age) > 600)) {
      await q('insert into public.note_versions (note_id, user_id, title, content) values ($1, $2, $3, $4)', [params.id, user.id, note.title, note.content]);
    }
  }
  return note;
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await q('delete from public.notes where id = $1 and user_id = $2', [params.id, user.id]);
  return { ok: true };
});

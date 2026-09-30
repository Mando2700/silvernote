import { z } from 'zod';

import { body, notFound, route } from '@/lib/api';
import { q, q1 } from '@/lib/db';
import { buildPitchSections, pitchFacts } from '@/lib/pitch';

export const dynamic = 'force-dynamic';

const section = z.object({
  id: z.string().max(40),
  kind: z.string().max(40),
  title: z.string().max(120),
  content: z.string().max(1_000_000),
  included: z.boolean(),
});

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const pitch = await q1<{ symbol: string }>('select * from public.pitches where id = $1 and user_id = $2', [params.id, user.id]);
  if (!pitch) notFound('Pitch not found.');
  return { ...pitch, facts: await pitchFacts(pitch.symbol).catch(() => null) };
});

export const PATCH = route<{ id: string }>(async ({ request, user, params }) => {
  const input = await body(
    request,
    z.object({
      title: z.string().max(160).optional(),
      recommendation: z.enum(['long', 'short', 'hold', 'avoid']).optional(),
      target_price: z.number().positive().max(1e7).nullable().optional(),
      sections: z.array(section).max(30).optional(),
      refreshFrom: z.array(z.string().max(40)).max(30).optional(),
    }),
  );
  const pitch = await q1<{ symbol: string; sections: z.infer<typeof section>[] }>('select symbol, sections from public.pitches where id = $1 and user_id = $2', [params.id, user.id]);
  if (!pitch) notFound('Pitch not found.');
  let sections = input.sections ?? pitch.sections;
  // Re-pull chosen sections from the latest workspace and data.
  if (input.refreshFrom?.length) {
    const fresh = await buildPitchSections(user.id, pitch.symbol);
    sections = sections.map((item) => (input.refreshFrom?.includes(item.kind) ? { ...item, content: fresh.sections.find((candidate) => candidate.kind === item.kind)?.content ?? item.content } : item));
  }
  const [row] = await q(
    `update public.pitches set title = coalesce($3, title), recommendation = coalesce($4, recommendation),
       target_price = case when $5::boolean then $6 else target_price end, sections = $7::jsonb, updated_at = now()
     where id = $1 and user_id = $2 returning *`,
    [params.id, user.id, input.title ?? null, input.recommendation ?? null, input.target_price !== undefined, input.target_price ?? null, JSON.stringify(sections)],
  );
  return row;
});

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await q('delete from public.pitches where id = $1 and user_id = $2', [params.id, user.id]);
  return { ok: true };
});

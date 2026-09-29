import { z } from 'zod';

import { body, route } from '@/lib/api';
import { deleteShare, updateShare } from '@/lib/services/shares';
import { SHARE_EXPIRIES } from '@/lib/share/options';

export const dynamic = 'force-dynamic';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

/** Revoke or restore a link, change when it expires, set or remove its passcode, or edit its wording. What it reveals is fixed: make a new link for that. */
export const PATCH = route<{ id: string; shareId: string }>(async ({ request, user, params }) => {
  const input = await body(
    request,
    z.object({
      revoked: z.boolean().optional(),
      expires: z.enum(SHARE_EXPIRIES).optional(),
      passcode: z.string().min(4, 'The passcode needs at least 4 characters.').max(64).nullable().optional(),
      title: text(80).optional(),
      message: text(280).optional(),
    }),
  );
  return updateShare(user.id, params.id, params.shareId, input);
});

export const DELETE = route<{ id: string; shareId: string }>(async ({ user, params }) => {
  await deleteShare(user.id, params.id, params.shareId);
  return { ok: true };
});

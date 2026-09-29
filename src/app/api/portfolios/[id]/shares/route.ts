import { z } from 'zod';

import { body, route } from '@/lib/api';
import { createShare, listShares } from '@/lib/services/shares';
import { SHARE_EXPIRIES, SHARE_MODES, shareOptionsSchema } from '@/lib/share/options';

export const dynamic = 'force-dynamic';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const GET = route<{ id: string }>(async ({ user, params }) => listShares(user.id, params.id));

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  const input = await body(
    request,
    z.object({
      title: text(80),
      message: text(280),
      mode: z.enum(SHARE_MODES),
      options: shareOptionsSchema,
      expires: z.enum(SHARE_EXPIRIES),
      passcode: z
        .string()
        .min(4, 'The passcode needs at least 4 characters.')
        .max(64)
        .nullish()
        .transform((value) => value || null),
    }),
  );
  return createShare(user.id, params.id, input);
});

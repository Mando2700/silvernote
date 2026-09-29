import { z } from 'zod';

import { route } from '@/lib/api';
import { deleteAttempt } from '@/lib/services/learn';

export const dynamic = 'force-dynamic';

export const DELETE = route<{ id: string }>(async ({ user, params }) => {
  await deleteAttempt(user.id, z.string().uuid().parse(params.id));
  return { ok: true };
});

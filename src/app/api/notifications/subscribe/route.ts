import { z } from 'zod';

import { body, route } from '@/lib/api';
import { deletePushSubscription, savePushSubscription } from '@/lib/services/notify';

export const dynamic = 'force-dynamic';

const subscription = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

export const POST = route(async ({ request, user }) => {
  const input = await body(request, subscription);
  await savePushSubscription(user.id, input, request.headers.get('user-agent'));
  return { ok: true };
});

export const DELETE = route(async ({ request, user }) => {
  const input = await body(request, z.object({ endpoint: z.string().max(1000) }));
  await deletePushSubscription(user.id, input.endpoint);
  return { ok: true };
});

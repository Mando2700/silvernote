import { z } from 'zod';

import { body, route } from '@/lib/api';
import { connectIbkr, disconnectIbkr, ibkrStatus } from '@/lib/services/ibkr';

export const dynamic = 'force-dynamic';
// Connecting runs the first sync, and IBKR can take a while to generate a statement.
export const maxDuration = 120;

export const GET = route(async ({ user }) => ibkrStatus(user.id));

export const POST = route(async ({ request, user }) => {
  const input = await body(
    request,
    z.object({
      token: z.string().trim().regex(/^\d{10,40}$/, 'The Flex token is a long number from Flex Web Service Configuration.'),
      queryId: z.string().trim().regex(/^\d{3,12}$/, 'The query id is the number shown next to your Flex Query.'),
    }),
  );
  const result = await connectIbkr(user.id, input.token, input.queryId);
  return { result, status: await ibkrStatus(user.id) };
});

export const DELETE = route(async ({ user }) => {
  await disconnectIbkr(user.id);
  return { ok: true };
});

import { route } from '@/lib/api';
import { ibkrStatus, syncIbkr } from '@/lib/services/ibkr';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const POST = route(async ({ user }) => {
  const result = await syncIbkr(user.id);
  return { result, status: await ibkrStatus(user.id) };
});

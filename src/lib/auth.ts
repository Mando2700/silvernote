import 'server-only';

import { env, isAuthEnabled } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase';

export type SessionUser = { id: string; email: string | null; local: boolean };

/** The single owner when SilverNote runs locally without Supabase Auth. */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isAuthEnabled()) return { id: LOCAL_USER_ID, email: null, local: true };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  // Single-user app: only the configured owner may use it, even if someone else signs up.
  // Without OWNER_EMAIL nobody is admitted, so a missing setting can never open the app to everyone.
  if (!env.ownerEmail || user.email?.toLowerCase() !== env.ownerEmail) return null;
  return { id: user.id, email: user.email ?? null, local: false };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  return user;
}

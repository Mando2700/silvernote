import 'server-only';

import { env, isAuthEnabled } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase';

export type SessionUser = { id: string; email: string | null; local: boolean };

/** The single owner when SilverNote runs locally without Supabase Auth. */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

let ownerIdLookup: Promise<string | null> | null = null;

/**
 * Local mode pointed at the hosted Supabase database: act as the owner's real account so local and
 * deployed sessions read and write the same rows instead of splitting data under LOCAL_USER_ID.
 */
function localUserId(): Promise<string> {
  if (!env.databaseUrl || !env.ownerEmail) return Promise.resolve(LOCAL_USER_ID);
  ownerIdLookup ??= import('@/lib/db')
    .then(({ q1 }) => q1<{ id: string }>('select id::text from auth.users where lower(email) = $1 limit 1', [env.ownerEmail]))
    .then((row) => row?.id ?? null)
    .catch(() => null);
  return ownerIdLookup.then((id) => id ?? LOCAL_USER_ID);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isAuthEnabled()) return { id: await localUserId(), email: null, local: true };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  // Only the emails listed in OWNER_EMAIL may use it, even if someone else signs up.
  // Without OWNER_EMAIL nobody is admitted, so a missing setting can never open the app to everyone.
  if (!user.email || !env.allowedEmails.includes(user.email.toLowerCase())) return null;
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

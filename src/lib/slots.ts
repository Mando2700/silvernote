import 'server-only';

import { q1 } from '@/lib/db';

/**
 * Take a named slot for `seconds`: true for exactly one caller until it expires. Lets overlapping
 * cron invocations (Vercel, GitHub, a page load) agree on who does a piece of work.
 */
export async function claimSlot(key: string, seconds: number) {
  const row = await q1<{ key: string }>(
    `insert into public.api_cache (key, payload, fetched_at, expires_at) values ($1, '{}'::jsonb, now(), now() + ($2 || ' seconds')::interval)
     on conflict (key) do update set fetched_at = now(), expires_at = excluded.expires_at
       where public.api_cache.expires_at <= now()
     returning key`,
    [`slot:${key}`, String(seconds)],
  );
  return Boolean(row);
}

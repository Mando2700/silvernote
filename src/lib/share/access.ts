import 'server-only';

import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { ShareExpiry } from '@/lib/share/options';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** An unguessable link token (144 bits, URL-safe). */
export function newShareToken() {
  return randomBytes(18).toString('base64url');
}

const EXPIRY_DAYS: Record<Exclude<ShareExpiry, 'never'>, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };

export function expiryDate(expiry: ShareExpiry, from = new Date()): Date | null {
  if (expiry === 'never') return null;
  return new Date(from.getTime() + EXPIRY_DAYS[expiry] * 86_400_000);
}

export async function hashPasscode(passcode: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(passcode, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPasscode(passcode: string, stored: string) {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(passcode, Buffer.from(salt, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The cookie a visitor receives after entering the right passcode. It is keyed by the stored hash, so it
 * cannot be forged without database access and stops working the moment the passcode changes.
 */
export function accessProof(share: { id: string; token: string; passcode_hash: string }) {
  return createHmac('sha256', share.passcode_hash).update(`${share.id}:${share.token}`).digest('base64url');
}

export function accessCookieName(shareId: string) {
  return `sn_share_${createHash('sha256').update(shareId).digest('hex').slice(0, 16)}`;
}

export function hasAccess(share: { id: string; token: string; passcode_hash: string | null }, cookieValue: string | undefined) {
  if (!share.passcode_hash) return true;
  if (!cookieValue) return false;
  const expected = Buffer.from(accessProof({ ...share, passcode_hash: share.passcode_hash }));
  const given = Buffer.from(cookieValue);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type ShareStatus = 'ok' | 'expired' | 'revoked';

export function shareStatus(share: { revoked_at: Date | string | null; expires_at: Date | string | null }, now = Date.now()): ShareStatus {
  if (share.revoked_at) return 'revoked';
  if (share.expires_at && new Date(share.expires_at).getTime() <= now) return 'expired';
  return 'ok';
}

/** A small in-memory limiter for passcode guesses: `limit` tries per key per window. */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function takeAttempt(key: string, limit = 8, windowMs = 10 * 60_000, now = Date.now()) {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    if (attempts.size > 2000) for (const [stale, value] of attempts) if (value.resetAt <= now) attempts.delete(stale);
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function clearAttempts(key: string) {
  attempts.delete(key);
}

/**
 * The limiter shared by every server instance (serverless instances each have their own memory):
 * counted in the database, falling back to the in-memory limiter if the database can't be reached.
 */
export async function takeSharedAttempt(key: string, limit = 8, windowMs = 10 * 60_000) {
  try {
    const { q1 } = await import('@/lib/db');
    const row = await q1<{ count: number }>(
      `insert into public.share_attempts (key, count, reset_at) values ($1, 1, now() + ($2 || ' milliseconds')::interval)
       on conflict (key) do update set
         count = case when public.share_attempts.reset_at <= now() then 1 else public.share_attempts.count + 1 end,
         reset_at = case when public.share_attempts.reset_at <= now() then excluded.reset_at else public.share_attempts.reset_at end
       returning count`,
      [key, String(windowMs)],
    );
    if (Math.random() < 0.02) void q1("delete from public.share_attempts where reset_at < now() - interval '1 day'").catch(() => {});
    return (row?.count ?? 1) <= limit;
  } catch {
    return takeAttempt(key, limit, windowMs);
  }
}

export async function clearSharedAttempts(key: string) {
  clearAttempts(key);
  const { q } = await import('@/lib/db');
  await q('delete from public.share_attempts where key = $1', [key]).catch(() => {});
}

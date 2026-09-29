import { describe, expect, it } from 'vitest';

import { accessCookieName, accessProof, expiryDate, hasAccess, hashPasscode, newShareToken, shareStatus, takeAttempt, verifyPasscode } from '@/lib/share/access';

describe('share tokens', () => {
  it('are unique, URL-safe and long enough to be unguessable', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newShareToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

describe('passcodes', () => {
  it('verify only the right passcode', async () => {
    const stored = await hashPasscode('correct horse');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('correct horse');
    expect(await verifyPasscode('correct horse', stored)).toBe(true);
    expect(await verifyPasscode('correct horsE', stored)).toBe(false);
    expect(await verifyPasscode('', stored)).toBe(false);
  });

  it('are salted', async () => {
    expect(await hashPasscode('same')).not.toBe(await hashPasscode('same'));
  });

  it('reject a malformed stored value', async () => {
    expect(await verifyPasscode('x', 'plaintext')).toBe(false);
  });
});

describe('access cookie', () => {
  const share = { id: '11111111-1111-4111-8111-111111111111', token: 'tokentokentokentokentoken', passcode_hash: 'scrypt$salt$hash' };

  it('opens an unprotected link without a cookie', () => {
    expect(hasAccess({ ...share, passcode_hash: null }, undefined)).toBe(true);
  });

  it('needs the proof for a protected link', () => {
    expect(hasAccess(share, undefined)).toBe(false);
    expect(hasAccess(share, 'guess')).toBe(false);
    expect(hasAccess(share, accessProof(share))).toBe(true);
  });

  it('stops working when the passcode changes or for another link', () => {
    const proof = accessProof(share);
    expect(hasAccess({ ...share, passcode_hash: 'scrypt$salt$other' }, proof)).toBe(false);
    expect(hasAccess({ ...share, id: '22222222-2222-4222-8222-222222222222' }, proof)).toBe(false);
  });

  it('names its cookie per link without revealing the id', () => {
    expect(accessCookieName(share.id)).toMatch(/^sn_share_[0-9a-f]{16}$/);
    expect(accessCookieName(share.id)).not.toContain(share.id.slice(0, 8));
    expect(accessCookieName(share.id)).not.toBe(accessCookieName('22222222-2222-4222-8222-222222222222'));
  });
});

describe('expiry', () => {
  const now = new Date('2026-09-29T12:00:00Z');

  it('computes dates', () => {
    expect(expiryDate('never', now)).toBeNull();
    expect(expiryDate('1d', now)?.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    expect(expiryDate('30d', now)?.toISOString()).toBe('2026-10-29T12:00:00.000Z');
  });

  it('reports the status of a link', () => {
    const t = now.getTime();
    expect(shareStatus({ revoked_at: null, expires_at: null }, t)).toBe('ok');
    expect(shareStatus({ revoked_at: null, expires_at: new Date(t + 1000) }, t)).toBe('ok');
    expect(shareStatus({ revoked_at: null, expires_at: new Date(t - 1000) }, t)).toBe('expired');
    expect(shareStatus({ revoked_at: new Date(t - 5000), expires_at: new Date(t + 1000) }, t)).toBe('revoked');
    expect(shareStatus({ revoked_at: null, expires_at: new Date(t).toISOString() }, t)).toBe('expired');
  });
});

describe('passcode attempt limit', () => {
  it('allows a few tries per key, then blocks until the window ends', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i += 1) expect(takeAttempt('k', 3, 1000, t)).toBe(true);
    expect(takeAttempt('k', 3, 1000, t)).toBe(false);
    expect(takeAttempt('other', 3, 1000, t)).toBe(true);
    expect(takeAttempt('k', 3, 1000, t + 1001)).toBe(true);
  });
});

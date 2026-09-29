import { NextResponse } from 'next/server';
import { z } from 'zod';

import { body, errorResponse } from '@/lib/api';
import { accessCookieName, accessProof, clearAttempts, shareStatus, takeAttempt, verifyPasscode } from '@/lib/share/access';
import { getShareByToken } from '@/lib/services/shares';

export const dynamic = 'force-dynamic';

/** Public: a visitor trades the right passcode for a cookie that lets this one link open. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const { passcode } = await body(request, z.object({ passcode: z.string().max(64) }));
    const share = await getShareByToken(token);
    // Unknown, expired and revoked links answer alike, so probing tells nothing.
    if (!share || !share.passcode_hash || shareStatus(share) !== 'ok') return NextResponse.json({ error: 'This link is not available.' }, { status: 404 });

    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const key = `${share.id}:${forwarded}`;
    if (!takeAttempt(key)) return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
    if (!(await verifyPasscode(passcode, share.passcode_hash))) return NextResponse.json({ error: 'That passcode is not right.' }, { status: 403 });

    clearAttempts(key);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(accessCookieName(share.id), accessProof({ id: share.id, token: share.token, passcode_hash: share.passcode_hash }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      // Until the link expires, or a week.
      maxAge: share.expires_at ? Math.max(60, Math.floor((new Date(share.expires_at).getTime() - Date.now()) / 1000)) : 7 * 86_400,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

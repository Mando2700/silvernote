import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { symbolSchema } from '@/lib/api';
import { accessCookieName, hasAccess, shareStatus } from '@/lib/share/access';
import { getLogo } from '@/lib/services/logos';
import { getShareByToken, getShareView } from '@/lib/services/shares';

export const dynamic = 'force-dynamic';

const missing = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=300' } });

/**
 * Public: a company logo for a shared page. It only answers for a link that is open to this visitor and
 * only for tickers that link actually shows, so it cannot be used to browse logos or to probe holdings.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string; symbol: string }> }) {
  const { token, symbol: rawSymbol } = await context.params;
  const parsed = symbolSchema.safeParse(rawSymbol);
  const share = parsed.success ? await getShareByToken(token) : null;
  if (!parsed.success || !share || shareStatus(share) !== 'ok') return missing();
  if (!hasAccess(share, (await cookies()).get(accessCookieName(share.id))?.value)) return missing();
  const view = await getShareView(share);
  if (!view?.holdings.some((row) => row.symbol === parsed.data) && !view?.allocation.some((slice) => slice.kind === 'holding' && slice.label === parsed.data)) return missing();
  const logo = await getLogo(parsed.data);
  if (!logo) return missing();
  return new Response(new Blob([logo.data as Uint8Array<ArrayBuffer>], { type: logo.contentType }), {
    headers: {
      'Content-Type': logo.contentType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

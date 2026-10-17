import { NextResponse, type NextRequest } from 'next/server';

/**
 * Redirect to a same-site path on the address the browser asked for. request.url can't be trusted for
 * that: on Netlify it carries the deploy's own host (<id>--site.netlify.app), where the session cookies
 * don't exist. Route handlers send a relative Location; the proxy (which needs absolute URLs) rebuilds
 * the origin from the forwarded host.
 */
export function redirectTo(path: string, status: 303 | 307 = 307, request?: NextRequest) {
  if (!request) return new NextResponse(null, { status, headers: { Location: path } });
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0] ?? request.nextUrl.protocol.replace(':', '');
  return NextResponse.redirect(new URL(path, `${protocol}://${host}`), status);
}

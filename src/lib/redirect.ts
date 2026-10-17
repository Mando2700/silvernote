import { NextResponse } from 'next/server';

/**
 * Redirect to a same-site path with a relative Location, so the browser stays on the address it is
 * on. Absolute URLs built from request.url can point elsewhere: on Netlify it carries the deploy's own
 * host (<id>--site.netlify.app), where the session cookies don't exist.
 */
export function redirectTo(path: string, status: 303 | 307 = 307) {
  return new NextResponse(null, { status, headers: { Location: path } });
}

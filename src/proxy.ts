import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth gate for Supabase mode: refreshes the session cookie on every request, sends signed-out
 * visitors to /login (401 JSON for API calls) and admits only OWNER_EMAIL. In local mode (no
 * Supabase settings) it does nothing; the dev/prod servers bind to 127.0.0.1 instead.
 */

// Shared portfolio links (/s/<token>) and their passcode check are for people without a SilverNote account.
// /api/cron checks its own shared secret; the manifest, service worker and app icons must load before sign-in.
const PUBLIC_PREFIXES = ['/login', '/auth/', '/s/', '/api/share/', '/api/cron', '/manifest.webmanifest', '/sw.js', '/apple-icon'];

function copyCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return NextResponse.next();
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Validates the JWT with Supabase and refreshes it when needed; keep this before any branching.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowed = Boolean(user && owner && user.email?.toLowerCase() === owner);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));

  if (!allowed && !isPublic) {
    if (path.startsWith('/api/')) return copyCookies(response, NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 }));
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = path === '/' ? '' : `?next=${encodeURIComponent(`${path}${request.nextUrl.search}`)}`;
    return copyCookies(response, NextResponse.redirect(login));
  }
  if (allowed && path === '/login') {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return copyCookies(response, NextResponse.redirect(home));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)'],
};

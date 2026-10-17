import type { NextRequest } from 'next/server';

import { isAuthEnabled } from '@/lib/env';
import { redirectTo } from '@/lib/redirect';
import { createSupabaseServerClient } from '@/lib/supabase';

/** Landing point for Supabase email links (sign-up confirmation, password reset): trade the code for a session. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  // Same-site paths only, so a crafted link can't bounce to another site.
  const requested = request.nextUrl.searchParams.get('next') ?? '/';
  const next = requested.startsWith('/') && !requested.startsWith('//') && !requested.startsWith('/\\') ? requested : '/';
  // An expired or already-used link comes back with an error instead of a code.
  const failed = request.nextUrl.searchParams.get('error_description');
  if (failed) return redirectTo(`/login?error=${encodeURIComponent(`${failed}. Request a new link.`)}`);
  if (isAuthEnabled() && code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return redirectTo(`/login?error=${encodeURIComponent(error.message)}`);
  }
  return redirectTo(next);
}

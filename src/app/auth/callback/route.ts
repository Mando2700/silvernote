import { NextResponse, type NextRequest } from 'next/server';

import { isAuthEnabled } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase';

/** Landing point for Supabase email links (sign-up confirmation): trade the code for a session. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (isAuthEnabled() && code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url));
  }
  return NextResponse.redirect(new URL('/', request.url));
}

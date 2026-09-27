import { NextResponse, type NextRequest } from 'next/server';

import { isAuthEnabled } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (isAuthEnabled()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}

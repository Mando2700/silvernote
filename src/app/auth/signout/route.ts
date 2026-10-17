import { isAuthEnabled } from '@/lib/env';
import { redirectTo } from '@/lib/redirect';
import { createSupabaseServerClient } from '@/lib/supabase';

export async function POST() {
  if (isAuthEnabled()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  return redirectTo('/login', 303);
}

'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { env, isAuthEnabled } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase';

export type LoginState = { error?: string; message?: string };

/** Only same-site paths, so a crafted ?next= can't bounce the owner to another site. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

export async function authenticate(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (!isAuthEnabled()) redirect('/');
  if (!env.ownerEmail) return { error: 'Set OWNER_EMAIL in the server environment before signing in.' };

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const mode = formData.get('mode') === 'signup' ? 'signup' : 'signin';
  if (!email || password.length < 8) return { error: 'Enter your email and a password of at least 8 characters.' };
  if (email !== env.ownerEmail) return { error: 'This SilverNote belongs to its owner. Use the owner account.' };

  const supabase = await createSupabaseServerClient();
  if (mode === 'signup') {
    const requestHeaders = await headers();
    const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
    const protocol = requestHeaders.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.0.0.1') ? 'http' : 'https');
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: host ? `${protocol}://${host}/auth/callback` : undefined } });
    if (error) return { error: error.message };
    if (data.session) {
      // Supabase handed out a session without email confirmation, so anyone who knows OWNER_EMAIL could
      // have claimed it first. Don't sign in on that basis.
      await supabase.auth.signOut();
      return {
        error:
          'Supabase signed this account in without confirming the email, so anyone who knew the owner email could have claimed it. Turn on “Confirm email” (Authentication → Sign In / Providers → Email) in Supabase, delete this user there, and sign up again.',
      };
    }
    return { message: 'Account created. Confirm the link we emailed you, then sign in.' };
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message };
  }
  redirect(safeNext(formData.get('next')));
}

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

/** This site's own origin, for links in Supabase emails. */
async function siteOrigin() {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) return undefined;
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

export async function authenticate(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (!isAuthEnabled()) redirect('/');
  if (!env.allowedEmails.length) return { error: 'Set OWNER_EMAIL in the server environment before signing in.' };

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const mode = formData.get('mode') === 'signup' ? 'signup' : formData.get('mode') === 'reset' ? 'reset' : 'signin';
  if (mode === 'reset') {
    if (!email) return { error: 'Enter your email.' };
    // Same answer for any address, so the form doesn't reveal which emails are allowed.
    const sent = { message: 'If that email belongs to this SilverNote, a reset link is on its way. Open it in this browser.' };
    if (!env.allowedEmails.includes(email)) return sent;
    const origin = await siteOrigin();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: origin ? `${origin}/auth/callback?next=/reset-password` : undefined });
    if (error) return { error: error.message };
    return sent;
  }
  if (!email || password.length < 8) return { error: 'Enter your email and a password of at least 8 characters.' };
  if (!env.allowedEmails.includes(email)) return { error: 'This SilverNote is invite-only. Use an email that has been allowed.' };

  const supabase = await createSupabaseServerClient();
  if (mode === 'signup') {
    const origin = await siteOrigin();
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: origin ? `${origin}/auth/callback` : undefined } });
    if (error) return { error: error.message };
    if (data.session) {
      // Supabase handed out a session without email confirmation, so anyone who knew an allowed email could
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

/** Set a new password for the signed-in owner (reached from the reset email's link). */
export async function setNewPassword(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (!isAuthEnabled()) redirect('/');
  const password = String(formData.get('password') ?? '');
  if (password.length < 8) return { error: 'Use at least 8 characters.' };
  if (password !== String(formData.get('confirm') ?? '')) return { error: 'The two passwords differ.' };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'The reset link has expired. Request a new one from the sign-in page.' };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect('/');
}

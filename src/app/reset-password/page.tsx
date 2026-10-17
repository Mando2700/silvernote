import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { isAuthEnabled } from '@/lib/env';

export const metadata: Metadata = { title: 'New password' };
export const dynamic = 'force-dynamic';

/** Reached from the password-reset email (through /auth/callback, which signs the owner in first). */
export default function ResetPasswordPage() {
  if (!isAuthEnabled()) redirect('/');
  return <ResetPasswordForm />;
}

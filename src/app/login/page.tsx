import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/auth/login-form';
import { env, isAuthEnabled } from '@/lib/env';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  if (!isAuthEnabled()) redirect('/');
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '/';
  const error = typeof params.error === 'string' ? params.error : null;
  return <LoginForm next={next} initialError={error} ownerConfigured={Boolean(env.ownerEmail)} />;
}

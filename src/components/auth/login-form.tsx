'use client';

import { ArrowRight, Lock } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useActionState, useState } from 'react';

import { authenticate, type LoginState } from '@/app/login/actions';
import { HeroCanvas } from '@/components/hero/hero-canvas';
import { BrandMark, Wordmark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';

export function LoginForm({ next, initialError, ownerConfigured }: { next: string; initialError: string | null; ownerConfigured: boolean }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  // Controlled so a failed attempt keeps the address (React resets uncontrolled fields after an action).
  const [email, setEmail] = useState('');
  const [state, action, pending] = useActionState<LoginState, FormData>(authenticate, initialError ? { error: initialError } : {});

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div className="grid-backdrop pointer-events-none absolute inset-0" />
      <HeroCanvas className="pointer-events-none absolute inset-x-0 bottom-0 h-[55vh] opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,rgba(205,212,222,0.07),transparent_70%)]" />

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3">
          <span className="sheen rounded-[10px] shadow-[0_0_40px_-8px_rgba(205,212,222,0.5)]">
            <BrandMark size={44} />
          </span>
          <Wordmark className="text-[15px]" />
          <p className="text-center text-[12.5px] text-muted">Private research workstation</p>
        </div>

        <div className="panel light-trail p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]">
          {!ownerConfigured ? (
            <div className="mb-4 rounded-sm border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
              OWNER_EMAIL is not set on the server, so no account can sign in yet.
            </div>
          ) : null}
          <form action={action} className="flex flex-col gap-3.5">
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="next" value={next} />
            <Field label="Email">
              <Input name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} className="h-9" />
            </Field>
            <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              <Input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} className="h-9" />
            </Field>
            <AnimatePresence initial={false} mode="wait">
              {state.error || state.message ? (
                <motion.div
                  key={state.error ?? state.message}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className={state.error ? 'text-[12px] text-loss' : 'text-[12px] text-gain'}
                  role="status"
                >
                  {state.error ?? state.message}
                </motion.div>
              ) : null}
            </AnimatePresence>
            <Button type="submit" variant="primary" size="md" loading={pending} icon={pending ? undefined : mode === 'signin' ? <Lock className="size-3.5" /> : <ArrowRight className="size-3.5" />} className="mt-1 w-full">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => setMode((value) => (value === 'signin' ? 'signup' : 'signin'))}
          className="mx-auto mt-4 block text-[12px] text-muted hover:text-ink-2"
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Already set up? Sign in'}
        </button>
      </motion.div>
    </main>
  );
}

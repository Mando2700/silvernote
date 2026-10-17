'use client';

import { Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useActionState } from 'react';

import { setNewPassword, type LoginState } from '@/app/login/actions';
import { BrandMark, Wordmark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(setNewPassword, {});

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div className="grid-backdrop pointer-events-none absolute inset-0" />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3">
          <BrandMark size={44} />
          <Wordmark className="text-[15px]" />
          <p className="text-center text-[12.5px] text-muted">Choose a new password</p>
        </div>
        <div className="panel p-5">
          <form action={action} className="flex flex-col gap-3.5">
            <Field label="New password" hint="At least 8 characters.">
              <Input name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus className="h-9" />
            </Field>
            <Field label="Repeat it">
              <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} className="h-9" />
            </Field>
            {state.error ? (
              <div className="text-[12px] text-loss" role="status">
                {state.error}
              </div>
            ) : null}
            <Button type="submit" variant="primary" size="md" loading={pending} icon={pending ? undefined : <Lock className="size-3.5" />} className="mt-1 w-full">
              Save and sign in
            </Button>
          </form>
        </div>
      </motion.div>
    </main>
  );
}

'use client';

import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Panel } from '@/components/ui/primitives';
import { api } from '@/lib/client';

/** Asks a visitor for the passcode of a protected link, then reloads the page with access. */
export function ShareLockScreen({ token }: { token: string }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!passcode || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/share/${token}/unlock`, { body: { passcode } });
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };

  return (
    <Panel className="mx-auto mt-10 w-full max-w-sm p-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid size-10 place-items-center rounded-md border border-line-strong bg-surface-3 text-brand-soft">
          <Lock className="size-4" />
        </div>
        <div>
          <h1 className="text-[16px] font-semibold text-ink">This portfolio is protected</h1>
          <p className="mt-1 text-[12.5px] text-muted">Enter the passcode you were given to view it.</p>
        </div>
        <Input type="password" autoFocus autoComplete="off" value={passcode} onChange={(event) => setPasscode(event.target.value)} placeholder="Passcode" aria-label="Passcode" aria-invalid={Boolean(error)} />
        {error ? <p className="-mt-2 text-[12px] text-loss">{error}</p> : null}
        <Button type="submit" variant="primary" size="md" loading={busy} disabled={!passcode}>
          View portfolio
        </Button>
      </form>
    </Panel>
  );
}

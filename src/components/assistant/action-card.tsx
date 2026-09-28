'use client';

import { Check, ChevronDown, CircleAlert, ExternalLink, Wand2, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { mutate as globalMutate } from 'swr';

import { Button } from '@/components/ui/button';
import type { ActionView } from '@/lib/ai/actions';
import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

export type { ActionView };

/** A change Grok proposed. Nothing is applied until the investor presses Confirm. */
export function ActionCard({ action: initial }: { action: ActionView }) {
  const [action, setAction] = useState(initial);
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null);
  const [open, setOpen] = useState(false);

  const resolve = async (decision: 'confirm' | 'decline') => {
    setBusy(decision);
    try {
      const response = await fetch(`/api/ai/actions/${action.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = (await response.json()) as ActionView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Request failed');
      setAction(data);
      if (data.status === 'done') {
        toast.success('Done');
        // Refresh whatever lists the change touched (notes, watchlists, alerts, workspaces…).
        void globalMutate((key) => typeof key === 'string' && key.startsWith('/api/') && !key.startsWith('/api/ai/'));
      } else if (data.status === 'failed') {
        toast.error(data.error ?? 'Could not apply the change');
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pending = action.status === 'pending';
  return (
    <div
      className={cn(
        'mt-2 rounded-sm border px-3 py-2 text-[12.5px]',
        pending ? 'border-brand/35 bg-brand-wash' : action.status === 'failed' ? 'border-critical/40 bg-critical/5' : 'border-line bg-surface-2/50',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted">
          {action.status === 'done' ? <Check className="size-3.5 text-gain" /> : action.status === 'failed' ? <CircleAlert className="size-3.5 text-critical" /> : action.status === 'declined' ? <X className="size-3.5" /> : <Wand2 className="size-3.5 text-brand" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn('leading-snug', action.status === 'declined' ? 'text-faint line-through' : 'text-ink')}>{action.summary}</div>
          {action.status === 'failed' && action.error ? <div className="mt-0.5 text-[11.5px] text-[#ff8a8e]">{action.error}</div> : null}
          {action.preview ? (
            <button type="button" onClick={() => setOpen((value) => !value)} className="mt-1 flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] text-faint uppercase hover:text-ink-2">
              <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
              {open ? 'Hide text' : 'Preview text'}
            </button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pending ? (
            <>
              <Button size="xs" variant="ghost" loading={busy === 'decline'} disabled={busy !== null} onClick={() => void resolve('decline')}>
                Dismiss
              </Button>
              <Button size="xs" variant="primary" loading={busy === 'confirm'} disabled={busy !== null} onClick={() => void resolve('confirm')}>
                Confirm
              </Button>
            </>
          ) : action.status === 'done' && action.href ? (
            <Link href={action.href} className="flex items-center gap-1 font-mono text-[10.5px] text-brand-soft hover:underline">
              Open <ExternalLink className="size-3" />
            </Link>
          ) : (
            <span className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">{action.status}</span>
          )}
        </div>
      </div>
      {open && action.preview ? (
        <div className="prose-rn mt-2 max-h-64 overflow-y-auto border-t border-line pt-2 text-[12.5px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(action.preview) }} />
      ) : null}
    </div>
  );
}

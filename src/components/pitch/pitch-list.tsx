'use client';

import { ArrowUpRight, Plus, Presentation } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Delta } from '@/components/motion/delta';
import { recommendationTone } from '@/components/pitch/pitch-builder';
import { Page } from '@/components/shell/page';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Modal } from '@/components/ui/overlay';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { api, revalidate } from '@/lib/client';
import { price, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSearchParams } from '@/components/shell/keep-alive';

type PitchRow = {
  id: string;
  symbol: string;
  title: string;
  recommendation: string;
  target_price: number | null;
  created_at: string;
  updated_at: string;
  name: string | null;
  price: number | null;
};

export function PitchList() {
  const router = useRouter();
  const params = useSearchParams();
  const { data } = useSWR<PitchRow[]>('/api/pitches');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const handledNew = useRef(false);

  const create = async (symbol: string) => {
    setCreating(symbol);
    try {
      const pitch = await api<{ id: string }>('/api/pitches', { body: { symbol } });
      void revalidate('/api/pitches');
      router.push(`/pitches/${pitch.id}`);
    } catch (reason) {
      toast.error((reason as Error).message);
      setCreating(null);
    }
  };

  // /pitches?new=AAPL starts a pitch straight away (used by links elsewhere in the app).
  useEffect(() => {
    const symbol = params.get('new');
    if (!symbol || handledNew.current) return;
    handledNew.current = true;
    void create(symbol.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <Page
      kicker="Research · export to PDF or slides"
      title="Pitches"
      description="Turn a company workspace into a pitch: thesis, drivers, valuation, catalysts, risks and what would prove you wrong, pre-filled from your notes, the SilverNote Score and filed financials."
      actions={
        <Magnetic>
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>
            New pitch
          </Button>
        </Magnetic>
      }
    >
      {!data ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-40" />
          ))}
        </div>
      ) : data.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((pitch, index) => {
            const upside = pitch.target_price && pitch.price ? pitch.target_price / pitch.price - 1 : null;
            return (
              <motion.div key={pitch.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.035, ease: [0.16, 1, 0.3, 1] }}>
                <Link href={`/pitches/${pitch.id}`} className="panel group flex h-full flex-col gap-3 p-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong">
                  <div className="flex items-center gap-3">
                    <CompanyLogo symbol={pitch.symbol} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[12px] font-semibold text-ink">{pitch.symbol}</div>
                      <div className="truncate text-[11.5px] text-muted">{pitch.name ?? '—'}</div>
                    </div>
                    <span className={cn('rounded-xs border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.08em] uppercase', recommendationTone(pitch.recommendation))}>
                      {pitch.recommendation}
                    </span>
                  </div>
                  <div className="line-clamp-2 min-h-10 text-[14px] leading-snug font-medium text-ink">{pitch.title}</div>
                  <div className="mt-auto flex items-center gap-4 border-t border-line pt-3 text-[11.5px]">
                    <span className="text-muted">
                      Price <span className="num text-ink-2">{price(pitch.price)}</span>
                    </span>
                    <span className="text-muted">
                      Target <span className="num text-ink-2">{pitch.target_price ? price(pitch.target_price) : '—'}</span>
                    </span>
                    {upside !== null ? <Delta value={upside} digits={0} className="text-[11.5px]" /> : null}
                    <span className="ml-auto flex items-center gap-1 text-faint">
                      {relativeTime(pitch.updated_at)}
                      <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Presentation className="size-4" />}
          title="No pitches yet"
          body="Pick a company to start. Sections are pre-filled from your workspace, the score and the latest filings — then edit, draft with Grok, reorder and export."
          action={
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>
              New pitch
            </Button>
          }
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New pitch" description="Which company is it about?">
        <TickerSearch autoFocus placeholder="Search a ticker or company…" onPick={(symbol) => void create(symbol)} />
        {creating ? <div className="mt-3 text-[12px] text-muted">Building the {creating} pitch from your workspace and the latest data…</div> : null}
      </Modal>
    </Page>
  );
}

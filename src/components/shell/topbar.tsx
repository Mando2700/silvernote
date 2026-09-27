'use client';

import { Bell, Database, RefreshCw, Search, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Delta } from '@/components/motion/delta';
import { Sparkline } from '@/components/motion/sparkline';
import { useShell } from '@/components/shell/providers';
import { Button, IconButton } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Kbd } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';
import { plural, price, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export type StatusPayload = {
  user: { email: string | null; local: boolean };
  config: {
    database: 'local' | 'supabase';
    auth: 'local' | 'supabase';
    providers: Record<'nasdaq' | 'sec' | 'fred' | 'finnhub' | 'fmp', boolean>;
    ai: { configured: boolean; model: string };
    secUserAgentCustomized: boolean;
  };
  universe: { count: number; common: number; updated_at: string | null } | null;
  jobs: Partial<Record<'universe' | 'fundamentals' | 'scores', JobInfo>>;
  scores: { scored: number; fresh: number } | null;
  marketOpen: boolean;
  usage: { fmpCallsToday: number };
};

type JobInfo = { id: string; kind: string; status: string; total: number; done: number; message: string | null; error: string | null; finished_at: string | null };

type IndexItem = { symbol: string; name: string; price: number | null; changePct: number | null; spark: number[] };

export function useStatus() {
  const { data, mutate } = useSWR<StatusPayload>('/api/status', {
    refreshInterval: (latest) => (latest && Object.values(latest.jobs).some((job) => job?.status === 'running') ? 3000 : 30000),
  });
  return { status: data, refresh: mutate };
}

function IndexStrip() {
  const { data } = useSWR<IndexItem[]>('/api/indices', { refreshInterval: 60_000 });
  if (!data?.length) return null;
  return (
    <div className="hidden items-center gap-4 xl:flex">
      {data.map((item) => (
        <Link key={item.symbol} href={`/company/${item.symbol}`} className="group flex items-center gap-2" title={item.name}>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[10px] tracking-wider text-muted group-hover:text-ink-2">{item.name}</span>
            <span className="flex items-baseline gap-1.5">
              <span className="num text-[12px] text-ink">{price(item.price)}</span>
              <Delta value={item.changePct} alreadyPercent className="text-[11px]" />
            </span>
          </div>
          <Sparkline values={item.spark} width={46} height={20} area={false} strokeWidth={1.25} />
        </Link>
      ))}
    </div>
  );
}

function MarketStatus({ open }: { open: boolean | undefined }) {
  if (open === undefined) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5">
      <span className={cn('size-1.5 rounded-full', open ? 'animate-pulse-dot bg-brand' : 'bg-faint')} />
      <span className="font-mono text-[10px] tracking-wider text-muted uppercase">{open ? 'US market open' : 'Market closed'}</span>
    </div>
  );
}

const JOB_LABEL: Record<string, string> = { universe: 'Market snapshot', fundamentals: 'SEC fundamentals', scores: 'Score sweep' };

function JobsIndicator({ status, refresh }: { status: StatusPayload | undefined; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const running = status ? Object.values(status.jobs).filter((job): job is JobInfo => job?.status === 'running') : [];
  const active = running[0];
  const wasRunning = useRef(false);

  useEffect(() => {
    if (wasRunning.current && running.length === 0) {
      void revalidate('/api/universe', '/api/indices', '/api/dashboard', '/api/quotes');
    }
    wasRunning.current = running.length > 0;
  }, [running.length]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const start = async (kind: 'universe' | 'fundamentals' | 'scores') => {
    await api('/api/jobs', { body: { kind } });
    toast.success(`${JOB_LABEL[kind]} started`);
    refresh();
  };

  const progress = active && active.total > 0 ? active.done / active.total : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-7.5 items-center gap-2 rounded-sm border px-2 text-[11.5px] transition-colors',
          active ? 'border-brand/40 bg-brand-wash text-ink' : 'border-line text-muted hover:text-ink-2',
        )}
        aria-label="Data status"
      >
        {active ? <RefreshCw className="size-3.5 animate-spin text-brand" /> : <Database className="size-3.5" />}
        {active ? (
          <span className="hidden max-w-44 truncate md:inline">
            {JOB_LABEL[active.kind]}
            {progress !== null ? ` · ${Math.round(progress * 100)}%` : '…'}
          </span>
        ) : null}
      </button>
      <AnimatePresence>
        {open && status ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="panel absolute top-full right-0 z-50 mt-2 w-80 bg-surface-3 p-3.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)]"
          >
            <div className="kicker mb-2">Data pipeline</div>
            <div className="mb-3 space-y-1 text-[12px] text-ink-2">
              <div className="flex justify-between">
                <span className="text-muted">Universe</span>
                <span>{status.universe?.common?.toLocaleString() ?? 0} common stocks</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Snapshot</span>
                <span>{relativeTime(status.universe?.updated_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">SilverNote Scores</span>
                <span>{plural(status.scores?.scored ?? 0, 'company', 'companies')}</span>
              </div>
            </div>
            <div className="space-y-2">
              {(['universe', 'fundamentals', 'scores'] as const).map((kind) => {
                const job = status.jobs[kind];
                const pct = job && job.total ? job.done / job.total : 0;
                return (
                  <div key={kind} className="rounded-sm border border-line bg-surface-2 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-ink">{JOB_LABEL[kind]}</span>
                      {job?.status === 'running' ? (
                        <span className="font-mono text-[10px] text-brand-soft">RUNNING</span>
                      ) : (
                        <Button size="xs" variant="ghost" onClick={() => void start(kind)}>
                          Run now
                        </Button>
                      )}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted">
                      {job?.status === 'running'
                        ? job.message ?? 'Starting…'
                        : job?.status === 'failed'
                          ? `Failed: ${job.error ?? 'unknown error'}`
                          : job?.finished_at
                            ? `Last run ${relativeTime(job.finished_at)}${job.message ? ` · ${job.message}` : ''}`
                            : 'Not run yet'}
                    </div>
                    {job?.status === 'running' ? (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <motion.div className="h-full rounded-full bg-brand" animate={{ width: `${Math.max(3, pct * 100)}%` }} transition={{ duration: 0.5 }} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              Prices refresh every 5 minutes while the US market is open; with a Finnhub key, the stocks on screen stream in real time. Fundamentals and scores rebuild weekly.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

type AlertEvent = { id: string; symbol: string; kind: string; message: string; created_at: string; read_at: string | null };

function AlertsBell() {
  const { data, mutate } = useSWR<{ events: AlertEvent[]; unread: number }>('/api/alerts/events', { refreshInterval: 45_000 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data) return;
    if (seen.current === null) {
      seen.current = new Set(data.events.map((event) => event.id));
      return;
    }
    for (const event of data.events) {
      if (!seen.current.has(event.id)) {
        seen.current.add(event.id);
        if (!event.read_at) toast(event.symbol, { description: event.message });
      }
    }
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      await api('/api/alerts/events', { body: {} });
      void mutate();
    }
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => void toggle()} className="relative grid size-7.5 place-items-center rounded-sm text-muted hover:bg-white/5 hover:text-ink" aria-label="Alerts">
        <Bell className="size-4" />
        {data?.unread ? (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-silver px-1 font-mono text-[9px] font-semibold text-[#0b0c0f] shadow-[0_0_10px_rgba(205,212,222,0.45)]">
            {data.unread}
          </span>
        ) : null}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="panel absolute top-full right-0 z-50 mt-2 w-80 bg-surface-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)]"
          >
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
              <span className="kicker">Alerts</span>
              <Link href="/watchlists?tab=alerts" className="text-[11.5px] text-brand-soft hover:underline" onClick={() => setOpen(false)}>
                Manage
              </Link>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {data?.events.length ? (
                data.events.map((event) => (
                  <Link
                    key={event.id}
                    href={`/company/${event.symbol}`}
                    onClick={() => setOpen(false)}
                    className="block border-b border-line px-3.5 py-2.5 last:border-0 hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <CompanyLogo symbol={event.symbol} size="xs" />
                        <span className="font-mono text-[11px] font-semibold text-ink">{event.symbol}</span>
                      </span>
                      <span className="text-[10.5px] text-faint">{relativeTime(event.created_at)}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] leading-snug text-ink-2">{event.message}</div>
                  </Link>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-[12px] text-muted">No alerts yet. Set price or score alerts from any company or watchlist.</div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function Topbar() {
  const { setPaletteOpen, setAssistantOpen } = useShell();
  const { status, refresh } = useStatus();
  return (
    <header className="sticky top-0 z-30 flex h-13 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md">
      <button
        onClick={() => setPaletteOpen(true)}
        className="group flex h-8 w-full max-w-md items-center gap-2 rounded-sm border border-line bg-surface-1 px-2.5 text-left text-[12.5px] text-faint transition-colors hover:border-line-strong hover:text-muted"
      >
        <Search className="size-3.5" />
        <span className="flex-1 truncate">Search tickers, watchlists, notes…</span>
        <span className="flex items-center gap-0.5">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-3">
        <IndexStrip />
        <MarketStatus open={status?.marketOpen} />
        <JobsIndicator status={status} refresh={() => void refresh()} />
        <AlertsBell />
        <IconButton label="Assistant" variant="outline" size="sm" onClick={() => setAssistantOpen(true)}>
          <Sparkles className="size-3.5 text-brand" />
        </IconButton>
      </div>
    </header>
  );
}

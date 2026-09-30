'use client';

import {
  BookCheck,
  Briefcase,
  CalendarDays,
  Globe,
  LayoutPanelLeft,
  Microscope,
  Compass,
  Eye,
  FlaskConical,
  GraduationCap,
  History,
  LayoutDashboard,
  Newspaper,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { BrandMark, Wordmark } from '@/components/shell/brand';
import { useKeepAliveLinks } from '@/components/shell/keep-alive';
import { useShell } from '@/components/shell/providers';
import { useStatus, type StatusPayload } from '@/components/shell/topbar';
import { CompanyLogo } from '@/components/ui/company-logo';
import { removeRecentStock, useRecentStocks } from '@/lib/recent-stocks';
import { cn } from '@/lib/utils';

export const NAV = [
  { group: 'Markets', items: [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/terminal', label: 'Terminal', icon: LayoutPanelLeft },
    { href: '/explorer', label: 'Explorer', icon: Compass },
    { href: '/macro', label: 'Macro', icon: Globe },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/news', label: 'News', icon: Newspaper },
  ] },
  { group: 'Positions', items: [
    { href: '/watchlists', label: 'Watchlists', icon: Eye },
    { href: '/portfolio', label: 'Portfolio', icon: Briefcase },
    { href: '/journal', label: 'Decision journal', icon: BookCheck },
    { href: '/simulations', label: 'Simulations', icon: FlaskConical },
    { href: '/backtest', label: 'Backtest', icon: History },
  ] },
  { group: 'Research', items: [
    { href: '/notes', label: 'Notes & theses', icon: NotebookPen },
    { href: '/pitches', label: 'Pitches', icon: Presentation },
    { href: '/lab', label: 'Research lab', icon: Microscope },
    { href: '/assistant', label: 'Grok', icon: Sparkles },
  ] },
  { group: 'Academy', items: [
    { href: '/learn', label: 'Learn', icon: GraduationCap },
  ] },
] as const;

/** Stocks opened this session, newest first. Each link returns to the exact view (tab included) and the deck restores its state. */
function RecentStocks({ collapsed }: { collapsed: boolean }) {
  const recent = useRecentStocks();
  const pathname = usePathname();
  const { close } = useKeepAliveLinks();
  if (!recent.length) return null;
  const current = pathname.match(/^\/company\/([^/?]+)/)?.[1]?.toUpperCase();
  return (
    <div className="mb-4">
      {!collapsed ? <div className="kicker mb-1.5 px-2.5 text-[9.5px]">Recent</div> : <div className="mx-auto mb-2 h-px w-6 bg-line" />}
      {recent.map((stock) => {
        const active = stock.symbol === current;
        return (
          <div key={stock.symbol} className="group/recent relative mb-0.5">
            <Link
              href={stock.href}
              title={collapsed ? `${stock.symbol} · ${stock.name}` : stock.name}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-sm text-[13px] transition-colors',
                collapsed ? 'justify-center px-0' : 'pr-7 pl-2.5',
                active ? 'bg-white/[0.05] text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-ink-2',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <CompanyLogo symbol={stock.symbol} size="xs" />
              {!collapsed ? <span className="truncate font-mono text-[12px] tracking-tight">{stock.symbol}</span> : null}
            </Link>
            {!collapsed && !active ? (
              <button
                onClick={() => {
                  close(`/company/${stock.symbol}`);
                  removeRecentStock(stock.symbol);
                }}
                className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-xs text-faint opacity-0 transition-opacity group-hover/recent:opacity-100 hover:bg-white/10 hover:text-ink focus-visible:opacity-100"
                aria-label={`Remove ${stock.symbol} from recent`}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** One-line data pipeline readout: syncing while a job runs, a warning when the last run failed (click to retry). */
function PipelineStatus({ status, refresh }: { status: StatusPayload; refresh: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const jobs = Object.values(status.jobs);
  const failed = jobs.filter((job) => job?.status === 'failed');
  const state = jobs.some((job) => job?.status === 'running') || retrying ? 'sync' : failed.length ? 'failed' : 'ok';
  const tone = state === 'failed' ? 'bg-warning' : state === 'sync' ? 'bg-ion' : 'bg-gain';
  const label = state === 'failed' ? 'Data job failed · retry' : state === 'sync' ? 'Syncing data' : 'Data pipeline online';
  const retry = async () => {
    setRetrying(true);
    try {
      await Promise.all(failed.map((job) => fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: job?.kind }) })));
      refresh();
    } finally {
      setRetrying(false);
    }
  };
  const dot = (
    <span className="relative flex size-1.5">
      <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60 [animation-duration:2.8s]', tone)} />
      <span className={cn('relative size-1.5 rounded-full', tone)} />
    </span>
  );
  const className = 'mx-4 mb-2 flex items-center gap-2 font-mono text-[9.5px] tracking-[0.16em] text-faint uppercase';
  if (state === 'failed') {
    return (
      <button
        onClick={retry}
        className={cn(className, 'text-left hover:text-ink-2')}
        title={failed.map((job) => `${job?.kind}: ${job?.error ?? 'failed'}`).join('\n')}
        role="status"
      >
        {dot}
        {label}
      </button>
    );
  }
  return (
    <div className={className} role="status">
      {dot}
      {label}
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
  user,
  drawer = false,
}: {
  collapsed: boolean;
  onToggle: () => void;
  user: { email: string | null; local: boolean };
  /** Narrow screens: slide-over navigation instead of the fixed rail. */
  drawer?: boolean;
}) {
  const pathname = usePathname();
  const { setAssistantOpen } = useShell();
  const { status, refresh } = useStatus();
  const { resolveHref } = useKeepAliveLinks();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <aside
      className={cn(
        drawer
          ? 'fixed inset-y-0 left-0 z-50 flex h-dvh w-[260px] flex-col border-r border-line bg-surface-1 shadow-[24px_0_60px_-20px_rgba(0,0,0,0.9)]'
          : 'sticky top-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface-1/80 backdrop-blur-xl transition-[width] duration-300 ease-[var(--ease-out-expo)] md:flex',
        // A faint vertical light along the sidebar's edge.
        'after:pointer-events-none after:absolute after:inset-y-0 after:-right-px after:w-px after:bg-gradient-to-b after:from-transparent after:via-ion/25 after:to-transparent',
        !drawer && (collapsed ? 'w-[60px]' : 'w-[214px]'),
      )}
    >
      <div className={cn('flex h-13 items-center gap-2.5 border-b border-line', collapsed ? 'justify-center px-0' : 'px-4')}>
        <Link href="/" className="group flex items-center gap-2.5" aria-label="SilverNote home">
          <span className="sheen rounded-[6px] shadow-[0_0_18px_-4px_rgba(205,212,222,0.45)]">
            <BrandMark size={24} />
          </span>
          {!collapsed ? <Wordmark /> : null}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((section) => (
          <div key={section.group} className="mb-4">
            {!collapsed ? <div className="kicker mb-1.5 px-2.5 text-[9.5px]">{section.group}</div> : <div className="mx-auto mb-2 h-px w-6 bg-line" />}
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  // Back to the URL you left this section on (its tab, selection, thread) while that page is still alive.
                  href={active ? item.href : resolveHref(item.href)}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'group/nav relative mb-0.5 flex h-8 items-center gap-2.5 rounded-sm text-[13px] transition-colors',
                    collapsed ? 'justify-center px-0' : 'px-2.5',
                    active ? 'text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-ink-2',
                  )}
                >
                  {active ? (
                    <>
                      <motion.span
                        layoutId="nav-active-bg"
                        className="absolute inset-0 rounded-sm border border-white/[0.06] bg-gradient-to-r from-ion/[0.09] via-white/[0.04] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      />
                      <motion.span
                        layoutId="nav-active"
                        className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-gradient-to-b from-white to-ion shadow-[0_0_10px_rgba(159,216,255,0.8),0_0_2px_#fff]"
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      />
                    </>
                  ) : null}
                  <Icon
                    className={cn(
                      'relative size-4 shrink-0 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover/nav:scale-110',
                      active && 'text-brand drop-shadow-[0_0_6px_rgba(159,216,255,0.6)]',
                    )}
                    strokeWidth={1.8}
                  />
                  {!collapsed ? <span className="relative truncate transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover/nav:translate-x-0.5">{item.label}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
        <RecentStocks collapsed={collapsed} />
      </nav>

      {!collapsed && status ? <PipelineStatus status={status} refresh={() => void refresh()} /> : null}
      <div className="border-t border-line p-2">
        <button
          onClick={() => setAssistantOpen(true)}
          disabled={pathname.startsWith('/assistant')}
          className={cn(
            'group/grok mb-1 flex h-8 w-full items-center gap-2.5 rounded-sm text-[12.5px] text-ink-2 transition-colors hover:bg-brand-wash hover:text-ink disabled:pointer-events-none disabled:opacity-40',
            collapsed ? 'justify-center' : 'px-2.5',
          )}
          title={pathname.startsWith('/assistant') ? 'Grok is open' : 'Ask Grok (⌘J)'}
        >
          <Sparkles className="size-4 text-brand transition-[transform,filter] duration-500 group-hover/grok:rotate-12 group-hover/grok:drop-shadow-[0_0_6px_rgba(159,216,255,0.8)]" strokeWidth={1.8} />
          {!collapsed ? (
            <>
              <span>Ask Grok</span>
              <span className="ml-auto font-mono text-[10px] text-faint">⌘J</span>
            </>
          ) : null}
        </button>
        <Link
          href="/settings"
          className={cn(
            'flex h-8 items-center gap-2.5 rounded-sm text-[12.5px] transition-colors',
            collapsed ? 'justify-center' : 'px-2.5',
            pathname.startsWith('/settings') ? 'bg-white/[0.05] text-ink' : 'text-muted hover:text-ink-2',
          )}
          title="Settings"
        >
          <Settings2 className="size-4" strokeWidth={1.8} />
          {!collapsed ? (
            <span className="min-w-0 flex-1 truncate">{user.local ? 'Settings · local' : (user.email ?? 'Settings')}</span>
          ) : null}
        </Link>
        <button
          onClick={onToggle}
          hidden={drawer}
          className={cn('mt-1 flex h-7 w-full items-center gap-2.5 rounded-sm text-[12px] text-faint hover:text-ink-2', collapsed ? 'justify-center' : 'px-2.5')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </aside>
  );
}

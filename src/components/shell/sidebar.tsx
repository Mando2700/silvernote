'use client';

import {
  Briefcase,
  Compass,
  Eye,
  FlaskConical,
  LayoutDashboard,
  Newspaper,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BrandMark, Wordmark } from '@/components/shell/brand';
import { useShell } from '@/components/shell/providers';
import { cn } from '@/lib/utils';

const NAV = [
  { group: 'Markets', items: [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/explorer', label: 'Explorer', icon: Compass },
    { href: '/news', label: 'News', icon: Newspaper },
  ] },
  { group: 'Positions', items: [
    { href: '/watchlists', label: 'Watchlists', icon: Eye },
    { href: '/portfolio', label: 'Portfolio', icon: Briefcase },
    { href: '/simulations', label: 'Simulations', icon: FlaskConical },
  ] },
  { group: 'Research', items: [
    { href: '/notes', label: 'Notes & theses', icon: NotebookPen },
    { href: '/pitches', label: 'Pitches', icon: Presentation },
    { href: '/assistant', label: 'Grok', icon: Sparkles },
  ] },
] as const;

export function Sidebar({ collapsed, onToggle, user }: { collapsed: boolean; onToggle: () => void; user: { email: string | null; local: boolean } }) {
  const pathname = usePathname();
  const { setAssistantOpen } = useShell();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <aside
      className={cn(
        'sticky top-0 z-40 flex h-dvh shrink-0 flex-col border-r border-line bg-surface-1/95 backdrop-blur transition-[width] duration-300 ease-[var(--ease-out-expo)]',
        collapsed ? 'w-[60px]' : 'w-[214px]',
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
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'relative mb-0.5 flex h-8 items-center gap-2.5 rounded-sm text-[13px] transition-colors',
                    collapsed ? 'justify-center px-0' : 'px-2.5',
                    active ? 'bg-white/[0.05] text-ink' : 'text-muted hover:bg-white/[0.03] hover:text-ink-2',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-brand shadow-[0_0_10px_rgba(205,212,222,0.54)]"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  ) : null}
                  <Icon className={cn('size-4 shrink-0', active && 'text-brand')} strokeWidth={1.8} />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-2">
        <button
          onClick={() => setAssistantOpen(true)}
          className={cn(
            'mb-1 flex h-8 w-full items-center gap-2.5 rounded-sm text-[12.5px] text-ink-2 transition-colors hover:bg-brand-wash hover:text-ink',
            collapsed ? 'justify-center' : 'px-2.5',
          )}
          title="Ask Grok (⌘J)"
        >
          <Sparkles className="size-4 text-brand" strokeWidth={1.8} />
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

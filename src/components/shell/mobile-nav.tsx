'use client';

import { Briefcase, Compass, Eye, LayoutDashboard, Menu } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useShell } from '@/components/shell/providers';
import { Sidebar } from '@/components/shell/sidebar';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/explorer', label: 'Explorer', icon: Compass },
  { href: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { href: '/watchlists', label: 'Watch', icon: Eye },
] as const;

/** Narrow screens: the sidebar becomes a slide-over drawer, and the main sections sit in a bottom tab bar. */
export function MobileNav({ user }: { user: { email: string | null; local: boolean } }) {
  const { navOpen, setNavOpen } = useShell();
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  return (
    <>
      <AnimatePresence>
        {navOpen ? (
          <>
            <motion.div
              key="backdrop"
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNavOpen(false)}
            />
            <motion.div key="drawer" className="md:hidden" initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', stiffness: 420, damping: 40 }}>
              <Sidebar collapsed={false} onToggle={() => setNavOpen(false)} user={user} drawer />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Main">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link key={tab.href} href={tab.href} className={cn('flex h-14 flex-col items-center justify-center gap-1 text-[10.5px]', isActive(tab.href) ? 'text-ink' : 'text-muted')}>
              <Icon className={cn('size-5', isActive(tab.href) && 'text-brand')} strokeWidth={1.8} />
              {tab.label}
            </Link>
          );
        })}
        <button onClick={() => setNavOpen(true)} className="flex h-14 flex-col items-center justify-center gap-1 text-[10.5px] text-muted" aria-label="All sections">
          <Menu className="size-5" strokeWidth={1.8} />
          More
        </button>
      </nav>
    </>
  );
}

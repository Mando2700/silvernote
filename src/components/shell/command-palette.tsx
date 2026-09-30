'use client';

import { Command } from 'cmdk';
import {
  Briefcase,
  Compass,
  Eye,
  FilePlus2,
  FlaskConical,
  GraduationCap,
  History,
  LayoutDashboard,
  Newspaper,
  NotebookPen,
  Presentation,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { useShell } from '@/components/shell/providers';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Kbd } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';
import { COMMAND_EXAMPLES, parseCommand, type ParsedCommand } from '@/lib/commands';
import { compactNumber, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';

type SearchResult = {
  securities: Array<{ symbol: string; name: string; sector: string | null; market_cap: number | null; change_pct: number | null }>;
  watchlists: Array<{ id: string; name: string }>;
  notes: Array<{ id: string; title: string; symbol: string | null }>;
  pitches: Array<{ id: string; title: string; symbol: string }>;
};

function useDebounced<T>(value: T, delay = 120) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const PAGES = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview heatmap' },
  { href: '/explorer', label: 'Market explorer', icon: Compass, keywords: 'screener screen filter universe sectors' },
  { href: '/watchlists', label: 'Watchlists', icon: Eye, keywords: 'alerts tags lists' },
  { href: '/portfolio', label: 'Portfolio', icon: Briefcase, keywords: 'holdings positions pnl risk' },
  { href: '/simulations', label: 'Simulations', icon: FlaskConical, keywords: 'monte carlo stress test what if' },
  { href: '/backtest', label: 'Backtest', icon: History, keywords: 'backtest strategy rules screen history quant' },
  { href: '/news', label: 'News & filings', icon: Newspaper, keywords: 'headlines sec 8-k' },
  { href: '/notes', label: 'Notes & theses', icon: NotebookPen, keywords: 'journal thesis workspace' },
  { href: '/pitches', label: 'Pitches', icon: Presentation, keywords: 'pitch deck export pdf slides' },
  { href: '/assistant', label: 'Grok assistant', icon: Sparkles, keywords: 'ai chat grok ask' },
  { href: '/learn', label: 'Learn', icon: GraduationCap, keywords: 'learn course lesson academy dcf wacc sharpe monte carlo lbo m&a quiz' },
  { href: '/learn/practice', label: 'Practice lab', icon: GraduationCap, keywords: 'learn drills practice problems paper lbo wacc exercises' },
  { href: '/learn/interview', label: 'Interview prep', icon: GraduationCap, keywords: 'learn interview technicals flashcards banking questions' },
  { href: '/learn/pitch', label: 'Pitch studio', icon: GraduationCap, keywords: 'learn pitch practice grade rating stock pitch' },
  { href: '/learn/examples', label: 'Case library', icon: GraduationCap, keywords: 'learn cases examples buffett burry ackman einhorn theses' },
  { href: '/settings', label: 'Settings', icon: Settings2, keywords: 'preferences keys data notifications density currency' },
  { href: '/terminal', label: 'Terminal layouts', icon: LayoutDashboard, keywords: 'terminal panels split layout multi launchpad' },
  { href: '/macro', label: 'Macro', icon: Compass, keywords: 'rates yield curve inflation cpi fred economy credit spreads' },
  { href: '/calendar', label: 'Calendar', icon: Newspaper, keywords: 'earnings dividends economic releases events fomc cpi' },
  { href: '/journal', label: 'Decision journal', icon: NotebookPen, keywords: 'journal calls predictions calibration' },
  { href: '/lab', label: 'Research lab', icon: FlaskConical, keywords: 'event study comps comparable companies excel export university' },
];

function Item({ children, onSelect, value, className }: { children: ReactNode; onSelect: () => void; value: string; className?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 text-[13px] text-ink-2 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink',
        className,
      )}
    >
      {children}
    </Command.Item>
  );
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setAssistantOpen, askAssistant } = useShell();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim());
  const { data, isLoading } = useSWR<SearchResult>(paletteOpen && debounced ? `/api/search?q=${encodeURIComponent(debounced)}` : null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setAssistantOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, setPaletteOpen, setAssistantOpen]);

  const [wasOpen, setWasOpen] = useState(paletteOpen);
  if (wasOpen !== paletteOpen) {
    setWasOpen(paletteOpen);
    if (!paletteOpen) setQuery('');
  }

  const go = (href: string) => {
    setPaletteOpen(false);
    startTransition(() => router.push(href));
  };

  const command = parseCommand(query);
  const run = async (parsed: ParsedCommand) => {
    if (parsed.kind === 'navigate') return go(parsed.href);
    setPaletteOpen(false);
    if (parsed.kind === 'ask') return askAssistant(parsed.prompt, parsed.symbol ? { type: 'company', symbol: parsed.symbol } : undefined);
    if (parsed.kind === 'alert') {
      await api('/api/alerts', { body: { symbol: parsed.symbol, kind: parsed.direction === 'above' ? 'price_above' : 'price_below', threshold: parsed.price } });
      await revalidate('/api/alerts');
      return toast.success(parsed.label);
    }
    const lists = await api<Array<{ id: string; name: string }>>('/api/watchlists');
    const target = parsed.list ? lists.find((list) => list.name.toLowerCase() === parsed.list?.toLowerCase()) : lists[0];
    if (!target) return toast.error(parsed.list ? `No watchlist named “${parsed.list}”.` : 'Create a watchlist first.');
    await api(`/api/watchlists/${target.id}/items`, { body: { symbol: parsed.symbol } });
    await revalidate('/api/watchlists', '/api/dashboard');
    toast.success(`${parsed.symbol} added to ${target.name}`);
  };

  const lower = query.trim().toLowerCase();
  const pages = PAGES.filter((page) => !lower || page.label.toLowerCase().includes(lower) || page.keywords.includes(lower));

  return (
    <AnimatePresence>
      {paletteOpen ? (
        <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[14vh]">
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={() => setPaletteOpen(false)}
          />
          <motion.div
            className="light-trail relative w-full max-w-xl rounded-lg"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 460, damping: 36 }}
          >
            <Command
              shouldFilter={false}
              loop
              label="Command palette"
              className="overflow-hidden rounded-lg border border-line-strong bg-surface-2 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.95)]"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setPaletteOpen(false);
              }}
            >
              <div className="flex items-center gap-2.5 border-b border-line px-3.5">
                <Search className="size-4 text-brand" />
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Ticker, page or command (NVDA FA, ECO, NVDA vs AMD)…"
                  className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
                />
                {isLoading ? <RefreshCw className="size-3.5 animate-spin text-muted" /> : <Kbd>esc</Kbd>}
              </div>
              <Command.List className="max-h-[56vh] overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-8 text-center text-[12.5px] text-muted">
                  {debounced ? 'No matches.' : 'Type a ticker or company name.'}
                </Command.Empty>

                {command ? (
                  <Command.Group heading="Command" className="[&_[cmdk-group-heading]]:kicker [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                    <Item value={`cmd-${query}`} onSelect={() => void run(command)}>
                      <SquareTerminal className="size-4 text-brand" />
                      <span className="min-w-0 flex-1 truncate text-ink">{command.label}</span>
                      <Kbd>↵</Kbd>
                    </Item>
                  </Command.Group>
                ) : null}

                {!query ? (
                  <Command.Group heading="Command line" className="[&_[cmdk-group-heading]]:kicker [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
                      {COMMAND_EXAMPLES.map((example) => (
                        <button key={example} type="button" onClick={() => setQuery(example)} className="rounded-xs border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-ink">
                          {example}
                        </button>
                      ))}
                    </div>
                  </Command.Group>
                ) : null}

                {data?.securities.length ? (
                  <Command.Group heading="Companies" className="[&_[cmdk-group-heading]]:kicker [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                    {data.securities.map((security) => (
                      <Item key={security.symbol} value={`sec-${security.symbol}`} onSelect={() => go(`/company/${security.symbol}`)}>
                        <CompanyLogo symbol={security.symbol} size="xs" />
                        <span className="w-12 font-mono text-[12px] font-semibold text-ink">{security.symbol}</span>
                        <span className="min-w-0 flex-1 truncate">{security.name}</span>
                        <span className="hidden text-[11px] text-faint sm:inline">{security.sector}</span>
                        <span className="num w-14 text-right text-[11px] text-muted">{compactNumber(security.market_cap)}</span>
                        <span className={cn('num w-14 text-right text-[11px]', (security.change_pct ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>
                          {signedPct(security.change_pct, 2, true)}
                        </span>
                      </Item>
                    ))}
                  </Command.Group>
                ) : null}

                {data?.watchlists.length ? (
                  <Command.Group heading="Watchlists" className="[&_[cmdk-group-heading]]:kicker [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                    {data.watchlists.map((list) => (
                      <Item key={list.id} value={`wl-${list.id}`} onSelect={() => go(`/watchlists?id=${list.id}`)}>
                        <Eye className="size-4 text-muted" />
                        {list.name}
                      </Item>
                    ))}
                  </Command.Group>
                ) : null}

                {data?.notes.length ? (
                  <Command.Group heading="Notes" className="[&_[cmdk-group-heading]]:kicker [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                    {data.notes.map((note) => (
                      <Item key={note.id} value={`note-${note.id}`} onSelect={() => go(`/notes?note=${note.id}`)}>
                        <NotebookPen className="size-4 text-muted" />
                        <span className="min-w-0 flex-1 truncate">{note.title || 'Untitled note'}</span>
                        {note.symbol ? <span className="font-mono text-[11px] text-faint">{note.symbol}</span> : null}
                      </Item>
                    ))}
                  </Command.Group>
                ) : null}

                {data?.pitches.length ? (
                  <Command.Group heading="Pitches" className="[&_[cmdk-group-heading]]:kicker [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                    {data.pitches.map((pitch) => (
                      <Item key={pitch.id} value={`pitch-${pitch.id}`} onSelect={() => go(`/pitches/${pitch.id}`)}>
                        <Presentation className="size-4 text-muted" />
                        <span className="min-w-0 flex-1 truncate">{pitch.title}</span>
                        <span className="font-mono text-[11px] text-faint">{pitch.symbol}</span>
                      </Item>
                    ))}
                  </Command.Group>
                ) : null}

                {pages.length ? (
                  <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:kicker [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                    {pages.map((page) => {
                      const Icon = page.icon;
                      return (
                        <Item key={page.href} value={`page-${page.href}`} onSelect={() => go(page.href)}>
                          <Icon className="size-4 text-muted" />
                          {page.label}
                        </Item>
                      );
                    })}
                  </Command.Group>
                ) : null}

                {!lower || 'new note refresh ask grok'.includes(lower) ? (
                  <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:kicker [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                    <Item value="action-note" onSelect={() => go('/notes?new=1')}>
                      <FilePlus2 className="size-4 text-muted" />
                      New note
                    </Item>
                    <Item
                      value="action-grok"
                      onSelect={() => {
                        setPaletteOpen(false);
                        setAssistantOpen(true);
                      }}
                    >
                      <Sparkles className="size-4 text-brand" />
                      Ask Grok
                      <span className="ml-auto flex gap-0.5">
                        <Kbd>⌘</Kbd>
                        <Kbd>J</Kbd>
                      </span>
                    </Item>
                    <Item
                      value="action-refresh"
                      onSelect={async () => {
                        setPaletteOpen(false);
                        await api('/api/jobs', { body: { kind: 'universe' } });
                        toast.success('Refreshing the market snapshot');
                      }}
                    >
                      <RefreshCw className="size-4 text-muted" />
                      Refresh market data now
                    </Item>
                  </Command.Group>
                ) : null}
              </Command.List>
              <div className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[10.5px] text-faint">
                <span className="flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> navigate <Kbd>↵</Kbd> open
                </span>
                <span className="font-mono tracking-wider">SILVERNOTE</span>
              </div>
            </Command>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

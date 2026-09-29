'use client';

import { ArrowUpRight, Briefcase, Eye, FileText, Newspaper, Search, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { useShell } from '@/components/shell/providers';
import { Page } from '@/components/shell/page';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, EmptyState, Input, Panel, PanelHeader, Skeleton, Tabs } from '@/components/ui/primitives';
import type { Filing, NewsItem } from '@/lib/data/types';
import { relativeTime, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSearchParams } from '@/components/shell/keep-alive';

type Scope = 'mine' | 'market' | 'filings';
type UserSymbol = { symbol: string; name: string | null; held: boolean; watched: boolean };
type FilingItem = Filing & { symbol: string; name: string | null };
type NewsResponse = { scope: Scope; items?: NewsItem[]; filings?: FilingItem[]; symbols?: UserSymbol[] };

const FORM_NOTES: Array<{ form: string; text: string }> = [
  { form: '10-K / 20-F', text: 'Annual report: audited statements, risk factors, strategy.' },
  { form: '10-Q / 6-K', text: 'Quarterly report (6-K for many foreign filers).' },
  { form: '8-K', text: 'Material events: results, deals, leadership changes, guidance.' },
  { form: 'DEF 14A', text: 'Proxy: pay, board, shareholder votes.' },
  { form: 'S-1', text: 'Registration for new share issuance.' },
];

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function groupByDay<T>(items: T[], at: (item: T) => string) {
  const groups: Array<{ label: string; items: T[] }> = [];
  for (const item of items) {
    const label = dayLabel(at(item));
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function News() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get('tab');
  const [scope, setScope] = useState<Scope>(initial === 'market' || initial === 'filings' ? initial : 'mine');
  const [symbol, setSymbol] = useState<string | null>(params.get('symbol'));
  const [query, setQuery] = useState('');
  const { askAssistant } = useShell();
  const { data, isLoading } = useSWR<NewsResponse>(`/api/news?scope=${scope}`, { refreshInterval: 5 * 60_000 });

  const changeScope = (next: Scope) => {
    setScope(next);
    setSymbol(null);
    router.replace(next === 'mine' ? '/news' : `/news?tab=${next}`, { scroll: false });
  };

  const needle = query.trim().toLowerCase();
  const items = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) => (!symbol || item.symbols.includes(symbol)) && (!needle || item.title.toLowerCase().includes(needle) || item.summary?.toLowerCase().includes(needle)),
      ),
    [data?.items, symbol, needle],
  );
  const filings = useMemo(
    () =>
      (data?.filings ?? []).filter(
        (filing) => (!symbol || filing.symbol === symbol) && (!needle || `${filing.form} ${filing.description ?? ''} ${filing.name ?? ''}`.toLowerCase().includes(needle)),
      ),
    [data?.filings, symbol, needle],
  );

  // Symbols most mentioned in the current headlines (for the market tab's sidebar).
  const mentions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.items ?? []) for (const tagged of item.symbols) counts.set(tagged, (counts.get(tagged) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [data?.items]);

  const followed = data?.symbols ?? [];
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of data?.items ?? []) for (const tagged of item.symbols) map.set(tagged, (map.get(tagged) ?? 0) + 1);
    for (const filing of data?.filings ?? []) map.set(filing.symbol, (map.get(filing.symbol) ?? 0) + 1);
    return map;
  }, [data?.items, data?.filings]);

  const brief = () =>
    askAssistant(
      scope === 'market'
        ? 'Brief me on today’s market headlines: the three to five stories that matter most, why they matter, and which sectors or companies they touch.'
        : 'Brief me on the latest headlines for the companies I hold and watch: what happened, why it matters for each position, and what I should watch next. Lead with anything that could change a thesis.',
      { type: 'general' },
    );

  return (
    <Page
      kicker="Headlines · SEC filings"
      title="News"
      description="Headlines for the companies you hold and watch, the wider market, and fresh filings from SEC EDGAR."
      actions={
        <Magnetic>
          <Button variant="primary" icon={<Sparkles className="size-3.5" />} onClick={brief}>
            Brief me
          </Button>
        </Magnetic>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <Tabs
          value={scope}
          onChange={changeScope}
          tabs={[
            { value: 'mine', label: 'My universe' },
            { value: 'market', label: 'Market' },
            { value: 'filings', label: 'SEC filings' },
          ]}
        />
        <div className="relative mb-1.5 w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scope === 'filings' ? 'Filter filings…' : 'Filter headlines…'} className="h-7.5 pl-8" />
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel className="overflow-hidden">
          <AnimatePresence initial={false}>
            {symbol ? (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-line">
                <div className="flex items-center gap-2 px-4 py-2 text-[12px] text-muted">
                  <CompanyLogo symbol={symbol} size="xs" />
                  Showing <span className="font-mono font-semibold text-ink">{symbol}</span>
                  <Link href={`/company/${symbol}`} className="text-brand-soft hover:underline">
                    Open company
                  </Link>
                  <button type="button" onClick={() => setSymbol(null)} className="ml-auto flex items-center gap-1 rounded-xs px-1.5 py-0.5 hover:bg-white/5 hover:text-ink" aria-label="Clear symbol filter">
                    <X className="size-3" /> Clear
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {isLoading && !data ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-14" />
              ))}
            </div>
          ) : scope === 'filings' ? (
            filings.length ? (
              <FilingsList filings={filings} onSymbol={setSymbol} onSummarize={(filing) => askAssistant(`Summarize this ${filing.form} for ${filing.name ?? filing.symbol}: what changed, what surprised, and what to watch.\n[filing:${filing.url}]`, { type: 'company', symbol: filing.symbol, name: filing.name ?? undefined })} />
            ) : (
              <EmptyFor scope={scope} hasSymbols={followed.length > 0} filtered={Boolean(symbol || needle)} />
            )
          ) : items.length ? (
            <HeadlineList items={items} active={symbol} onSymbol={setSymbol} />
          ) : (
            <EmptyFor scope={scope} hasSymbols={followed.length > 0} filtered={Boolean(symbol || needle)} />
          )}
        </Panel>

        <div className="flex flex-col gap-4 lg:sticky lg:top-16">
          {scope === 'market' ? (
            <Panel>
              <PanelHeader kicker="In the headlines" title="Most mentioned" />
              {mentions.length ? (
                <div className="flex flex-col pb-2">
                  {mentions.map(([tagged, count]) => (
                    <SymbolRow key={tagged} symbol={tagged} active={symbol === tagged} count={count} onClick={() => setSymbol(symbol === tagged ? null : tagged)} />
                  ))}
                </div>
              ) : (
                <div className="px-4 pb-4 text-[12px] text-muted">No tagged companies in the current headlines.</div>
              )}
            </Panel>
          ) : (
            <Panel>
              <PanelHeader kicker="Following" title={`${followed.length} ${followed.length === 1 ? 'company' : 'companies'}`} />
              {followed.length ? (
                <div className="flex max-h-[60vh] flex-col overflow-y-auto pb-2">
                  {followed.map((entry) => (
                    <SymbolRow
                      key={entry.symbol}
                      symbol={entry.symbol}
                      name={entry.name}
                      held={entry.held}
                      active={symbol === entry.symbol}
                      count={counts.get(entry.symbol) ?? 0}
                      onClick={() => setSymbol(symbol === entry.symbol ? null : entry.symbol)}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-4 pb-4 text-[12px] leading-relaxed text-muted">
                  Companies in your <Link href="/watchlists" className="text-brand-soft hover:underline">watchlists</Link> and{' '}
                  <Link href="/portfolio" className="text-brand-soft hover:underline">portfolio</Link> appear here.
                </div>
              )}
            </Panel>
          )}
          {scope === 'filings' ? (
            <Panel>
              <PanelHeader kicker="Reading the forms" title="What each filing is" />
              <div className="flex flex-col gap-2 px-4 pb-4">
                {FORM_NOTES.map((note) => (
                  <div key={note.form} className="grid grid-cols-[76px_1fr] gap-2 text-[11.5px]">
                    <span className="font-mono text-ink-2">{note.form}</span>
                    <span className="text-muted">{note.text}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

function SymbolRow({ symbol, name, held, count, active, onClick }: { symbol: string; name?: string | null; held?: boolean; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex items-center gap-2.5 px-4 py-1.5 text-left transition-colors', active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]')}
    >
      <CompanyLogo symbol={symbol} size="sm" />
      <span className="w-12 shrink-0 font-mono text-[12px] font-semibold text-ink">{symbol}</span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{name ?? ''}</span>
      {held ? <Briefcase className="size-3 shrink-0 text-brand-soft" aria-label="Held" /> : name !== undefined ? <Eye className="size-3 shrink-0 text-faint" aria-label="Watched" /> : null}
      <span className="num w-6 text-right text-[11px] text-faint">{count || ''}</span>
    </button>
  );
}

function HeadlineList({ items, active, onSymbol }: { items: NewsItem[]; active: string | null; onSymbol: (symbol: string) => void }) {
  const groups = groupByDay(items, (item) => item.publishedAt);
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="sticky top-0 z-10 border-b border-line bg-surface-2/95 px-4 py-1.5 backdrop-blur">
            <span className="kicker">{group.label}</span>
          </div>
          {group.items.map((item, index) => {
            const lead = item.symbols[0];
            return (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 10) * 0.02 }}
                className="group flex gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-white/[0.02]"
              >
                <div className="pt-0.5">{lead ? <CompanyLogo symbol={lead} size="md" /> : <span className="grid size-7 place-items-center rounded-[7px] border border-white/10 bg-surface-4"><Newspaper className="size-3.5 text-faint" /></span>}</div>
                <div className="min-w-0 flex-1">
                  <a href={item.url} target="_blank" rel="noreferrer" className="flex items-start gap-2">
                    <span className="text-[13.5px] leading-snug font-medium text-ink-2 group-hover:text-ink">{item.title}</span>
                    <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                  {item.summary ? <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{item.summary}</p> : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                    <span className="text-muted">{item.source}</span>
                    <span>·</span>
                    <time dateTime={item.publishedAt}>{relativeTime(item.publishedAt)}</time>
                    {item.symbols.slice(0, 6).map((tagged) => (
                      <button
                        key={tagged}
                        type="button"
                        onClick={() => onSymbol(tagged)}
                        className={cn('rounded-[3px] border px-1 font-mono text-[10px] transition-colors', active === tagged ? 'border-brand/50 text-ink' : 'border-line text-muted hover:border-line-strong hover:text-ink-2')}
                      >
                        {tagged}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function FilingsList({ filings, onSymbol, onSummarize }: { filings: FilingItem[]; onSymbol: (symbol: string) => void; onSummarize: (filing: FilingItem) => void }) {
  const groups = groupByDay(filings, (filing) => `${filing.filedAt}T12:00:00`);
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="sticky top-0 z-10 border-b border-line bg-surface-2/95 px-4 py-1.5 backdrop-blur">
            <span className="kicker">{group.label}</span>
          </div>
          {group.items.map((filing) => (
            <div key={`${filing.symbol}-${filing.accession}`} className="group flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-white/[0.02]">
              <CompanyLogo symbol={filing.symbol} size="md" />
              <button type="button" onClick={() => onSymbol(filing.symbol)} className="w-14 shrink-0 text-left font-mono text-[12px] font-semibold text-ink hover:text-white">
                {filing.symbol}
              </button>
              <Badge tone={/^(10-K|20-F|40-F)/.test(filing.form) ? 'brand' : 'neutral'} className="w-16 justify-center">
                {filing.form}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-ink-2">{filing.description || filing.name || filing.form}</div>
                <div className="text-[11px] text-faint">
                  Filed {shortDate(filing.filedAt)}
                  {filing.reportDate ? ` · period ${shortDate(filing.reportDate)}` : ''}
                </div>
              </div>
              <Button size="xs" variant="ghost" icon={<Sparkles className="size-3 text-brand" />} onClick={() => onSummarize(filing)}>
                Summarize
              </Button>
              <a href={filing.url} target="_blank" rel="noreferrer" className="grid size-6 place-items-center rounded-xs text-faint hover:bg-white/5 hover:text-ink" aria-label="Open on SEC.gov">
                <FileText className="size-3.5" />
              </a>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyFor({ scope, hasSymbols, filtered }: { scope: Scope; hasSymbols: boolean; filtered: boolean }) {
  if (filtered) return <EmptyState className="m-4" title="Nothing matches" body="Clear the filter or pick another company." />;
  if (scope !== 'market' && !hasSymbols) {
    return (
      <EmptyState
        className="m-4"
        icon={<Eye className="size-4" />}
        title="Follow some companies first"
        body="Add names to a watchlist or record trades in a portfolio — their headlines and filings collect here."
        action={
          <Link href="/explorer">
            <Button variant="outline">Find companies</Button>
          </Link>
        }
      />
    );
  }
  return <EmptyState className="m-4" icon={<Newspaper className="size-4" />} title={scope === 'filings' ? 'No filings in the last 45 days' : 'No headlines right now'} body="Sources refresh every few minutes." />;
}

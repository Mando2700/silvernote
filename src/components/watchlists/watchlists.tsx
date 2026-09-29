'use client';

import { Bell, Columns3, Eye, MoreHorizontal, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, ViewTransition } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { AlertButton } from '@/components/company/actions';
import { METRIC_BY_KEY, METRIC_COLUMNS, type MetricKey } from '@/components/explorer/columns';
import { Delta } from '@/components/motion/delta';
import { ExtendedMove } from '@/components/motion/extended-move';
import { ScoreRing } from '@/components/motion/score-ring';
import { Page } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Menu, Modal } from '@/components/ui/overlay';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Skeleton, Switch } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { api, revalidate } from '@/lib/client';
import { useColumnDrag } from '@/lib/column-drag';
import { useExtendedQuotes } from '@/lib/extended-client';
import { price, relativeTime, signedPct } from '@/lib/format';
import { useLivePrices } from '@/lib/live-client';
import { cn } from '@/lib/utils';
import { useSearchParams } from '@/components/shell/keep-alive';

type ListSummary = { id: string; name: string; description: string | null; count: number; columns: string[] };
type Item = {
  symbol: string;
  name: string;
  sector: string | null;
  tags: string[];
  note: string | null;
  added_price: number | null;
  added_at: string;
  sinceAdded: number | null;
  alerts: number;
  metrics: (Record<MetricKey, number | null> & { scoreLabel: string | null }) | null;
};
type ListDetail = { id: string; name: string; description: string | null; columns: string[]; items: Item[] };
type AlertRow = { id: string; symbol: string; kind: string; threshold: number; active: boolean; triggered_at: string | null; created_at: string };
type EventRow = { id: string; symbol: string; message: string; created_at: string };

const ALWAYS_COLUMNS = ['price', 'changePct'];
const EXTRA_COLUMNS = [{ key: 'sinceAdded', label: 'Since added' }] as const;
const KIND_LABEL: Record<string, string> = {
  price_above: 'Price above',
  price_below: 'Price below',
  change_pct: 'Daily move ≥',
  score_above: 'Score rises to',
  score_below: 'Score falls to',
  score_change: 'Score moves by',
};

function TagEditor({ tags, onSave }: { tags: string[]; onSave: (tags: string[]) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span key={tag} className="flex h-5 items-center gap-0.5 rounded-xs bg-white/[0.06] pr-0.5 pl-1.5 text-[10.5px] text-ink-2">
          {tag}
          <button onClick={() => onSave(tags.filter((item) => item !== tag))} className="rounded-[2px] p-0.5 text-faint hover:text-ink" aria-label={`Remove tag ${tag}`}>
            <X className="size-2.5" />
          </button>
        </span>
      ))}
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim()) {
            onSave([...new Set([...tags, value.trim().toLowerCase()])].slice(0, 10));
            setValue('');
          }
        }}
        onClick={(event) => event.stopPropagation()}
        placeholder="+ tag"
        className="h-5 w-14 bg-transparent text-[10.5px] text-ink-2 outline-none placeholder:text-faint focus:w-24"
      />
    </div>
  );
}

function AlertsView() {
  const { data: alerts, mutate } = useSWR<AlertRow[]>('/api/alerts');
  const { data: events } = useSWR<{ events: EventRow[] }>('/api/alerts/events');
  return (
    <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
      <Panel>
        <PanelHeader kicker="Price & score alerts" title="All alerts" />
        {alerts?.length ? (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-y border-line bg-surface-1 text-left text-muted">
                <th className="px-4 py-2 font-medium">Ticker</th>
                <th className="px-3 py-2 font-medium">Condition</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id} className="border-b border-line">
                  <td className="px-4 py-2">
                    <Link href={`/company/${alert.symbol}`} className="flex items-center gap-2 font-mono text-[12px] font-semibold text-ink hover:text-white">
                      <CompanyLogo symbol={alert.symbol} size="xs" />
                      {alert.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-2">
                    {KIND_LABEL[alert.kind]} <span className="num text-ink">{alert.threshold}{alert.kind === 'change_pct' ? '%' : ''}</span>
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-muted">{alert.triggered_at ? `Fired ${relativeTime(alert.triggered_at)}` : 'Watching'}</td>
                  <td className="px-3 py-2">
                    <Switch
                      checked={alert.active}
                      label="Alert active"
                      onChange={async (value) => {
                        await api(`/api/alerts/${alert.id}`, { method: 'PATCH', body: { active: value } });
                        void mutate();
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={async () => {
                        await api(`/api/alerts/${alert.id}`, { method: 'DELETE' });
                        void mutate();
                      }}
                      className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink"
                      aria-label="Delete alert"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<Bell className="size-4" />} title="No alerts yet" body="Set alerts from a company page or a watchlist row. Price alerts fire once; score alerts re-arm." />
        )}
      </Panel>
      <Panel>
        <PanelHeader kicker="History" title="Recent triggers" />
        {events?.events.length ? (
          <div className="flex flex-col">
            {events.events.map((event) => (
              <Link key={event.id} href={`/company/${event.symbol}`} className="border-t border-line px-4 py-2.5 hover:bg-white/[0.025]">
                <div className="flex justify-between text-[11px]">
                  <span className="font-mono font-semibold text-ink">{event.symbol}</span>
                  <span className="text-faint">{relativeTime(event.created_at)}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-ink-2">{event.message}</div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-4 pb-6 text-[12px] text-muted">Nothing has fired yet.</div>
        )}
      </Panel>
    </div>
  );
}

export function Watchlists() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: lists, mutate: refreshLists, isLoading } = useSWR<ListSummary[]>('/api/watchlists');
  const selectedId = params.get('id') ?? lists?.[0]?.id ?? null;
  const tab = params.get('tab') === 'alerts' ? 'alerts' : 'lists';
  const { data: detail, mutate: refreshDetail } = useSWR<ListDetail>(selectedId && tab === 'lists' ? `/api/watchlists/${selectedId}` : null, { refreshInterval: 60_000 });
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [tagChoice, setTagChoice] = useState<{ list: string | null; tag: string | null }>({ list: null, tag: null });
  const tagFilter = tagChoice.list === selectedId ? tagChoice.tag : null;
  const setTagFilter = (tag: string | null) => setTagChoice({ list: selectedId, tag });

  const savedColumns = (detail?.columns ?? []).filter((key) => key === 'sinceAdded' || key in METRIC_BY_KEY);
  // Price and Day always show; lists saved before they could be reordered start with them first.
  const columns = [...ALWAYS_COLUMNS.filter((key) => !savedColumns.includes(key)), ...savedColumns];
  const allTags = useMemo(() => [...new Set((detail?.items ?? []).flatMap((item) => item.tags))].sort(), [detail]);
  const items = (detail?.items ?? []).filter((item) => !tagFilter || item.tags.includes(tagFilter));
  const symbols = useMemo(() => (detail?.items ?? []).map((item) => item.symbol), [detail]);
  const live = useLivePrices(symbols);
  const extended = useExtendedQuotes(symbols);

  const go = (next: { id?: string | null; tab?: string }) => {
    const search = new URLSearchParams();
    if (next.tab === 'alerts') search.set('tab', 'alerts');
    else if (next.id) search.set('id', next.id);
    router.replace(`/watchlists${search.size ? `?${search}` : ''}`, { scroll: false });
  };

  const createList = async () => {
    if (!name.trim()) return;
    const list = await api<{ id: string }>('/api/watchlists', { body: { name: name.trim() } });
    setCreating(false);
    setName('');
    await refreshLists();
    go({ id: list.id });
  };

  const addSymbol = async (symbol: string) => {
    if (!selectedId) return;
    try {
      await api(`/api/watchlists/${selectedId}/items`, { body: { symbol } });
      toast.success(`${symbol} added`);
      void refreshDetail();
      void refreshLists();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const setColumns = async (next: string[]) => {
    if (!selectedId) return;
    if (detail) void refreshDetail({ ...detail, columns: next }, { revalidate: false });
    await api(`/api/watchlists/${selectedId}`, { method: 'PATCH', body: { columns: next } });
    void refreshDetail();
  };

  const columnDrag = useColumnDrag(columns, (next) => void setColumns(next));

  return (
    <Page
      kicker="Track ideas before they become positions"
      title="Watchlists"
      actions={
        <Segmented
          value={tab}
          onChange={(value) => go({ tab: value, id: selectedId })}
          options={[
            { value: 'lists', label: 'Lists' },
            { value: 'alerts', label: 'Alerts' },
          ]}
        />
      }
    >
      {tab === 'alerts' ? (
        <AlertsView />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
          <Panel className="self-start p-2">
            {isLoading && !lists ? <Skeleton className="h-24" /> : null}
            {lists?.map((list) => (
              <button
                key={list.id}
                onClick={() => go({ id: list.id })}
                className={cn('relative flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-left transition-colors', list.id === selectedId ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]')}
              >
                {list.id === selectedId ? <motion.span layoutId="wl-active" className="absolute top-2 bottom-2 left-0 w-[2px] rounded-full bg-brand" /> : null}
                <span className={cn('truncate text-[12.5px]', list.id === selectedId ? 'text-ink' : 'text-ink-2')}>{list.name}</span>
                <span className="num text-[11px] text-faint">{list.count}</span>
              </button>
            ))}
            <Button className="mt-1 w-full" size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
              New watchlist
            </Button>
          </Panel>

          {!lists?.length && !isLoading ? (
            <Panel>
              <EmptyState icon={<Eye className="size-4" />} title="Create your first watchlist" body="Group ideas by theme, add tags and notes, choose the columns you care about, and set alerts on price or SilverNote Score changes." action={<Button variant="primary" onClick={() => setCreating(true)}>New watchlist</Button>} />
            </Panel>
          ) : (
            <Panel className="min-w-0">
              <PanelHeader
                kicker={detail ? `${detail.items.length} companies` : 'Loading…'}
                title={detail?.name ?? ''}
                actions={
                  <>
                    <Menu
                      trigger={({ toggle }) => (
                        <Button size="sm" variant="outline" icon={<Columns3 className="size-3.5" />} onClick={toggle}>
                          Columns
                        </Button>
                      )}
                      items={[...EXTRA_COLUMNS, ...METRIC_COLUMNS.filter((column) => !['price', 'changePct'].includes(column.key))].map((column) => ({
                        label: column.label,
                        icon: <span className={cn('size-3.5 rounded-[3px] border', columns.includes(column.key) ? 'border-brand bg-brand' : 'border-line-strong')} />,
                        onSelect: () => void setColumns(columns.includes(column.key) ? columns.filter((key) => key !== column.key) : [...columns, column.key]),
                      }))}
                    />
                    <Menu
                      trigger={({ toggle }) => (
                        <Button size="sm" variant="ghost" icon={<MoreHorizontal className="size-4" />} onClick={toggle} aria-label="List options" />
                      )}
                      items={[
                        {
                          label: 'Rename',
                          icon: <Pencil className="size-3.5" />,
                          onSelect: () => {
                            setName(detail?.name ?? '');
                            setRenaming(true);
                          },
                        },
                        {
                          label: 'Delete watchlist',
                          icon: <Trash2 className="size-3.5" />,
                          danger: true,
                          onSelect: async () => {
                            if (!selectedId || !window.confirm(`Delete “${detail?.name}”? Its items are removed too.`)) return;
                            await api(`/api/watchlists/${selectedId}`, { method: 'DELETE' });
                            await refreshLists();
                            go({ id: null });
                          },
                        },
                      ]}
                    />
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                <TickerSearch onPick={(symbol) => void addSymbol(symbol)} className="w-72" />
                {allTags.length ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <Tag className="size-3.5 text-faint" />
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                        className={cn('h-6 rounded-xs border px-2 text-[11px]', tagFilter === tag ? 'border-brand/60 bg-brand-wash text-ink' : 'border-line text-muted hover:text-ink-2')}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {detail && !detail.items.length ? (
                <EmptyState title="This list is empty" body="Search for a ticker above, or use Watch on any company page." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-[12.5px]">
                    <thead>
                      <tr className="border-y border-line bg-surface-1 text-left text-[11px] text-muted">
                        <th className="px-4 py-2 font-medium">Company</th>
                        {columnDrag.order.map((key) => (
                          <th
                            key={key}
                            {...columnDrag.headerProps(key)}
                            title="Drag to reorder"
                            className={cn('cursor-grab px-3 py-2 text-right font-medium whitespace-nowrap select-none active:cursor-grabbing', columnDrag.dragged === key && 'opacity-40')}
                          >
                            {key === 'sinceAdded' ? 'Since added' : key === 'changePct' ? 'Day' : METRIC_BY_KEY[key as MetricKey].short ?? METRIC_BY_KEY[key as MetricKey].label}
                          </th>
                        ))}
                        <th className="px-3 py-2 font-medium">Tags</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence initial={false}>
                        {items.map((item) => (
                          <motion.tr
                            key={item.symbol}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => router.push(`/company/${item.symbol}`)}
                            className="group cursor-pointer border-b border-line hover:bg-white/[0.025]"
                          >
                            <td className="px-4 py-2">
                              <ViewTransition name={`company-${item.symbol}`} share="morph" default="none">
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <CompanyLogo symbol={item.symbol} size="sm" />
                                  <span className="w-12 shrink-0 font-mono text-[12px] font-semibold text-ink group-hover:text-white">{item.symbol}</span>
                                  <span className="max-w-52 truncate text-[11.5px] text-muted">{item.name}</span>
                                </div>
                              </ViewTransition>
                              {item.note ? <div className="mt-0.5 max-w-72 truncate text-[11px] text-faint">{item.note}</div> : null}
                            </td>
                            {columnDrag.order.map((key) => {
                              if (key === 'price') {
                                const quote = extended[item.symbol];
                                return (
                                  <td key={key} className="num px-3 py-2 text-right text-ink">
                                    <div className="flex flex-col items-end gap-0.5">
                                      {/* Outside regular hours the live feed carries extended trades, so the regular close comes from the extended quote. */}
                                      <span>{price(quote?.close ?? live[item.symbol]?.price ?? item.metrics?.price)}</span>
                                      <ExtendedMove quote={quote} />
                                    </div>
                                  </td>
                                );
                              }
                              if (key === 'changePct') {
                                const quote = extended[item.symbol];
                                return (
                                  <td key={key} className="px-3 py-2 text-right">
                                    <Delta value={quote ? quote.closeChangePct : (live[item.symbol]?.changePct ?? item.metrics?.changePct)} alreadyPercent className="justify-end text-[12px]" />
                                  </td>
                                );
                              }
                              if (key === 'sinceAdded') {
                                return (
                                  <td key={key} className="px-3 py-2 text-right" title={item.added_price ? `Added at $${price(item.added_price)} ${relativeTime(item.added_at)}` : undefined}>
                                    <Delta value={item.sinceAdded} className="justify-end text-[12px]" digits={1} />
                                  </td>
                                );
                              }
                              const column = METRIC_BY_KEY[key as MetricKey];
                              const value = item.metrics?.[key as MetricKey];
                              if (key === 'score') {
                                return (
                                  <td key={key} className="px-3 py-2">
                                    <div className="flex justify-end">{typeof value === 'number' ? <ScoreRing score={value} size="xs" /> : <span className="text-faint">—</span>}</div>
                                  </td>
                                );
                              }
                              return (
                                <td key={key} className="num px-3 py-2 text-right text-ink-2">
                                  {typeof value === 'number' ? column.format(value) : <span className="text-faint">—</span>}
                                </td>
                              );
                            })}
                            <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                              <TagEditor
                                tags={item.tags}
                                onSave={async (tags) => {
                                  await api(`/api/watchlists/${selectedId}/items`, { method: 'PATCH', body: { symbol: item.symbol, tags } });
                                  void refreshDetail();
                                }}
                              />
                            </td>
                            <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                                {item.alerts ? <Badge tone="brand">{item.alerts} alert{item.alerts > 1 ? 's' : ''}</Badge> : null}
                                <AlertButton symbol={item.symbol} price={item.metrics?.price ?? null} score={item.metrics?.score ?? null} />
                                <Menu
                                  trigger={({ toggle }) => (
                                    <button onClick={toggle} className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink" aria-label="Row options">
                                      <MoreHorizontal className="size-4" />
                                    </button>
                                  )}
                                  items={[
                                    {
                                      label: 'Edit note',
                                      icon: <Pencil className="size-3.5" />,
                                      onSelect: async () => {
                                        const note = window.prompt(`Note for ${item.symbol}`, item.note ?? '');
                                        if (note === null) return;
                                        await api(`/api/watchlists/${selectedId}/items`, { method: 'PATCH', body: { symbol: item.symbol, note: note || null } });
                                        void refreshDetail();
                                      },
                                    },
                                    {
                                      label: 'Remove from list',
                                      icon: <Trash2 className="size-3.5" />,
                                      danger: true,
                                      onSelect: async () => {
                                        await api(`/api/watchlists/${selectedId}/items?symbol=${item.symbol}`, { method: 'DELETE' });
                                        void refreshDetail();
                                        void refreshLists();
                                        void revalidate('/api/dashboard');
                                      },
                                    },
                                  ]}
                                />
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              )}
              {detail?.items.length ? (
                <div className="flex justify-between px-4 py-2.5 text-[11px] text-faint">
                  <span>
                    Average since added:{' '}
                    {signedPct(
                      (() => {
                        const values = detail.items.map((item) => item.sinceAdded).filter((value): value is number => typeof value === 'number');
                        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
                      })(),
                      1,
                    )}
                  </span>
                  <span>Prices from the latest market snapshot</span>
                </div>
              ) : null}
            </Panel>
          )}
        </div>
      )}

      <Modal
        open={creating || renaming}
        onClose={() => {
          setCreating(false);
          setRenaming(false);
        }}
        title={renaming ? 'Rename watchlist' : 'New watchlist'}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              if (renaming && selectedId) {
                await api(`/api/watchlists/${selectedId}`, { method: 'PATCH', body: { name: name.trim() } });
                setRenaming(false);
                void refreshLists();
                void refreshDetail();
              } else {
                await createList();
              }
            }}
          >
            {renaming ? 'Save' : 'Create'}
          </Button>
        }
      >
        <Field label="Name">
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. AI infrastructure, Turnarounds" />
        </Field>
      </Modal>
    </Page>
  );
}

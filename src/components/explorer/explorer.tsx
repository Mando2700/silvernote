'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Bookmark, ChevronLeft, ChevronRight, Columns3, Download, Filter as FilterIcon, LayoutGrid, Plus, RotateCcw, Save, Search, Table2, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useMemo, useRef, useState, ViewTransition } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { MarketHeatmap } from '@/components/charts/market-heatmap';
import { ExtendedMove } from '@/components/motion/extended-move';
import { ScoreRing } from '@/components/motion/score-ring';
import { Page } from '@/components/shell/page';
import { useSnapshotSession } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Menu, Modal } from '@/components/ui/overlay';
import { Badge, EmptyState, Field, Input, Panel, Segmented, Select, Skeleton, Switch } from '@/components/ui/primitives';
import { api } from '@/lib/client';
import { useColumnDrag } from '@/lib/column-drag';
import { useExtendedQuotes } from '@/lib/extended-client';
import { compactNumber } from '@/lib/format';
import type { ScreenDefinition } from '@/lib/schemas';
import { SESSION_CHANGE_LABEL } from '@/lib/session';
import { cn } from '@/lib/utils';

import { CAP_BUCKETS, EMPTY_SCREEN, METRIC_BY_KEY, METRIC_COLUMNS, PRESETS, type ExplorerRow, type Filter, type MetricKey, type ScreenState } from './columns';
import { useSearchParams } from '@/components/shell/keep-alive';

type UniversePayload = { fields: string[]; rows: unknown[][]; generatedAt: string };
type SavedScreen = { id: string; name: string; definition: ScreenDefinition };

const ROW_HEIGHT = 34;
const MIN_COLUMN_WIDTH = 36;
const FIXED = [
  { key: 'symbol', label: 'Ticker', width: 214 },
  { key: 'sector', label: 'Sector', width: 150 },
] as const;

function ColumnResizeHandle({ width, onResize }: { width: number; onResize: (nextWidth: number) => void }) {
  const onMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: MouseEvent) => {
      onResize(Math.max(MIN_COLUMN_WIDTH, startWidth + (moveEvent.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={(event) => event.stopPropagation()}
      style={{ right: -6 }}
      className="group absolute top-0 z-20 flex h-full w-3 cursor-col-resize touch-none items-center justify-center select-none"
    >
      <div className="h-4 w-px bg-faint transition-all group-hover:h-full group-hover:w-[3px] group-hover:bg-brand" />
    </div>
  );
}

function toRows(payload: UniversePayload): ExplorerRow[] {
  return payload.rows.map((raw) => {
    const row: Record<string, unknown> = {};
    payload.fields.forEach((field, index) => {
      row[field] = raw[index];
    });
    return row as ExplorerRow;
  });
}

function passes(row: ExplorerRow, filter: Filter) {
  const value = row[filter.key];
  if (typeof value !== 'number') return false;
  if (filter.min !== null && filter.min !== undefined && value < filter.min) return false;
  if (filter.max !== null && filter.max !== undefined && value > filter.max) return false;
  return true;
}

/** Percentile of each value within its sector (100 = best, by the metric's own direction). */
function sectorPercentiles(rows: ExplorerRow[], keys: MetricKey[]) {
  const result = new Map<string, Partial<Record<MetricKey, number>>>();
  const bySector = new Map<string, ExplorerRow[]>();
  for (const row of rows) {
    const list = bySector.get(row.sector ?? 'Other') ?? [];
    list.push(row);
    bySector.set(row.sector ?? 'Other', list);
  }
  for (const list of bySector.values()) {
    for (const key of keys) {
      const better = METRIC_BY_KEY[key]?.better ?? 'higher';
      const valued = list.filter((row) => typeof row[key] === 'number').sort((a, b) => (a[key] as number) - (b[key] as number));
      valued.forEach((row, index) => {
        const raw = valued.length > 1 ? index / (valued.length - 1) : 0.5;
        const percentile = Math.round((better === 'higher' ? raw : 1 - raw) * 100);
        const entry = result.get(row.symbol) ?? {};
        entry[key] = percentile;
        result.set(row.symbol, entry);
      });
    }
  }
  return result;
}

function toDefinition(screen: ScreenState): ScreenDefinition {
  return { ...screen, filters: screen.filters.map((filter) => ({ key: filter.key, min: filter.min ?? null, max: filter.max ?? null })) };
}

function fromDefinition(definition: ScreenDefinition): ScreenState {
  return {
    ...EMPTY_SCREEN,
    ...definition,
    filters: (definition.filters ?? []).filter((filter) => filter.key in METRIC_BY_KEY) as Filter[],
    columns: ((definition.columns ?? EMPTY_SCREEN.columns).filter((key) => key in METRIC_BY_KEY) as MetricKey[]),
    sort: (definition.sort as ScreenState['sort']) ?? EMPTY_SCREEN.sort,
    search: definition.search ?? '',
    sectors: definition.sectors ?? [],
    industries: definition.industries ?? [],
    relative: definition.relative ?? false,
  };
}

function FilterRow({ filter, onChange, onRemove }: { filter: Filter; onChange: (filter: Filter) => void; onRemove: () => void }) {
  const column = METRIC_BY_KEY[filter.key];
  const scale = column.scale ?? 1;
  const toInput = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(Math.round(value * scale * 1000) / 1000));
  const fromInput = (text: string) => {
    if (!text.trim()) return null;
    const multiplier = column.key === 'marketCap' || column.key === 'revenue' || column.key === 'netIncome' || column.key === 'fcf' ? 1e9 : 1;
    const value = Number(text) / scale;
    return Number.isFinite(value) ? value * multiplier : null;
  };
  const display = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '';
    const divisor = column.key === 'marketCap' || column.key === 'revenue' || column.key === 'netIncome' || column.key === 'fcf' ? 1e9 : 1;
    return toInput(value / divisor);
  };
  const unit = ['marketCap', 'revenue', 'netIncome', 'fcf'].includes(column.key) ? '$B' : column.unit;
  return (
    <div className="rounded-sm border border-line bg-surface-1 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-ink-2">{column.label}</span>
        <button onClick={onRemove} className="rounded-xs p-0.5 text-faint hover:text-ink" aria-label={`Remove ${column.label} filter`}>
          <X className="size-3" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <Input className="h-7 text-[12px]" placeholder="min" inputMode="decimal" defaultValue={display(filter.min)} onChange={(event) => onChange({ ...filter, min: fromInput(event.target.value) })} />
        <span className="text-faint">–</span>
        <Input className="h-7 text-[12px]" placeholder="max" inputMode="decimal" defaultValue={display(filter.max)} onChange={(event) => onChange({ ...filter, max: fromInput(event.target.value) })} />
        <span className="w-6 text-[10.5px] text-faint">{unit}</span>
      </div>
    </div>
  );
}

export function Explorer() {
  const session = useSnapshotSession();
  const router = useRouter();
  const params = useSearchParams();
  const { data, isLoading } = useSWR<UniversePayload>('/api/universe', { refreshInterval: 5 * 60_000 });
  const { data: saved, mutate: refreshSaved } = useSWR<SavedScreen[]>('/api/screens');
  const [screen, setScreen] = useState<ScreenState>(() => {
    const sort = params.get('sort');
    const sector = params.get('sector');
    return {
      ...EMPTY_SCREEN,
      sort: sort && sort in METRIC_BY_KEY ? { key: sort as MetricKey, dir: 'desc' } : EMPTY_SCREEN.sort,
      sectors: sector ? [sector] : [],
    };
  });
  const [view, setView] = useState<'table' | 'map'>('table');
  const [saving, setSaving] = useState(false);
  const [screenName, setScreenName] = useState('');
  const [activeScreen, setActiveScreen] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [columnWidths, setColumnWidths] = useState<Partial<Record<string, number>>>({});
  const deferredSearch = useDeferredValue(screen.search);

  const widthFor = (key: string, fallback: number) => columnWidths[key] ?? fallback;
  const resizeColumn = (key: string, nextWidth: number) => {
    setColumnWidths((current) => ({ ...current, [key]: nextWidth }));
  };

  const rows = useMemo(() => (data ? toRows(data) : []), [data]);
  const sectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.sector ?? 'Other', (counts.get(row.sector ?? 'Other') ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const industries = useMemo(() => {
    if (!screen.sectors.length) return [];
    const counts = new Map<string, number>();
    for (const row of rows) if (screen.sectors.includes(row.sector ?? 'Other') && row.industry) counts.set(row.industry, (counts.get(row.industry) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [rows, screen.sectors]);

  const percentiles = useMemo(() => (screen.relative ? sectorPercentiles(rows, screen.columns) : null), [rows, screen.relative, screen.columns]);

  const filtered = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    const result = rows.filter((row) => {
      if (term && !row.symbol.toLowerCase().startsWith(term) && !row.name.toLowerCase().includes(term)) return false;
      if (screen.sectors.length && !screen.sectors.includes(row.sector ?? 'Other')) return false;
      if (screen.industries.length && !screen.industries.includes(row.industry ?? '')) return false;
      return screen.filters.every((filter) => passes(row, filter));
    });
    const { key, dir } = screen.sort;
    const factor = dir === 'asc' ? 1 : -1;
    return result.sort((a, b) => {
      if (key === 'symbol' || key === 'name') return factor * String(a[key]).localeCompare(String(b[key]));
      const av = screen.relative && percentiles ? percentiles.get(a.symbol)?.[key] : a[key];
      const bv = screen.relative && percentiles ? percentiles.get(b.symbol)?.[key] : b[key];
      if (typeof av !== 'number' && typeof bv !== 'number') return 0;
      if (typeof av !== 'number') return 1;
      if (typeof bv !== 'number') return -1;
      return factor * (av - bv);
    });
  }, [rows, deferredSearch, screen.sectors, screen.industries, screen.filters, screen.sort, screen.relative, percentiles]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is not compiler-compatible; this list re-renders on scroll by design.
  const virtualizer = useVirtualizer({ count: filtered.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 12 });
  const columnDrag = useColumnDrag(screen.columns, (columns) => setScreen({ ...screen, columns }));
  // Extended-hours moves only for the rows on screen: each symbol is its own upstream request.
  const visibleSymbols = screen.columns.includes('price') ? virtualizer.getVirtualItems().map((item) => filtered[item.index]?.symbol).filter(Boolean) : [];
  const extended = useExtendedQuotes(visibleSymbols);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [screen.sort, screen.filters, screen.sectors, screen.industries, deferredSearch]);

  const update = (patch: Partial<ScreenState>) => {
    setScreen((current) => ({ ...current, ...patch }));
  };

  const toggleSort = (key: ScreenState['sort']['key']) => {
    update({ sort: screen.sort.key === key ? { key, dir: screen.sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'symbol' || key === 'name' ? 'asc' : 'desc' } });
  };

  const setFilter = (next: Filter) => update({ filters: screen.filters.some((filter) => filter.key === next.key) ? screen.filters.map((filter) => (filter.key === next.key ? next : filter)) : [...screen.filters, next] });

  const capFilter = screen.filters.find((filter) => filter.key === 'marketCap');

  const exportCsv = () => {
    const header = ['Ticker', 'Company', 'Sector', 'Industry', ...screen.columns.map((key) => METRIC_BY_KEY[key].label)];
    const lines = filtered.map((row) => [row.symbol, row.name, row.sector ?? '', row.industry ?? '', ...screen.columns.map((key) => (row[key] ?? '').toString())]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `silvernote-screen-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveScreen = async () => {
    if (!screenName.trim()) return;
    const row = await api<SavedScreen>('/api/screens', { body: { name: screenName.trim(), definition: toDefinition(screen) } });
    toast.success(`Saved “${row.name}”`);
    setActiveScreen(row.id);
    setSaving(false);
    setScreenName('');
    void refreshSaved();
  };

  const totalWidth = FIXED.reduce((sum, column) => sum + widthFor(column.key, column.width), 0) + screen.columns.reduce((sum, key) => sum + widthFor(key, METRIC_BY_KEY[key].width), 0);

  return (
    <Page
      kicker={`${rows.length.toLocaleString()} US common stocks · SEC fundamentals · SilverNote Scores`}
      title="Market explorer"
      actions={
        <>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'table', label: <span className="flex items-center gap-1.5"><Table2 className="size-3.5" />Table</span> },
              { value: 'map', label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-3.5" />Map</span> },
            ]}
          />
          <Button variant="outline" icon={<Download className="size-3.5" />} onClick={exportCsv} disabled={!filtered.length}>
            CSV
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <motion.aside
          animate={{ width: filtersOpen ? 260 : 44 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="flex shrink-0 flex-col gap-3 overflow-hidden lg:sticky lg:top-4"
        >
          <button
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
            aria-label={filtersOpen ? 'Collapse filters' : 'Expand filters'}
            className={cn('flex h-8 w-full shrink-0 items-center gap-1.5 rounded-sm border border-line bg-surface-1 px-2 text-[11.5px] whitespace-nowrap text-ink-2 hover:text-ink', filtersOpen ? 'justify-between' : 'justify-center')}
          >
            {filtersOpen ? <span>Filters</span> : null}
            {filtersOpen ? <ChevronLeft className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          </button>
          <AnimatePresence initial={false}>
            {filtersOpen ? (
              <motion.div
                key="filter-panels"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="flex w-[260px] shrink-0 flex-col gap-3"
              >
          <Panel className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input value={screen.search} onChange={(event) => update({ search: event.target.value })} placeholder="Ticker or company" className="pl-8" />
            </div>
            <div className="mt-3">
              <div className="kicker mb-1.5">Presets</div>
              <div className="flex flex-col gap-1">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      setScreen({ ...EMPTY_SCREEN, columns: screen.columns, ...preset.screen });
                      setActiveScreen(preset.id);
                    }}
                    className={cn('rounded-sm px-2 py-1.5 text-left transition-colors', activeScreen === preset.id ? 'bg-brand-wash' : 'hover:bg-white/[0.04]')}
                  >
                    <div className={cn('text-[12.5px]', activeScreen === preset.id ? 'text-ink' : 'text-ink-2')}>{preset.name}</div>
                    <div className="text-[10.5px] text-faint">{preset.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel className="p-3">
            <div className="kicker mb-1.5">Market value</div>
            <div className="flex flex-wrap gap-1">
              {CAP_BUCKETS.map((bucket) => {
                const active = capFilter && (capFilter.min ?? null) === bucket.min && (capFilter.max ?? null) === bucket.max;
                return (
                  <button
                    key={bucket.label}
                    onClick={() =>
                      active
                        ? update({ filters: screen.filters.filter((filter) => filter.key !== 'marketCap') })
                        : setFilter({ key: 'marketCap', min: bucket.min, max: bucket.max })
                    }
                    className={cn('h-6 rounded-xs border px-2 text-[11px] transition-colors', active ? 'border-brand/60 bg-brand-wash text-ink' : 'border-line text-muted hover:text-ink-2')}
                  >
                    {bucket.label}
                  </button>
                );
              })}
            </div>
            <div className="kicker mt-3 mb-1.5">Sectors</div>
            <div className="flex flex-col">
              {sectors.map(([sector, count]) => {
                const checked = screen.sectors.includes(sector);
                return (
                  <label key={sector} className="flex cursor-pointer items-center gap-2 rounded-xs px-1 py-[3px] hover:bg-white/[0.03]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => update({ sectors: checked ? screen.sectors.filter((item) => item !== sector) : [...screen.sectors, sector], industries: [] })}
                      className="size-3.5 accent-[#cdd4de]"
                    />
                    <span className={cn('flex-1 truncate text-[12px]', checked ? 'text-ink' : 'text-ink-2')}>{sector}</span>
                    <span className="num text-[10.5px] text-faint">{count.toLocaleString()}</span>
                  </label>
                );
              })}
            </div>
            {industries.length ? (
              <>
                <div className="kicker mt-3 mb-1.5">Industries</div>
                <div className="flex max-h-56 flex-col overflow-y-auto">
                  {industries.map(([industry, count]) => {
                    const checked = screen.industries.includes(industry);
                    return (
                      <label key={industry} className="flex cursor-pointer items-center gap-2 rounded-xs px-1 py-[3px] hover:bg-white/[0.03]">
                        <input type="checkbox" checked={checked} onChange={() => update({ industries: checked ? screen.industries.filter((item) => item !== industry) : [...screen.industries, industry] })} className="size-3.5 accent-[#cdd4de]" />
                        <span className={cn('flex-1 truncate text-[11.5px]', checked ? 'text-ink' : 'text-muted')}>{industry}</span>
                        <span className="num text-[10.5px] text-faint">{count}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : null}
          </Panel>

          <Panel className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="kicker">Filters</span>
              <Select
                value=""
                onChange={(event) => {
                  const key = event.target.value as MetricKey;
                  if (key && !screen.filters.some((filter) => filter.key === key)) update({ filters: [...screen.filters, { key, min: null, max: null }] });
                }}
                className="h-6 w-28 text-[11px]"
              >
                <option value="">+ Add filter</option>
                {METRIC_COLUMNS.filter((column) => !screen.filters.some((filter) => filter.key === column.key)).map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              {screen.filters.length ? (
                screen.filters.map((filter) => (
                  <FilterRow key={`${filter.key}-${activeScreen}`} filter={filter} onChange={setFilter} onRemove={() => update({ filters: screen.filters.filter((item) => item.key !== filter.key) })} />
                ))
              ) : (
                <p className="text-[11.5px] text-faint">No metric filters. Percentages are typed as whole numbers (15 = 15%).</p>
              )}
            </div>
            <Button
              className="mt-3 w-full"
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => {
                setScreen({ ...EMPTY_SCREEN, columns: screen.columns });
                setActiveScreen(null);
              }}
            >
              Reset screen
            </Button>
          </Panel>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{filtered.length.toLocaleString()} matches</Badge>
            {screen.filters.length || screen.sectors.length ? (
              <span className="flex items-center gap-1 text-[11.5px] text-muted">
                <FilterIcon className="size-3" />
                {[...screen.sectors, ...screen.filters.map((filter) => METRIC_BY_KEY[filter.key].short ?? METRIC_BY_KEY[filter.key].label)].join(' · ')}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-2 text-[12px] text-ink-2" title="Show each metric as a percentile within its sector">
                <Switch checked={screen.relative} onChange={(value) => update({ relative: value })} label="Sector-relative ranks" />
                Sector ranks
              </label>
              <Menu
                trigger={({ toggle }) => (
                  <Button size="sm" variant="outline" icon={<Columns3 className="size-3.5" />} onClick={toggle}>
                    Columns
                  </Button>
                )}
                items={METRIC_COLUMNS.map((column) => ({
                  label: (
                    <span className="flex w-full items-center justify-between gap-6">
                      {column.label}
                      <span className="text-[10px] text-faint">{column.group}</span>
                    </span>
                  ),
                  icon: <span className={cn('size-3.5 rounded-[3px] border', screen.columns.includes(column.key) ? 'border-brand bg-brand' : 'border-line-strong')} />,
                  onSelect: () =>
                    update({
                      columns: screen.columns.includes(column.key) ? screen.columns.filter((key) => key !== column.key) : [...screen.columns, column.key],
                    }),
                }))}
              />
              <Menu
                trigger={({ toggle }) => (
                  <Button size="sm" variant="outline" icon={<Bookmark className="size-3.5" />} onClick={toggle}>
                    Screens
                  </Button>
                )}
                items={[
                  ...(saved ?? []).map((item) => ({
                    label: item.name,
                    icon: <Bookmark className={cn('size-3.5', activeScreen === item.id ? 'text-brand' : 'text-faint')} />,
                    onSelect: () => {
                      setScreen(fromDefinition(item.definition));
                      setActiveScreen(item.id);
                    },
                  })),
                  ...(saved?.length ? (['separator'] as const) : []),
                  { label: 'Save current screen…', icon: <Save className="size-3.5" />, onSelect: () => setSaving(true) },
                  ...(activeScreen && saved?.some((item) => item.id === activeScreen)
                    ? [
                        {
                          label: 'Update saved screen',
                          icon: <Plus className="size-3.5" />,
                          onSelect: async () => {
                            await api(`/api/screens/${activeScreen}`, { method: 'PATCH', body: { definition: toDefinition(screen) } });
                            toast.success('Screen updated');
                            void refreshSaved();
                          },
                        },
                        {
                          label: 'Delete saved screen',
                          icon: <Trash2 className="size-3.5" />,
                          danger: true,
                          onSelect: async () => {
                            await api(`/api/screens/${activeScreen}`, { method: 'DELETE' });
                            setActiveScreen(null);
                            void refreshSaved();
                          },
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </div>

          {view === 'map' ? (
            <Panel className="p-4">
              <MarketHeatmap
                items={filtered
                  .filter((row) => row.marketCap)
                  .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
                  .map((row) => ({ symbol: row.symbol, name: row.name, sector: row.sector, industry: row.industry, marketCap: row.marketCap, changePct: row.changePct, price: row.price, score: row.score }))}
                height={620}
              />
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              {isLoading && !data ? (
                <Skeleton className="m-4 h-[60vh]" />
              ) : !filtered.length ? (
                <EmptyState icon={<FilterIcon className="size-4" />} title="Nothing matches this screen" body="Loosen a filter or clear the sector selection." />
              ) : (
                <div ref={scrollRef} className="relative h-[calc(100dvh-230px)] min-h-[420px] overflow-auto">
                  <div style={{ width: Math.max(totalWidth, 600) }}>
                    <div className="sticky top-0 z-20 flex border-b border-line-strong bg-surface-2/95 backdrop-blur" style={{ height: 34 }}>
                      {[
                        { key: 'symbol' as const, label: 'Company', width: widthFor('symbol', FIXED[0].width), fallback: FIXED[0].width, align: 'left' },
                        { key: 'sector' as const, label: 'Sector', width: widthFor('sector', FIXED[1].width), fallback: FIXED[1].width, align: 'left' },
                        ...columnDrag.order.map((key) => ({ key, label: key === 'changePct' ? SESSION_CHANGE_LABEL[session].short : (METRIC_BY_KEY[key].short ?? METRIC_BY_KEY[key].label), width: widthFor(key, METRIC_BY_KEY[key].width), fallback: METRIC_BY_KEY[key].width, align: 'right' as const })),
                      ].map((column, index) => {
                        const sortable = column.key !== 'sector';
                        const active = screen.sort.key === column.key;
                        return (
                          <div
                            key={column.key}
                            {...(index > 1 ? columnDrag.headerProps(column.key as MetricKey) : {})}
                            onClick={() => sortable && toggleSort(column.key as ScreenState['sort']['key'])}
                            className={cn(
                              'relative flex shrink-0 items-center gap-1 px-2.5 text-[11px] font-medium whitespace-nowrap',
                              column.align === 'right' ? 'justify-end' : 'justify-start',
                              sortable && 'cursor-pointer',
                              active ? 'text-ink' : 'text-muted hover:text-ink-2',
                              index === 0 && 'sticky left-0 z-10 bg-surface-2',
                              index > 1 && 'active:cursor-grabbing',
                              columnDrag.dragged === column.key && 'opacity-40',
                            )}
                            style={{ width: column.width }}
                          >
                            {column.label}
                            {active ? screen.sort.dir === 'desc' ? <ArrowDown className="size-3 text-brand" /> : <ArrowUp className="size-3 text-brand" /> : null}
                            <ColumnResizeHandle width={column.width} onResize={(nextWidth) => resizeColumn(column.key, nextWidth)} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                      {virtualizer.getVirtualItems().map((item) => {
                        const row = filtered[item.index];
                        const ranks = percentiles?.get(row.symbol);
                        return (
                          <div
                            key={row.symbol}
                            onClick={() => router.push(`/company/${row.symbol}`)}
                            data-nav-row
                            tabIndex={-1}
                            className="group absolute inset-x-0 flex cursor-pointer items-center border-b border-line outline-none hover:bg-white/[0.03] focus:bg-white/[0.05]"
                            style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                          >
                            <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-surface-2 px-2.5 group-hover:bg-[#13161b]" style={{ width: widthFor('symbol', FIXED[0].width), height: ROW_HEIGHT }}>
                              <ViewTransition name={`company-${row.symbol}`} share="morph" default="none">
                                <div className="flex min-w-0 items-center gap-2">
                                  <CompanyLogo symbol={row.symbol} size="xs" />
                                  <span className="w-12 shrink-0 font-mono text-[12px] font-semibold text-ink group-hover:text-white">{row.symbol}</span>
                                  <span className="truncate text-[11.5px] text-muted">{row.name}</span>
                                </div>
                              </ViewTransition>
                            </div>
                            <div className="shrink-0 truncate px-2.5 text-[11.5px] text-muted" style={{ width: widthFor('sector', FIXED[1].width) }}>
                              {row.sector ?? '—'}
                            </div>
                            {columnDrag.order.map((key) => {
                              const column = METRIC_BY_KEY[key];
                              const width = widthFor(key, column.width);
                              const value = row[key];
                              const rank = ranks?.[key];
                              if (key === 'score' && !screen.relative) {
                                return (
                                  <div key={key} className="flex shrink-0 items-center justify-end gap-1.5 px-2.5" style={{ width }}>
                                    {typeof value === 'number' ? <ScoreRing score={value} size="xs" /> : <span className="text-[11px] text-faint">—</span>}
                                  </div>
                                );
                              }
                              if (screen.relative) {
                                return (
                                  <div key={key} className="num shrink-0 px-2.5 text-right text-[12px]" style={{ width }}>
                                    {typeof rank === 'number' ? (
                                      <span className="inline-block min-w-8 rounded-[3px] px-1 text-ink" style={{ background: `rgba(205,212,222,${(rank / 100) * 0.3})` }} title={`${column.label}: ${typeof value === 'number' ? column.format(value) : '—'} · ${rank}th percentile in sector`}>
                                        {rank}
                                      </span>
                                    ) : (
                                      <span className="text-faint">—</span>
                                    )}
                                  </div>
                                );
                              }
                              if (key === 'price' && extended[row.symbol]) {
                                return (
                                  <div key={key} className="num flex shrink-0 flex-col items-end justify-center gap-0.5 px-2.5 text-right text-[12px] leading-none text-ink-2" style={{ width }}>
                                    <span>{typeof value === 'number' ? column.format(value) : '—'}</span>
                                    <ExtendedMove quote={extended[row.symbol]} />
                                  </div>
                                );
                              }
                              const tone = key === 'changePct' && typeof value === 'number' ? (value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-muted') : 'text-ink-2';
                              return (
                                <div key={key} className={cn('num shrink-0 truncate px-2.5 text-right text-[12px]', tone)} style={{ width }}>
                                  {typeof value === 'number' ? column.format(value) : <span className="text-faint">—</span>}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          )}
          <p className="text-[11px] text-faint">
            Fundamentals: latest fiscal year from SEC filings; valuation ratios use today’s market value. Market values from the latest snapshot ({data ? new Date(data.generatedAt).toLocaleTimeString() : '—'}). Total shown:{' '}
            ${compactNumber(filtered.reduce((sum, row) => sum + (row.marketCap ?? 0), 0))}.
          </p>
        </div>
      </div>

      <Modal
        open={saving}
        onClose={() => setSaving(false)}
        title="Save screen"
        description="Filters, sectors, sort order and columns are saved together."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaving(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveScreen()}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Name">
          <Input autoFocus value={screenName} onChange={(event) => setScreenName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void saveScreen()} placeholder="e.g. Cheap quality industrials" />
        </Field>
      </Modal>
    </Page>
  );
}

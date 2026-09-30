'use client';

import { Copy, LayoutPanelLeft, Maximize2, Minimize2, Plus, Save, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { MarketHeatmap, type HeatmapItem } from '@/components/charts/market-heatmap';
import { StockChart } from '@/components/charts/stock-chart';
import { DcfPanel } from '@/components/company/dcf-panel';
import { Financials } from '@/components/company/financials';
import { InsidersPanel } from '@/components/company/insiders-panel';
import { NewsPanel } from '@/components/company/news-panel';
import { PeersPanel } from '@/components/company/peers-panel';
import { ScorePanel } from '@/components/company/score-panel';
import { CompsTool } from '@/components/lab/lab';
import { MacroTape } from '@/components/macro/macro-tape';
import { Delta } from '@/components/motion/delta';
import { Page } from '@/components/shell/page';
import { useShell } from '@/components/shell/providers';
import { Button, IconButton } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Panel, Select, Skeleton } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { CompanyWorkspace } from '@/components/workspace/company-workspace';
import { compactNumber, price } from '@/lib/format';
import { cn } from '@/lib/utils';

type PanelType = 'chart' | 'quote' | 'financials' | 'news' | 'insiders' | 'comps' | 'dcf' | 'score' | 'peers' | 'thesis' | 'heatmap' | 'macro';
type Group = 'A' | 'B' | 'C';
type PanelSpec = { id: string; type: PanelType; group: Group; span: 4 | 6 | 8 | 12; tall?: boolean };
type Layout = { id: string; name: string; groups?: Partial<Record<Group, string>>; panels: PanelSpec[] };

const TYPES: Record<PanelType, { label: string; linked: boolean }> = {
  chart: { label: 'Chart', linked: true },
  quote: { label: 'Quote & key stats', linked: true },
  financials: { label: 'Financials', linked: true },
  news: { label: 'News & filings', linked: true },
  insiders: { label: 'Insiders & risks', linked: true },
  comps: { label: 'Comps', linked: true },
  dcf: { label: 'DCF', linked: true },
  score: { label: 'Score', linked: true },
  peers: { label: 'Peers', linked: true },
  thesis: { label: 'Thesis workspace', linked: true },
  heatmap: { label: 'Market map', linked: false },
  macro: { label: 'Macro tape', linked: false },
};

const GROUP_COLOR: Record<Group, string> = { A: '#e8c268', B: '#9fd8ff', C: '#c79bff' };

const PRESETS: Layout[] = [
  {
    id: 'research',
    name: 'Single-name research',
    groups: { A: 'NVDA' },
    panels: [
      { id: 'p1', type: 'chart', group: 'A', span: 8 },
      { id: 'p2', type: 'quote', group: 'A', span: 4 },
      { id: 'p3', type: 'financials', group: 'A', span: 8, tall: true },
      { id: 'p4', type: 'news', group: 'A', span: 4, tall: true },
    ],
  },
  {
    id: 'pair',
    name: 'Pair: two linked names',
    groups: { A: 'NVDA', B: 'AMD' },
    panels: [
      { id: 'p1', type: 'chart', group: 'A', span: 6 },
      { id: 'p2', type: 'chart', group: 'B', span: 6 },
      { id: 'p3', type: 'quote', group: 'A', span: 6 },
      { id: 'p4', type: 'quote', group: 'B', span: 6 },
      { id: 'p5', type: 'comps', group: 'A', span: 12 },
    ],
  },
  {
    id: 'market',
    name: 'Market monitor',
    groups: { A: 'SPY' },
    panels: [
      { id: 'p1', type: 'macro', group: 'A', span: 12 },
      { id: 'p2', type: 'heatmap', group: 'A', span: 8, tall: true },
      { id: 'p3', type: 'chart', group: 'A', span: 4, tall: true },
    ],
  },
];

type CompanyPayload = {
  security: { name: string; market_cap: number | null; sector: string | null; industry: string | null } | null;
  quote: { price: number | null; change: number | null; changePct: number | null } | null;
  score: { overall: number; label: string } | null;
  fundamentals: Record<string, number | string | null> | null;
  profile: { forwardPE: number | null; dividendYield: number | null; oneYearTarget: number | null; high52: number | null; low52: number | null } | null;
};

function QuotePanel({ symbol }: { symbol: string }) {
  const { data } = useSWR<CompanyPayload>(`/api/company/${symbol}`, { refreshInterval: 30_000 });
  if (!data) return <Skeleton className="h-40" />;
  const f = data.fundamentals ?? {};
  const cap = data.security?.market_cap ?? null;
  const num = (key: string) => (typeof f[key] === 'number' ? (f[key] as number) : null);
  const stats: Array<[string, string]> = [
    ['Market value', cap ? `$${compactNumber(cap, 2)}` : '—'],
    ['P/E', cap && num('net_income') && (num('net_income') as number) > 0 ? `${(cap / (num('net_income') as number)).toFixed(1)}×` : '—'],
    ['Fwd P/E', data.profile?.forwardPE ? `${data.profile.forwardPE.toFixed(1)}×` : '—'],
    ['P/S', cap && num('revenue') ? `${(cap / (num('revenue') as number)).toFixed(1)}×` : '—'],
    ['FCF yield', cap && num('fcf') !== null ? `${(((num('fcf') as number) / cap) * 100).toFixed(1)}%` : '—'],
    ['52w range', data.profile?.low52 && data.profile.high52 ? `${price(data.profile.low52)}–${price(data.profile.high52)}` : '—'],
    ['1Y target', data.profile?.oneYearTarget ? `$${price(data.profile.oneYearTarget)}` : '—'],
    ['Score', data.score ? `${data.score.overall} · ${data.score.label}` : '—'],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <CompanyLogo symbol={symbol} size="md" />
        <div className="min-w-0">
          <Link href={`/company/${symbol}`} className="font-mono text-[15px] font-semibold text-ink hover:underline">
            {symbol}
          </Link>
          <div className="truncate text-[11.5px] text-muted">{data.security?.name}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="num text-[20px] font-semibold text-ink">{price(data.quote?.price)}</div>
          <Delta value={data.quote?.changePct} alreadyPercent className="text-[12px]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {stats.map(([label, value]) => (
          <div key={label}>
            <div className="text-[10.5px] text-muted">{label}</div>
            <div className="num text-[13px] text-ink">{value}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-faint">{[data.security?.sector, data.security?.industry].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

function HeatmapPanel({ height }: { height: number }) {
  const { data } = useSWR<{ heatmap: HeatmapItem[] }>('/api/dashboard', { refreshInterval: 60_000 });
  return data?.heatmap.length ? <MarketHeatmap items={data.heatmap} height={height} /> : <div style={{ height }}><Skeleton className="h-full" /></div>;
}

function PanelBody({ type, symbol, tall }: { type: PanelType; symbol: string; tall?: boolean }) {
  switch (type) {
    case 'chart':
      return <StockChart symbol={symbol} fill />;
    case 'quote':
      return <QuotePanel symbol={symbol} />;
    case 'financials':
      return <Financials symbol={symbol} isBank={false} />;
    case 'news':
      return <NewsPanel symbol={symbol} name={symbol} />;
    case 'insiders':
      return <InsidersPanel symbol={symbol} />;
    case 'comps':
      return <CompsTool key={symbol} initialSymbol={symbol} />;
    case 'dcf':
      return <DcfPanel symbol={symbol} />;
    case 'score':
      return <ScorePanel symbol={symbol} />;
    case 'peers':
      return <PeersPanel symbol={symbol} />;
    case 'thesis':
      return <CompanyWorkspace symbol={symbol} name={symbol} currentPrice={null} />;
    case 'heatmap':
      return <HeatmapPanel height={tall ? 700 : 360} />;
    case 'macro':
      return <MacroTape />;
  }
}

const WORKING_KEY = 'silvernote:terminal';

const SPAN: Record<PanelSpec['span'], string> = { 4: 'xl:col-span-4', 6: 'xl:col-span-6', 8: 'xl:col-span-8', 12: 'xl:col-span-12' };

function TerminalPanel({
  spec,
  symbol,
  onChange,
  onRemove,
  onSymbol,
  children,
}: {
  spec: PanelSpec;
  symbol: string;
  onChange: (patch: Partial<PanelSpec>) => void;
  onRemove: () => void;
  onSymbol: (symbol: string) => void;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const linked = TYPES[spec.type].linked;
  // The macro tape is one row of tiles, so it sizes to its content; everything else gets a fixed
  // height (so neighbours line up) and scrolls inside.
  const auto = spec.type === 'macro';
  const nextGroup: Record<Group, Group> = { A: 'B', B: 'C', C: 'A' };
  return (
    <Panel className={cn('col-span-12 flex min-w-0 flex-col', SPAN[spec.span], !auto && (spec.tall ? 'h-[820px]' : 'h-[480px]'))}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        {linked ? (
          <button
            onClick={() => onChange({ group: nextGroup[spec.group] })}
            className="grid size-5 shrink-0 place-items-center rounded-xs font-mono text-[10px] font-bold text-[#0b0c0f]"
            style={{ background: GROUP_COLOR[spec.group] }}
            title="Link group: panels with the same color follow the same ticker. Click to change."
          >
            {spec.group}
          </button>
        ) : null}
        <Select value={spec.type} onChange={(event) => onChange({ type: event.target.value as PanelType })} className="h-6 w-auto py-0 text-[11.5px]">
          {Object.entries(TYPES).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </Select>
        {linked ? (
          editing ? (
            <TickerSearch
              autoFocus
              className="w-56"
              placeholder="Ticker…"
              onPick={(value) => {
                onSymbol(value);
                setEditing(false);
              }}
            />
          ) : (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 hover:bg-white/5" title="Change ticker (updates every panel in this link group)">
              <CompanyLogo symbol={symbol} size="xs" />
              <span className="font-mono text-[12px] font-semibold text-ink">{symbol}</span>
            </button>
          )
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          <Select value={String(spec.span)} onChange={(event) => onChange({ span: Number(event.target.value) as PanelSpec['span'] })} className="hidden h-6 w-auto py-0 text-[11px] xl:block" aria-label="Width">
            <option value="4">⅓</option>
            <option value="6">½</option>
            <option value="8">⅔</option>
            <option value="12">Full</option>
          </Select>
          {auto ? null : (
            <IconButton label={spec.tall ? 'Shorter' : 'Taller'} size="xs" onClick={() => onChange({ tall: !spec.tall })}>
              {spec.tall ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
            </IconButton>
          )}
          <IconButton label="Remove panel" size="xs" onClick={onRemove}>
            <X className="size-3" />
          </IconButton>
        </div>
      </div>
      <div className={cn('term-body min-h-0 flex-1 p-3 [&_.panel]:border-0 [&_.panel]:bg-transparent [&_.panel]:shadow-none', spec.type === 'chart' ? 'overflow-hidden' : 'overflow-auto')}>
        {children}
      </div>
    </Panel>
  );
}

/** Split-screen workspace: linked panels (color groups follow one ticker) and saved layouts. */
export function Terminal() {
  const { prefs, updatePrefs } = useShell();
  const saved = (prefs.terminalLayouts ?? []) as unknown as Layout[];
  const all = [...saved, ...PRESETS.filter((preset) => !saved.some((layout) => layout.id === preset.id))];
  const [layout, setLayout] = useState<Layout>(() => structuredClone(PRESETS[0]));
  // The screen in progress (tickers, panels) survives leaving the page; Save stores it as a layout.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKING_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
      if (raw) setLayout(JSON.parse(raw) as Layout);
    } catch {
      // Unreadable storage: start from the default preset.
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    // Until the stored screen is restored, `layout` is the default and must not overwrite it.
    if (!hydrated) return;
    try {
      localStorage.setItem(WORKING_KEY, JSON.stringify(layout));
    } catch {
      // Storage full or blocked: the layout just won't be remembered.
    }
  }, [layout, hydrated]);
  const groups = { A: 'NVDA', B: 'AMD', C: 'MSFT', ...(layout.groups ?? {}) } as Record<Group, string>;

  const update = (panels: PanelSpec[]) => setLayout((current) => ({ ...current, panels }));
  const save = async (asNew = false) => {
    const name = asNew ? window.prompt('Layout name', `${layout.name} copy`) : layout.name;
    if (!name) return;
    // Saving a preset stores a copy under the preset's id, which then shadows the built-in one.
    const next: Layout = { ...layout, name, id: asNew ? `l${Date.now()}` : layout.id };
    const rest = saved.filter((item) => item.id !== next.id);
    await updatePrefs({ terminalLayouts: [...rest, next] as unknown as NonNullable<typeof prefs.terminalLayouts> });
    setLayout(next);
    toast.success(`Saved “${name}”`);
  };
  const remove = async () => {
    if (!saved.some((item) => item.id === layout.id)) return;
    await updatePrefs({ terminalLayouts: saved.filter((item) => item.id !== layout.id) as unknown as NonNullable<typeof prefs.terminalLayouts> });
    setLayout(structuredClone(PRESETS[0]));
  };

  return (
    <Page
      kicker="Linked panels · saved layouts"
      title="Terminal"
      description="Build your own screen: panels with the same colored link follow the same ticker. Change a ticker in one and the whole group moves."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={layout.id}
            onChange={(event) => {
              const next = all.find((item) => item.id === event.target.value);
              if (next) setLayout(structuredClone(next));
            }}
            className="w-56"
            aria-label="Layout"
          >
            {all.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <Button variant="outline" icon={<Save className="size-3.5" />} onClick={() => void save()}>
            Save
          </Button>
          <IconButton label="Save as new layout" variant="outline" onClick={() => void save(true)}>
            <Copy className="size-3.5" />
          </IconButton>
          {saved.some((item) => item.id === layout.id) ? (
            <IconButton label="Delete layout" variant="outline" onClick={() => void remove()}>
              <Trash2 className="size-3.5" />
            </IconButton>
          ) : null}
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => update([...layout.panels, { id: `p${Date.now()}`, type: 'chart', group: 'A', span: 6 }])}>
            Panel
          </Button>
        </div>
      }
    >
      {layout.panels.length ? (
        <div className="grid grid-cols-12 gap-3">
          {layout.panels.map((spec) => (
            <TerminalPanel
              key={spec.id}
              spec={spec}
              symbol={groups[spec.group]}
              onChange={(patch) => update(layout.panels.map((item) => (item.id === spec.id ? { ...item, ...patch } : item)))}
              onRemove={() => update(layout.panels.filter((item) => item.id !== spec.id))}
              onSymbol={(symbol) => setLayout((current) => ({ ...current, groups: { ...groups, [spec.group]: symbol } }))}
            >
              <PanelBody type={spec.type} symbol={groups[spec.group]} tall={spec.tall} />
            </TerminalPanel>
          ))}
        </div>
      ) : (
        <Panel className="grid place-items-center p-12 text-center">
          <LayoutPanelLeft className="mb-2 size-5 text-muted" />
          <p className="text-[13px] text-muted">Empty layout. Add a panel to start.</p>
        </Panel>
      )}
    </Page>
  );
}

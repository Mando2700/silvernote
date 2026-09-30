'use client';

import { hierarchy, interpolateLab, scaleLinear, treemap, treemapSquarify } from 'd3';
import { ArrowLeft, Table2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useMarketColors } from '@/components/shell/providers';
import { useSnapshotSession } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Segmented } from '@/components/ui/primitives';
import { sectorPerformance, SECTOR_UNIVERSE_SIZE } from '@/lib/finance/sectors';
import { compactNumber, price, signedPct } from '@/lib/format';
import { SESSION_CHANGE_LABEL } from '@/lib/session';
import { luminance, NEUTRAL_FILL } from '@/lib/theme';
import { cn } from '@/lib/utils';

export type HeatmapItem = {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  changePct: number | null;
  price: number | null;
  score: number | null;
};

type Mode = 'change' | 'score';

type Tile = { key: string; symbol: string; item: HeatmapItem; x: number; y: number; w: number; h: number };
type SectorBox = { key: string; sector: string; x: number; y: number; w: number; h: number; change: number | null; cap: number };

const NEUTRAL = NEUTRAL_FILL;
// Sequential: charcoal → polished silver as the SilverNote Score rises.
const SCORE_RAMP = ['#23262c', '#59606b', '#dfe4eb'];
const scoreScale = scaleLinear<string>().domain([30, 60, 90]).range(SCORE_RAMP).interpolate(interpolateLab).clamp(true);

const HEADER = 18;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function layout(items: HeatmapItem[], width: number, height: number, focus: string | null, stats: Map<string, number | null>) {
  const tiles: Tile[] = [];
  const sectors: SectorBox[] = [];
  if (!width || !height) return { tiles, sectors };
  const bySector = new Map<string, HeatmapItem[]>();
  for (const item of items) {
    if (!item.marketCap || item.marketCap <= 0) continue;
    const sector = item.sector ?? 'Other';
    if (focus && sector !== focus) continue;
    const list = bySector.get(sector) ?? [];
    list.push(item);
    bySector.set(sector, list);
  }
  type Node = { name: string; children?: Node[]; item?: HeatmapItem; value?: number };
  const root = hierarchy<Node>({
    name: 'market',
    children: [...bySector.entries()].map(([sector, list]) => ({
      name: sector,
      children: list.map((item) => ({ name: item.symbol, item, value: item.marketCap ?? 0 })),
    })),
  })
    .sum((node) => node.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  treemap<Node>()
    .tile(treemapSquarify.ratio(1.25))
    .size([width, height])
    .paddingOuter(focus ? 0 : 2)
    .paddingTop((node) => (node.depth === 1 && !focus ? HEADER : 0))
    .paddingInner(2)
    .round(true)(root);

  for (const node of root.descendants()) {
    const rect = node as unknown as { x0: number; y0: number; x1: number; y1: number };
    if (node.depth === 1) {
      const list = bySector.get(node.data.name) ?? [];
      const cap = list.reduce((total, item) => total + (item.marketCap ?? 0), 0);
      sectors.push({ key: node.data.name, sector: node.data.name, x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0, change: stats.get(node.data.name) ?? null, cap });
    }
    if (node.depth === 2 && node.data.item) {
      tiles.push({ key: node.data.item.symbol, symbol: node.data.item.symbol, item: node.data.item, x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0 });
    }
  }
  return { tiles, sectors };
}

export function MarketHeatmap({ items, height = 520, className }: { items: HeatmapItem[]; height?: number; className?: string }) {
  const session = useSnapshotSession();
  const [containerRef, size] = useSize<HTMLDivElement>();
  const [mode, setMode] = useState<Mode>('change');
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<{ tile: Tile; x: number; y: number } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const visible = useMemo(() => {
    if (focus) return items.filter((item) => item.sector === focus).slice(0, 260);
    return items.slice(0, SECTOR_UNIVERSE_SIZE);
  }, [items, focus]);
  const sectorChange = useMemo(() => new Map(sectorPerformance(items).map((stat) => [stat.sector, stat.changePct])), [items]);
  const { tiles, sectors } = useMemo(() => layout(visible, size.width, size.height, focus, sectorChange), [visible, size.width, size.height, focus, sectorChange]);
  const allSectors = useMemo(() => layout(items.slice(0, SECTOR_UNIVERSE_SIZE), 1000, 600, null, sectorChange).sectors.sort((a, b) => b.cap - a.cap), [items, sectorChange]);

  const market = useMarketColors();
  // Diverging: loss ← gray → gain, saturating at ±3%. The square-root stretch gives typical
  // ±0.2–1% days visible color instead of near-gray.
  const changeScale = useMemo(
    () => scaleLinear<string>().domain([-1, 0, 1]).range([market.lossFill, NEUTRAL, market.gainFill]).interpolate(interpolateLab).clamp(true),
    [market],
  );
  const stretch = (value: number) => Math.sign(value) * Math.sqrt(Math.min(Math.abs(value), 3) / 3);
  const colorFor = (item: HeatmapItem) =>
    mode === 'change'
      ? item.changePct === null ? NEUTRAL : changeScale(stretch(item.changePct))
      : item.score === null ? '#1b1d22' : scoreScale(item.score);
  const legend = mode === 'change'
    ? [-3, -1, -0.25, 0, 0.25, 1, 3].map((value) => ({ label: value === 0 ? '0' : `${value > 0 ? '+' : ''}${value}%`, color: changeScale(stretch(value)) }))
    : [30, 45, 60, 75, 90].map((value) => ({ label: String(value), color: scoreScale(value) }));

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AnimatePresence initial={false}>
            {focus ? (
              <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}>
                <Button size="xs" variant="outline" icon={<ArrowLeft className="size-3" />} onClick={() => setFocus(null)}>
                  All sectors
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <span className="text-[12px] text-muted">{focus ? focus : 'US market by sector · sized by market value'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'change', label: SESSION_CHANGE_LABEL[session].long },
              { value: 'score', label: 'SilverNote Score' },
            ]}
          />
          <div className="hidden items-center gap-px sm:flex" aria-label="Color scale">
            {legend.map((stop) => (
              <span key={stop.label} className="flex h-4 min-w-8 items-center justify-center px-1 font-mono text-[9.5px] text-white/85" style={{ background: stop.color }}>
                {stop.label}
              </span>
            ))}
          </div>
          <Button size="xs" variant={showTable ? 'secondary' : 'ghost'} icon={<Table2 className="size-3" />} onClick={() => setShowTable((value) => !value)}>
            Table
          </Button>
        </div>
      </div>

      {showTable ? (
        <div className="overflow-hidden rounded-sm border border-line">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-1 text-left text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Sector</th>
                <th className="px-3 py-2 text-right font-medium">Market value</th>
                <th className="px-3 py-2 text-right font-medium">Cap-weighted day change</th>
              </tr>
            </thead>
            <tbody>
              {allSectors.map((sector) => (
                <tr key={sector.key} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink">{sector.sector}</td>
                  <td className="num px-3 py-1.5 text-right text-ink-2">${compactNumber(sector.cap)}</td>
                  <td className={cn('num px-3 py-1.5 text-right', (sector.change ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>{signedPct(sector.change, 2, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-sm bg-surface-1"
          style={{ height }}
          onPointerLeave={() => setHover(null)}
        >
          {sectors.map((sector) =>
            focus ? null : (
              <button
                key={`s-${sector.key}`}
                type="button"
                onClick={() => setFocus(sector.sector)}
                className="group absolute z-[2] flex items-center gap-1.5 overflow-hidden px-1.5 text-left transition-[left,top,width] duration-500 ease-[var(--ease-out-expo)]"
                style={{ left: sector.x, top: sector.y, width: sector.w, height: HEADER }}
                title={`Zoom into ${sector.sector}`}
              >
                <span className="truncate font-mono text-[9.5px] font-medium tracking-wider text-ink-2 uppercase group-hover:text-ink">{sector.sector}</span>
                {sector.w > 150 ? (
                  <span className={cn('num shrink-0 text-[9.5px]', (sector.change ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>
                    {signedPct(sector.change, 2, true)}
                  </span>
                ) : null}
              </button>
            ),
          )}
          {tiles.map((tile) => {
            const area = tile.w * tile.h;
            const showSymbol = tile.w > 26 && tile.h > 15;
            const showChange = tile.w > 40 && tile.h > 32;
            const fontSize = Math.max(9, Math.min(22, Math.sqrt(area) / 5.2));
            const isHover = hover?.tile.key === tile.key;
            const fill = colorFor(tile.item);
            const darkText = luminance(fill) > 0.45;
            return (
              <button
                key={tile.key}
                type="button"
                aria-label={`${tile.symbol} ${tile.item.name}, ${signedPct(tile.item.changePct, 2, true)}`}
                onPointerMove={(event) => {
                  const bounds = containerRef.current?.getBoundingClientRect();
                  if (!bounds) return;
                  setHover({ tile, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
                }}
                onFocus={() => setHover({ tile, x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 })}
                onClick={() => startTransition(() => router.push(`/company/${tile.symbol}`))}
                className={cn(
                  'absolute flex flex-col items-center justify-center overflow-hidden rounded-[2px] text-center transition-[left,top,width,height,transform,box-shadow,filter] duration-500 ease-[var(--ease-out-expo)] outline-none',
                  isHover ? 'z-20 scale-[1.06] shadow-[0_0_0_1.5px_#cdd4de,0_12px_30px_-6px_rgba(0,0,0,0.9),0_0_24px_rgba(205,212,222,0.27)] brightness-125' : 'z-[1]',
                )}
                style={{ left: tile.x, top: tile.y, width: tile.w, height: tile.h, background: fill }}
              >
                {tile.w > 64 && tile.h > 58 ? (
                  <CompanyLogo symbol={tile.symbol} size={Math.round(Math.min(30, Math.max(16, Math.min(tile.w, tile.h) * 0.24)))} className="mb-1 border-white/25" />
                ) : null}
                {showSymbol ? (
                  <span className={cn('leading-none font-semibold tracking-tight', darkText ? 'text-[#0b0c0f]' : 'text-white/95')} style={{ fontSize }}>
                    {tile.symbol}
                  </span>
                ) : null}
                {showChange ? (
                  <span className={cn('num mt-0.5 leading-none', darkText ? 'text-[#0b0c0f]/70' : 'text-white/75')} style={{ fontSize: Math.max(8.5, fontSize * 0.58) }}>
                    {mode === 'change' ? signedPct(tile.item.changePct, 2, true) : tile.item.score ?? '—'}
                  </span>
                ) : null}
              </button>
            );
          })}
          <AnimatePresence>
            {hover ? (
              <motion.div
                key="tip"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="pointer-events-none absolute z-30 w-56 rounded-sm border border-line-strong bg-surface-3/95 p-2.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.95)] backdrop-blur"
                style={{
                  // Flip to the other side of the cursor rather than sliding over it.
                  left: hover.x + 14 + 224 > size.width ? Math.max(4, hover.x - 14 - 224) : hover.x + 14,
                  top: hover.y + 14 + 120 > size.height ? Math.max(4, hover.y - 14 - 120) : hover.y + 14,
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] font-semibold text-ink">{hover.tile.symbol}</span>
                  <span className={cn('num text-[12px] font-medium', (hover.tile.item.changePct ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>
                    {signedPct(hover.tile.item.changePct, 2, true)}
                  </span>
                </div>
                <div className="truncate text-[11.5px] text-ink-2">{hover.tile.item.name}</div>
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10.5px]">
                  <div>
                    <div className="text-faint">Price</div>
                    <div className="num text-ink">{price(hover.tile.item.price)}</div>
                  </div>
                  <div>
                    <div className="text-faint">Mkt value</div>
                    <div className="num text-ink">${compactNumber(hover.tile.item.marketCap)}</div>
                  </div>
                  <div>
                    <div className="text-faint">Score</div>
                    <div className="num text-ink">{hover.tile.item.score ?? '—'}</div>
                  </div>
                </div>
                <div className="mt-1.5 truncate text-[10.5px] text-faint">{hover.tile.item.industry}</div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-[10.5px] text-muted">
        {mode === 'change' ? (
          <div className="flex items-center gap-2">
            <span className="num">−3%</span>
            <div className="h-1.5 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${market.lossFill}, ${NEUTRAL}, ${market.gainFill})` }} />
            <span className="num">+3%</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="num">30</span>
            <div className="h-1.5 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${SCORE_RAMP.join(', ')})` }} />
            <span className="num">90</span>
            <span className="text-faint">· unscored tiles are dark</span>
          </div>
        )}
        <span className="text-faint">Click a sector to zoom · click a tile to open the company</span>
      </div>
    </div>
  );
}

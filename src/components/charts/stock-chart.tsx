'use client';

import { Activity, Eraser, Minus, PenLine, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';

import { PriceChart, type ChartDrawing, type ChartMarker, type ChartOverlay } from '@/components/charts/price-chart';
import { Button, IconButton } from '@/components/ui/button';
import { Segmented, Skeleton } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import type { Candle } from '@/lib/data/types';
import { bollinger, ema, macd, rsi, sma } from '@/lib/finance/indicators';
import { SERIES_COLORS } from '@/lib/theme';
import { cn } from '@/lib/utils';

export const CHART_RANGES = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y', '10y'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

const INDICATORS = [
  { id: 'sma20', label: 'SMA 20' },
  { id: 'sma50', label: 'SMA 50' },
  { id: 'sma200', label: 'SMA 200' },
  { id: 'ema20', label: 'EMA 20' },
  { id: 'bb', label: 'Bollinger (20, 2)' },
  { id: 'rsi', label: 'RSI (14)' },
  { id: 'macd', label: 'MACD (12, 26, 9)' },
] as const;
type IndicatorId = (typeof INDICATORS)[number]['id'];

const COLORS: Record<string, string> = { sma20: '#e8c268', sma50: '#9fd8ff', sma200: '#c79bff', ema20: '#7fe0b4', bb: '#8a93a3', rsi: '#e8c268', macd: '#9fd8ff', signal: '#ff9f6b' };

function readDrawings(symbol: string): ChartDrawing[] {
  try {
    return JSON.parse(localStorage.getItem(`silvernote.drawings.${symbol}`) ?? '[]') as ChartDrawing[];
  } catch {
    return [];
  }
}

function writeDrawings(symbol: string, drawings: ChartDrawing[]) {
  try {
    localStorage.setItem(`silvernote.drawings.${symbol}`, JSON.stringify(drawings));
  } catch {
    // storage unavailable: drawings last for the session
  }
}

/** A button with a small panel under it; closes on an outside click or Escape. */
function Popover({ label, active, icon, children }: { label: string; active: boolean; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button size="xs" variant={active ? 'secondary' : 'ghost'} icon={icon} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {label}
      </Button>
      {open ? <div className="panel absolute top-full right-0 z-40 mt-1.5 bg-surface-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)]">{children}</div> : null}
    </div>
  );
}

/**
 * Studies for a price chart: indicator overlays and panes, compared tickers (switches to % scale)
 * and drawing tools (price levels, trend lines; kept per symbol in this browser).
 */
export function useChartStudies(symbol: string, candles: Candle[], range: string) {
  const [indicators, setIndicators] = useState<IndicatorId[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [tool, setTool] = useState<'none' | 'hline' | 'trend'>('none');
  const [pending, setPending] = useState<{ t: number; price: number } | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (loadedFor !== symbol) {
    setLoadedFor(symbol);
    setDrawings(typeof window === 'undefined' ? [] : readDrawings(symbol));
    setCompare([]);
  }
  useEffect(() => {
    if (loadedFor === symbol) writeDrawings(symbol, drawings);
  }, [drawings, symbol, loadedFor]);

  const { data: compared } = useSWR<Array<{ symbol: string; candles: Candle[] }>>(
    compare.length ? ['compare', range, ...compare] : null,
    () => Promise.all(compare.map(async (other) => ({ symbol: other, candles: ((await fetch(`/api/company/${other}/candles?range=${range}`).then((response) => response.json())) as { candles: Candle[] }).candles ?? [] }))),
  );

  const overlays = useMemo<ChartOverlay[]>(() => {
    const bars = [...candles].sort((a, b) => a.t - b.t).map((bar) => ({ t: bar.t, c: bar.c }));
    const out: ChartOverlay[] = [];
    let pane = 1;
    for (const id of indicators) {
      if (id.startsWith('sma')) out.push({ id, label: id.toUpperCase(), color: COLORS[id], points: sma(bars, Number(id.slice(3))) });
      if (id === 'ema20') out.push({ id, label: 'EMA 20', color: COLORS[id], points: ema(bars, 20) });
      if (id === 'bb') {
        const bands = bollinger(bars);
        out.push({ id: 'bb-u', label: 'BB upper', color: COLORS.bb, points: bands.upper, dashed: true, width: 1 });
        out.push({ id: 'bb-m', label: 'BB mid', color: COLORS.bb, points: bands.middle, width: 1 });
        out.push({ id: 'bb-l', label: 'BB lower', color: COLORS.bb, points: bands.lower, dashed: true, width: 1 });
      }
      if (id === 'rsi') out.push({ id, label: 'RSI', color: COLORS.rsi, points: rsi(bars), pane: pane++ });
      if (id === 'macd') {
        const result = macd(bars);
        const macdPane = pane++;
        out.push({ id: 'macd-h', label: 'Hist', color: COLORS.macd, points: result.histogram, pane: macdPane, kind: 'histogram' });
        out.push({ id: 'macd-l', label: 'MACD', color: COLORS.macd, points: result.line, pane: macdPane });
        out.push({ id: 'macd-s', label: 'Signal', color: COLORS.signal, points: result.signal, pane: macdPane });
      }
    }
    (compared ?? []).forEach((item, index) => {
      // Only bars on the main chart's timestamps, so the % baselines line up.
      const times = new Set(bars.map((bar) => bar.t));
      out.push({ id: `cmp-${item.symbol}`, label: item.symbol, color: SERIES_COLORS[index % SERIES_COLORS.length], points: item.candles.filter((bar) => times.has(bar.t)).map((bar) => ({ t: bar.t, value: bar.c })), width: 2 });
    });
    return out;
  }, [candles, indicators, compared]);

  const onPick = useCallback(
    (point: { t: number; price: number }) => {
      if (tool === 'hline') {
        setDrawings((current) => [...current, { id: `${Date.now()}`, kind: 'hline', price: Number(point.price.toFixed(2)) }]);
        setTool('none');
      } else if (tool === 'trend') {
        if (!pending) setPending(point);
        else {
          setDrawings((current) => [...current, { id: `${Date.now()}`, kind: 'trend', from: pending, to: point }]);
          setPending(null);
          setTool('none');
        }
      }
    },
    [tool, pending],
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1">
      <Popover label={`Indicators${indicators.length ? ` ${indicators.length}` : ''}`} active={indicators.length > 0} icon={<Activity className="size-3" />}>
        <div className="flex w-48 flex-col p-1">
            {INDICATORS.map((item) => {
              const on = indicators.includes(item.id);
              return (
                <button
                  key={item.id}
                  className={cn('flex items-center justify-between rounded-xs px-2 py-1.5 text-left text-[12px] hover:bg-white/5', on ? 'text-ink' : 'text-ink-2')}
                  onClick={() => setIndicators((current) => (on ? current.filter((id) => id !== item.id) : [...current, item.id]))}
                >
                  {item.label}
                  {on ? <span className="size-2 rounded-full" style={{ background: COLORS[item.id] }} /> : null}
                </button>
              );
            })}
        </div>
      </Popover>
      <Popover label={`Compare${compare.length ? ` ${compare.length}` : ''}`} active={compare.length > 0} icon={<Plus className="size-3" />}>
        <div className="flex w-56 flex-col gap-1.5 p-2">
            {compare.map((other, index) => (
              <div key={other} className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
                  <span className="font-mono">{other}</span>
                </span>
                <IconButton label={`Remove ${other}`} size="xs" onClick={() => setCompare((current) => current.filter((item) => item !== other))}>
                  <X className="size-3" />
                </IconButton>
              </div>
            ))}
            <TickerSearch onPick={(other) => setCompare((current) => (current.includes(other) || other === symbol ? current : [...current, other].slice(0, 5)))} placeholder="Add ticker or SPY…" />
        </div>
      </Popover>
      <IconButton label="Draw a price level" size="xs" variant={tool === 'hline' ? 'secondary' : 'ghost'} onClick={() => setTool((current) => (current === 'hline' ? 'none' : 'hline'))}>
        <Minus className="size-3.5" />
      </IconButton>
      <IconButton label="Draw a trend line (two clicks)" size="xs" variant={tool === 'trend' ? 'secondary' : 'ghost'} onClick={() => { setPending(null); setTool((current) => (current === 'trend' ? 'none' : 'trend')); }}>
        <PenLine className="size-3.5" />
      </IconButton>
      {drawings.length ? (
        <IconButton label="Clear drawings" size="xs" onClick={() => setDrawings([])}>
          <Eraser className="size-3.5" />
        </IconButton>
      ) : null}
      {tool !== 'none' ? <span className="text-[10.5px] text-brand-soft">{tool === 'hline' ? 'Click a price' : pending ? 'Click the second point' : 'Click the first point'}</span> : null}
    </div>
  );

  return { toolbar, overlays, percentMode: compare.length > 0, drawings, onPick: tool === 'none' ? undefined : onPick };
}

/** A self-contained chart for one symbol (used by the terminal's chart panels). With `fill`, the chart
 *  grows to the height of its parent instead of using `height`. */
export function StockChart({
  symbol,
  height = 320,
  fill = false,
  markers,
  targetPrice,
}: {
  symbol: string;
  height?: number;
  fill?: boolean;
  markers?: ChartMarker[];
  targetPrice?: number | null;
}) {
  const [range, setRange] = useState<ChartRange>('1y');
  const [mode, setMode] = useState<'area' | 'candles'>('area');
  const { data } = useSWR<{ candles: Candle[]; range: string; previousClose?: number | null }>(`/api/company/${symbol}/candles?range=${range}`);
  const studies = useChartStudies(symbol, data?.candles ?? [], range);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxHeight, setBoxHeight] = useState<number | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!fill || !box) return;
    const observer = new ResizeObserver(([entry]) => setBoxHeight(Math.floor(entry.contentRect.height)));
    observer.observe(box);
    return () => observer.disconnect();
  }, [fill]);
  const chartHeight = fill ? Math.max(160, boxHeight ?? height) : height;
  return (
    <div className={cn('flex flex-col gap-2', fill && 'h-full')}>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <Segmented size="xs" value={range} onChange={setRange} options={CHART_RANGES.map((value) => ({ value, label: value.toUpperCase() }))} />
        <div className="flex items-center gap-1">
          {studies.toolbar}
          <Segmented size="xs" value={mode} onChange={setMode} options={[{ value: 'area', label: 'Line' }, { value: 'candles', label: 'Candles' }]} />
        </div>
      </div>
      <div ref={boxRef} className={cn(fill && 'min-h-0 flex-1 overflow-hidden')}>
        {data?.candles.length ? (
          <PriceChart
            candles={data.candles}
            baseline={data.range === '1d' ? data.previousClose : null}
            mode={mode}
            height={chartHeight}
            animationKey={symbol}
            rangeKey={data.range}
            intraday={['1d', '1w', '1m', '3m'].includes(data.range)}
            markers={markers}
            targetPrice={targetPrice}
            overlays={studies.overlays}
            percentMode={studies.percentMode}
            drawings={studies.drawings}
            onPick={studies.onPick}
          />
        ) : (
          <div style={{ height: chartHeight }}>
            <Skeleton className="h-full w-full" />
          </div>
        )}
      </div>
    </div>
  );
}

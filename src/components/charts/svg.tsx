'use client';

import { scaleBand, scaleLinear } from 'd3';
import { animate, scroll, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { NEUTRAL_MARK, SERIES_COLORS, SILVER } from '@/lib/theme';
import { cn } from '@/lib/utils';

export { NEUTRAL_MARK, SERIES_COLORS };
export const BRAND = SILVER.base;
const GRID = 'rgba(255,255,255,0.06)';
const AXIS_TEXT = '#858a95';

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Scroll-linked reveal: exposes --reveal (0→1) to children, scrubbed by scroll position (motion's
 * scroll()). Bars scale up and lines draw as the chart travels into view.
 */
export function ScrollReveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const set = (value: number) => element.style.setProperty('--reveal', value.toFixed(3));
    if (reduced) {
      set(1);
      return;
    }
    // Charts already on screen when mounted should not wait for a scroll.
    if (element.getBoundingClientRect().top < window.innerHeight * 0.72) {
      const controls = animate(0, 1, { duration: 0.8, ease: [0.16, 1, 0.3, 1], onUpdate: set });
      return () => controls.stop();
    }
    set(0);
    let done = false;
    const stop = scroll(
      (progress: number) => {
        if (done) return;
        set(progress);
        if (progress >= 1) done = true;
      },
      { target: element, offset: ['start 96%', 'start 72%'] },
    );
    return () => stop();
  }, [reduced]);
  return (
    <div ref={ref} className={className} style={{ ['--reveal' as string]: reduced ? 1 : 0 }}>
      {children}
    </div>
  );
}

/** End labels hug the plot edges instead of centering on them, so they never spill outside the card. */
function edgeAnchor(index: number, count: number) {
  return count > 1 && index === 0 ? 'start' : count > 1 && index === count - 1 ? 'end' : 'middle';
}

export function Legend({ items, className }: { items: Array<{ label: string; color: string; kind?: 'rect' | 'line'; dashed?: boolean }>; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2', className)}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {item.kind === 'line' ? (
            <span
              className="h-[2px] w-3.5 rounded-full"
              style={{ background: item.dashed ? `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 6px)` : item.color }}
            />
          ) : (
            <span className="size-2.5 rounded-[2px]" style={{ background: item.color }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}

type TooltipRow = { label: string; value: string; color?: string; kind?: 'rect' | 'line' };

function Tooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: TooltipRow[] }) {
  const left = Math.min(Math.max(8, x + 12), width - 188);
  return (
    <div
      className="pointer-events-none absolute z-20 w-44 rounded-sm border border-line-strong bg-surface-3/95 px-2.5 py-2 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.95)] backdrop-blur"
      style={{ left, top: Math.max(0, y - 10) }}
    >
      <div className="mb-1 text-[10.5px] text-muted">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-2 py-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-2">
            {row.color ? <span className="h-[2px] w-2.5 shrink-0 rounded-full" style={{ background: row.color }} /> : null}
            <span className="truncate">{row.label}</span>
          </span>
          <span className="num text-[12px] font-medium text-ink">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function niceTicks(min: number, max: number, count = 4) {
  const scale = scaleLinear().domain([min, max]).nice(count);
  return { domain: scale.domain() as [number, number], ticks: scale.ticks(count) };
}

/** A caller-supplied y domain (e.g. one being animated) is used as is; otherwise the data's nice domain. */
function axis(override: [number, number] | undefined, fallback: () => [number, number]) {
  return override ? { domain: override, ticks: scaleLinear().domain(override).ticks(4) } : niceTicks(...fallback());
}

export function columnDomain(series: ColumnSeries[]): [number, number] {
  const values = series.flatMap((item) => item.values).filter((value): value is number => typeof value === 'number');
  return niceTicks(Math.min(0, ...values), Math.max(0, ...values)).domain;
}

export function lineDomain(series: LineSeries[], zeroLine = false): [number, number] {
  const values = series.flatMap((item) => item.values).filter((value): value is number => typeof value === 'number');
  const extent = values.length ? [Math.min(...values, zeroLine ? 0 : Infinity), Math.max(...values, zeroLine ? 0 : -Infinity)] : [0, 1];
  return niceTicks(extent[0], extent[1] === extent[0] ? extent[0] + 1 : extent[1]).domain;
}

function waterfallBars(steps: WaterfallStep[]) {
  const result: Array<WaterfallStep & { from: number; to: number }> = [];
  let running = 0;
  for (const step of steps) {
    if (typeof step.value !== 'number') continue;
    if (step.kind === 'start' || step.kind === 'total') {
      running = step.value;
      result.push({ ...step, from: 0, to: step.value });
    } else {
      result.push({ ...step, from: running, to: running + step.value });
      running += step.value;
    }
  }
  return result;
}

export function waterfallDomain(steps: WaterfallStep[]): [number, number] {
  const all = waterfallBars(steps).flatMap((bar) => [bar.from, bar.to]);
  return niceTicks(Math.min(0, ...all), Math.max(0, ...all)).domain;
}

export type ColumnSeries = { label: string; values: Array<number | null>; color?: string };

/** Grouped columns over categories (periods). Supports negatives around a zero baseline. */
export function ColumnChart({
  categories,
  series,
  format,
  height = 220,
  highlightLast = false,
  className,
  yDomain,
}: {
  categories: string[];
  series: ColumnSeries[];
  format: (value: number) => string;
  height?: number;
  highlightLast?: boolean;
  className?: string;
  yDomain?: [number, number];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const margin = { top: 10, right: 8, bottom: 22, left: 52 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;
  const { domain, ticks } = axis(yDomain, () => columnDomain(series));
  const y = scaleLinear().domain(domain).range([innerHeight, 0]);
  const x = scaleBand<number>().domain(categories.map((_, index) => index)).range([0, innerWidth]).paddingInner(0.28).paddingOuter(0.12);
  const groupWidth = x.bandwidth();
  const barWidth = Math.min(24, Math.max(3, (groupWidth - (series.length - 1) * 2) / series.length));
  const groupInner = barWidth * series.length + (series.length - 1) * 2;
  const zero = y(0);
  const colors = series.map((item, index) => item.color ?? (series.length === 1 ? BRAND : (SERIES_COLORS[index] ?? NEUTRAL_MARK)));

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {series.length > 1 ? <Legend items={series.map((item, index) => ({ label: item.label, color: colors[index] }))} /> : null}
      <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setHover(null)}>
        {width > 0 ? (
          <svg width={width} height={height} className="overflow-visible">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {ticks.map((tick) => (
                <g key={tick} transform={`translate(0,${y(tick)})`}>
                  <line x1={0} x2={innerWidth} stroke={tick === 0 ? 'rgba(255,255,255,0.16)' : GRID} />
                  <text x={-8} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT} className="num">
                    {format(tick)}
                  </text>
                </g>
              ))}
              {categories.map((category, categoryIndex) => {
                const groupX = (x(categoryIndex) ?? 0) + (groupWidth - groupInner) / 2;
                return (
                  <g key={categoryIndex}>
                    <rect
                      x={(x(categoryIndex) ?? 0) - 4}
                      y={0}
                      width={groupWidth + 8}
                      height={innerHeight}
                      fill={hover === categoryIndex ? 'rgba(255,255,255,0.035)' : 'transparent'}
                      onPointerEnter={() => setHover(categoryIndex)}
                    />
                    {series.map((item, seriesIndex) => {
                      const value = item.values[categoryIndex];
                      if (typeof value !== 'number') return null;
                      const top = value >= 0 ? y(value) : zero;
                      const barHeight = Math.max(1, Math.abs(y(value) - zero));
                      const isHighlight = highlightLast && categoryIndex === categories.length - 1;
                      const radius = Math.min(4, barHeight / 2, barWidth / 2);
                      const bx = groupX + seriesIndex * (barWidth + 2);
                      // Rounded data-end, square at the baseline.
                      const path =
                        value >= 0
                          ? `M${bx},${top + barHeight} V${top + radius} Q${bx},${top} ${bx + radius},${top} H${bx + barWidth - radius} Q${bx + barWidth},${top} ${bx + barWidth},${top + radius} V${top + barHeight} Z`
                          : `M${bx},${top} V${top + barHeight - radius} Q${bx},${top + barHeight} ${bx + radius},${top + barHeight} H${bx + barWidth - radius} Q${bx + barWidth},${top + barHeight} ${bx + barWidth},${top + barHeight - radius} V${top} Z`;
                      return (
                        <path
                          key={item.label}
                          d={path}
                          fill={colors[seriesIndex]}
                          opacity={hover === null || hover === categoryIndex ? (highlightLast && !isHighlight ? 0.55 : 1) : 0.4}
                          style={{ transformOrigin: `0px ${zero}px`, transform: 'scaleY(var(--reveal, 1))', transition: 'opacity 150ms' }}
                          pointerEvents="none"
                        />
                      );
                    })}
                    {categories.length <= 14 || categoryIndex % Math.ceil(categories.length / 12) === 0 ? (
                      <text x={(x(categoryIndex) ?? 0) + groupWidth / 2} y={innerHeight + 15} textAnchor="middle" fontSize={10} fill={hover === categoryIndex ? '#eceef1' : AXIS_TEXT}>
                        {category}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        ) : null}
        {hover !== null && width > 0 ? (
          <Tooltip
            x={margin.left + (x(hover) ?? 0) + groupWidth}
            y={margin.top}
            width={width}
            title={categories[hover]}
            rows={series.map((item, index) => ({
              label: item.label,
              value: typeof item.values[hover] === 'number' ? format(item.values[hover] as number) : '—',
              color: colors[index],
            }))}
          />
        ) : null}
      </div>
    </div>
  );
}

export type LineSeries = { label: string; values: Array<number | null>; color?: string; dashed?: boolean; emphasis?: boolean };

/** Multi-series line chart over categories with a crosshair tooltip and end labels (≤ 4 series). */
export function LineChart({
  categories,
  series,
  format,
  height = 200,
  className,
  endLabels = true,
  zeroLine = false,
  time,
  yDomain,
}: {
  categories: string[];
  series: LineSeries[];
  format: (value: number) => string;
  height?: number;
  className?: string;
  endLabels?: boolean;
  zeroLine?: boolean;
  /** Places points by time on a fixed axis (e.g. a whole session) instead of spreading them evenly, so a partial day fills in from the left. */
  time?: { values: number[]; domain: [number, number]; ticks: Array<{ at: number; label: string }> };
  yDomain?: [number, number];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const showEnd = endLabels && series.length <= 4;
  const margin = { top: 10, right: showEnd ? 64 : 10, bottom: 22, left: 52 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;
  const { domain, ticks } = axis(yDomain, () => lineDomain(series, zeroLine));
  const y = scaleLinear().domain(domain).range([innerHeight, 0]);
  const step = categories.length > 1 ? innerWidth / (categories.length - 1) : 0;
  const xTime = time ? scaleLinear().domain(time.domain).range([0, innerWidth]) : null;
  const xAt = (index: number) => (time && xTime ? xTime(time.values[index] ?? time.domain[0]) : categories.length > 1 ? index * step : innerWidth / 2);
  const nearest = (relative: number) => {
    if (time && xTime) {
      const at = xTime.invert(relative);
      let best = 0;
      time.values.forEach((value, index) => {
        if (Math.abs(value - at) < Math.abs(time.values[best] - at)) best = index;
      });
      return best;
    }
    return Math.max(0, Math.min(categories.length - 1, Math.round(relative / (step || 1))));
  };
  const colors = series.map((item, index) => item.color ?? (series.length === 1 ? BRAND : (SERIES_COLORS[index] ?? NEUTRAL_MARK)));
  // Space labels by their actual length so long date labels never collide.
  const longestLabel = categories.reduce((max, category) => Math.max(max, category.length), 0);
  const labelEvery = Math.ceil(categories.length / Math.max(1, Math.floor(innerWidth / Math.max(56, longestLabel * 6.2 + 14))));

  const paths = series.map((item) => {
    let d = '';
    let started = false;
    item.values.forEach((value, index) => {
      if (typeof value !== 'number') {
        started = false;
        return;
      }
      d += `${started ? 'L' : 'M'}${xAt(index).toFixed(1)},${y(value).toFixed(1)}`;
      started = true;
    });
    return d;
  });

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {series.length > 1 ? <Legend items={series.map((item, index) => ({ label: item.label, color: colors[index], kind: 'line', dashed: item.dashed }))} /> : null}
      <div
        ref={ref}
        className="relative w-full"
        style={{ height }}
        onPointerMove={(event) => {
          if (!categories.length) return;
          const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
          const relative = event.clientX - bounds.left - margin.left;
          setHover(nearest(relative));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 ? (
          <svg width={width} height={height} className="overflow-visible">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {ticks.map((tick) => (
                <g key={tick} transform={`translate(0,${y(tick)})`}>
                  <line x1={0} x2={innerWidth} stroke={tick === 0 && zeroLine ? 'rgba(255,255,255,0.16)' : GRID} />
                  <text x={-8} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT} className="num">
                    {format(tick)}
                  </text>
                </g>
              ))}
              {time
                ? time.ticks.map((tick, index) => (
                    <text key={tick.at} x={xTime?.(tick.at) ?? 0} y={innerHeight + 15} textAnchor={edgeAnchor(index, time.ticks.length)} fontSize={10} fill={AXIS_TEXT}>
                      {tick.label}
                    </text>
                  ))
                : categories.map((category, index) =>
                index % labelEvery === 0 || index === categories.length - 1 ? (
                  <text key={index} x={xAt(index)} y={innerHeight + 15} textAnchor={edgeAnchor(index, categories.length)} fontSize={10} fill={hover === index ? '#eceef1' : AXIS_TEXT}>
                    {category}
                  </text>
                ) : null,
              )}
              {hover !== null ? <line x1={xAt(hover)} x2={xAt(hover)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.25)" /> : null}
              {paths.map((d, index) => (
                <path
                  key={series[index].label}
                  d={d}
                  fill="none"
                  stroke={colors[index]}
                  strokeWidth={series[index].emphasis ? 2.5 : 2}
                  strokeDasharray={series[index].dashed ? '4 4' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={series[index].dashed ? undefined : 1}
                  style={series[index].dashed ? undefined : { strokeDasharray: 1, strokeDashoffset: 'calc(1 - var(--reveal, 1))' }}
                />
              ))}
              {hover !== null
                ? series.map((item, index) => {
                    const value = item.values[hover];
                    if (typeof value !== 'number') return null;
                    return <circle key={item.label} cx={xAt(hover)} cy={y(value)} r={4} fill={colors[index]} stroke="#0f1115" strokeWidth={2} />;
                  })
                : null}
              {showEnd
                ? (() => {
                    const ends = series
                      .map((item, index) => {
                        const lastIndex = item.values.map((value) => typeof value === 'number').lastIndexOf(true);
                        if (lastIndex < 0) return null;
                        const value = item.values[lastIndex] as number;
                        return { index, lastIndex, value, y: y(value), labelY: y(value) };
                      })
                      .filter((end): end is NonNullable<typeof end> => end !== null)
                      .sort((a, b) => a.y - b.y);
                    // Push overlapping labels apart so close end values stay legible.
                    const gap = 13;
                    for (let i = 1; i < ends.length; i++) ends[i].labelY = Math.max(ends[i].labelY, ends[i - 1].labelY + gap);
                    return ends.map((end) => (
                      <g key={series[end.index].label}>
                        <circle cx={xAt(end.lastIndex)} cy={end.y} r={3.5} fill={colors[end.index]} stroke="#0f1115" strokeWidth={2} />
                        <text x={innerWidth + 8} y={end.labelY} dy="0.32em" fontSize={10.5} fill={colors[end.index]} className="num">
                          {format(end.value)}
                        </text>
                      </g>
                    ));
                  })()
                : null}
            </g>
          </svg>
        ) : null}
        {hover !== null && width > 0 ? (
          <Tooltip
            x={margin.left + xAt(hover)}
            y={margin.top}
            width={width}
            title={categories[hover]}
            rows={series.map((item, index) => ({
              label: item.label,
              value: typeof item.values[hover] === 'number' ? format(item.values[hover] as number) : '—',
              color: colors[index],
            }))}
          />
        ) : null}
      </div>
    </div>
  );
}

export type WaterfallStep = { label: string; value: number | null; kind: 'start' | 'delta' | 'total'; emphasis?: boolean };

/** Bridge from a starting amount through additions/deductions to subtotals. */
export function Waterfall({
  steps,
  format,
  height = 240,
  className,
  yDomain,
}: {
  steps: WaterfallStep[];
  format: (value: number) => string;
  height?: number;
  className?: string;
  yDomain?: [number, number];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const bars = useMemo(() => waterfallBars(steps), [steps]);
  const margin = { top: 16, right: 8, bottom: 34, left: 52 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;
  const { domain, ticks } = axis(yDomain, () => waterfallDomain(steps));
  const y = scaleLinear().domain(domain).range([innerHeight, 0]);
  const x = scaleBand<number>().domain(bars.map((_, index) => index)).range([0, innerWidth]).paddingInner(0.3).paddingOuter(0.1);
  const barWidth = Math.min(40, x.bandwidth());

  return (
    <div ref={ref} className={cn('relative w-full', className)} style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line x1={0} x2={innerWidth} stroke={tick === 0 ? 'rgba(255,255,255,0.16)' : GRID} />
                <text x={-8} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT} className="num">
                  {format(tick)}
                </text>
              </g>
            ))}
            {bars.map((bar, index) => {
              const cx = (x(index) ?? 0) + (x.bandwidth() - barWidth) / 2;
              const top = y(Math.max(bar.from, bar.to));
              const barHeight = Math.max(1, Math.abs(y(bar.from) - y(bar.to)));
              const color =
                bar.kind === 'delta' ? ((bar.value as number) >= 0 ? 'var(--color-gain-fill)' : 'var(--color-loss-fill)') : bar.emphasis ? BRAND : NEUTRAL_MARK;
              const next = bars[index + 1];
              return (
                <g key={`${bar.label}-${index}`} onPointerEnter={() => setHover(index)}>
                  <rect x={(x(index) ?? 0) - 3} y={0} width={x.bandwidth() + 6} height={innerHeight} fill={hover === index ? 'rgba(255,255,255,0.035)' : 'transparent'} />
                  <rect
                    x={cx}
                    y={top}
                    width={barWidth}
                    height={barHeight}
                    rx={2}
                    fill={color}
                    style={{ transformOrigin: `0px ${y(bar.from)}px`, transform: 'scaleY(var(--reveal, 1))' }}
                  />
                  {next && next.kind === 'delta' ? (
                    <line x1={cx + barWidth} x2={(x(index + 1) ?? 0) + (x.bandwidth() - barWidth) / 2} y1={y(bar.to)} y2={y(bar.to)} stroke="rgba(255,255,255,0.18)" />
                  ) : null}
                  <text x={(x(index) ?? 0) + x.bandwidth() / 2} y={innerHeight + 14} textAnchor="middle" fontSize={9.5} fill={hover === index ? '#eceef1' : AXIS_TEXT}>
                    {bar.label.length > 14 ? `${bar.label.slice(0, 13)}…` : bar.label}
                  </text>
                  <text x={(x(index) ?? 0) + x.bandwidth() / 2} y={innerHeight + 26} textAnchor="middle" fontSize={9.5} fill="#b9bdc6" className="num">
                    {bar.kind === 'delta' && (bar.value as number) > 0 ? '+' : ''}
                    {format(bar.value as number)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      ) : null}
    </div>
  );
}

export type StackSegment = { label: string; values: Array<number | null>; color: string };

/** Stacked columns (positive parts) with 2px surface gaps; optional 100% normalization. */
export function StackedColumns({
  categories,
  segments,
  format,
  height = 240,
  normalize = false,
  className,
}: {
  categories: string[];
  segments: StackSegment[];
  format: (value: number) => string;
  height?: number;
  normalize?: boolean;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const margin = { top: 8, right: 8, bottom: 22, left: 52 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;
  const totals = categories.map((_, index) => segments.reduce((sum, segment) => sum + Math.max(0, segment.values[index] ?? 0), 0));
  const { domain, ticks } = niceTicks(0, normalize ? 1 : Math.max(1, ...totals));
  const y = scaleLinear().domain(domain).range([innerHeight, 0]);
  const x = scaleBand<number>().domain(categories.map((_, index) => index)).range([0, innerWidth]).paddingInner(0.35).paddingOuter(0.15);
  const barWidth = Math.min(36, x.bandwidth());

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Legend items={segments.map((segment) => ({ label: segment.label, color: segment.color }))} />
      <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setHover(null)}>
        {width > 0 ? (
          <svg width={width} height={height}>
            <g transform={`translate(${margin.left},${margin.top})`}>
              {ticks.map((tick) => (
                <g key={tick} transform={`translate(0,${y(tick)})`}>
                  <line x1={0} x2={innerWidth} stroke={GRID} />
                  <text x={-8} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT} className="num">
                    {normalize ? `${Math.round(tick * 100)}%` : format(tick)}
                  </text>
                </g>
              ))}
              {categories.map((category, index) => {
                let base = 0;
                const total = totals[index] || 1;
                const bx = (x(index) ?? 0) + (x.bandwidth() - barWidth) / 2;
                return (
                  <g key={index} onPointerEnter={() => setHover(index)}>
                    <rect x={(x(index) ?? 0) - 4} y={0} width={x.bandwidth() + 8} height={innerHeight} fill={hover === index ? 'rgba(255,255,255,0.035)' : 'transparent'} />
                    <g style={{ transformOrigin: `0px ${innerHeight}px`, transform: 'scaleY(var(--reveal, 1))' }}>
                      {segments.map((segment) => {
                        const raw = Math.max(0, segment.values[index] ?? 0);
                        const value = normalize ? raw / total : raw;
                        if (!value) return null;
                        const top = y(base + value);
                        const segmentHeight = y(base) - top;
                        base += value;
                        return <rect key={segment.label} x={bx} y={top} width={barWidth} height={Math.max(0, segmentHeight - 2)} fill={segment.color} rx={1.5} />;
                      })}
                    </g>
                    <text x={(x(index) ?? 0) + x.bandwidth() / 2} y={innerHeight + 15} textAnchor="middle" fontSize={10} fill={hover === index ? '#eceef1' : AXIS_TEXT}>
                      {category}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        ) : null}
        {hover !== null && width > 0 ? (
          <Tooltip
            x={margin.left + (x(hover) ?? 0) + x.bandwidth()}
            y={margin.top}
            width={width}
            title={categories[hover]}
            rows={[...segments].reverse().map((segment) => ({
              label: segment.label,
              value: typeof segment.values[hover] === 'number' ? format(segment.values[hover] as number) : '—',
              color: segment.color,
            }))}
          />
        ) : null}
      </div>
    </div>
  );
}

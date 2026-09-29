'use client';

import { scaleLinear } from 'd3';
import { useMemo, useState, type ReactNode } from 'react';

import { useWidth } from '@/components/charts/svg';
import { useTweened } from '@/components/learn/tween';
import { cn } from '@/lib/utils';

export type Point = [number, number];

export type Layer =
  | { type: 'line'; points: Point[]; color: string; width?: number; dashed?: boolean; opacity?: number }
  | { type: 'area'; upper: Point[]; lower: Point[]; color: string; opacity?: number }
  | { type: 'scatter'; points: Point[]; color: string; r?: number; opacity?: number }
  | { type: 'bars'; bars: Array<{ x0: number; x1: number; y: number; color: string }> }
  | { type: 'vline'; x: number; color: string; label?: string; dashed?: boolean }
  | { type: 'hline'; y: number; color: string; label?: string; dashed?: boolean }
  | { type: 'dot'; x: number; y: number; color: string; label?: string; r?: number };

const GRID = 'rgba(255,255,255,0.06)';
const AXIS = '#858a95';

function extent(values: number[], fallback: [number, number]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return fallback;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? [min - 1, max + 1] : [min, max];
}

/**
 * Small general-purpose SVG chart for lesson widgets: lines, bands, scatter, histogram bars and
 * labelled reference lines on linear axes, with an optional hover crosshair.
 */
export function XYChart({
  layers,
  height = 240,
  xFormat,
  yFormat,
  xDomain,
  yDomain,
  xTicks = 6,
  yTicks = 5,
  onHover,
  hoverLabel,
  className,
  children,
}: {
  layers: Layer[];
  height?: number;
  xFormat: (value: number) => string;
  yFormat: (value: number) => string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  xTicks?: number;
  yTicks?: number;
  /** Called with the x value under the pointer (null on leave). */
  onHover?: (x: number | null) => void;
  /** Text shown next to the crosshair. */
  hoverLabel?: (x: number) => ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const margin = { top: 12, right: 14, bottom: 26, left: 56 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;

  // Domains are resolved (and niced) from the target data, then data and domains glide together so
  // changing a parameter morphs the chart instead of jumping.
  const target = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    const add = ([px, py]: Point) => {
      xs.push(px);
      ys.push(py);
    };
    for (const layer of layers) {
      if (layer.type === 'line' || layer.type === 'scatter') layer.points.forEach(add);
      else if (layer.type === 'area') [...layer.upper, ...layer.lower].forEach(add);
      else if (layer.type === 'bars') layer.bars.forEach((bar) => [[bar.x0, 0], [bar.x1, bar.y]].forEach((point) => add(point as Point)));
      else if (layer.type === 'dot') add([layer.x, layer.y]);
    }
    const xScale = scaleLinear().domain(xDomain ?? extent(xs, [0, 1]));
    if (!xDomain) xScale.nice(xTicks);
    const yScale = scaleLinear().domain(yDomain ?? extent(ys, [0, 1])).nice(yTicks);
    return { layers, xDomain: xScale.domain() as [number, number], yDomain: yScale.domain() as [number, number] };
  }, [layers, xDomain, yDomain, xTicks, yTicks]);
  const shown = useTweened(target);
  const x = scaleLinear().domain(shown.xDomain).range([0, innerWidth]);
  const y = scaleLinear().domain(shown.yDomain).range([innerHeight, 0]);
  const path = (points: Point[]) => points.filter(([px, py]) => Number.isFinite(px) && Number.isFinite(py)).map(([px, py], index) => `${index ? 'L' : 'M'}${x(px).toFixed(1)},${y(py).toFixed(1)}`).join('');
  const clampY = (value: number) => Math.max(0, Math.min(innerHeight, y(value)));

  return (
    <div
      ref={ref}
      className={cn('relative w-full select-none', className)}
      style={{ height }}
      onPointerMove={(event) => {
        if (!onHover && !hoverLabel) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const relative = event.clientX - bounds.left - margin.left;
        if (relative < 0 || relative > innerWidth) return;
        const value = x.invert(relative);
        setHoverX(value);
        onHover?.(value);
      }}
      onPointerLeave={() => {
        setHoverX(null);
        onHover?.(null);
      }}
    >
      {width > 0 ? (
        <svg width={width} height={height} className="overflow-visible">
          <defs>
            <clipPath id={`clip-${height}-${Math.round(innerWidth)}`}>
              <rect x={0} y={-2} width={innerWidth} height={innerHeight + 4} />
            </clipPath>
          </defs>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {y.ticks(yTicks).map((tick) => (
              <g key={`y${tick}`} transform={`translate(0,${y(tick)})`}>
                <line x1={0} x2={innerWidth} stroke={tick === 0 ? 'rgba(255,255,255,0.16)' : GRID} />
                <text x={-8} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS} className="num">
                  {yFormat(tick)}
                </text>
              </g>
            ))}
            {x.ticks(xTicks).map((tick) => (
              <text key={`x${tick}`} x={x(tick)} y={innerHeight + 17} textAnchor="middle" fontSize={10} fill={AXIS} className="num">
                {xFormat(tick)}
              </text>
            ))}
            <g clipPath={`url(#clip-${height}-${Math.round(innerWidth)})`}>
              {shown.layers.map((layer, index) => {
                switch (layer.type) {
                  case 'area':
                    return (
                      <path
                        key={index}
                        d={`${path(layer.upper)}${layer.lower
                          .slice()
                          .reverse()
                          .map(([px, py]) => `L${x(px).toFixed(1)},${y(py).toFixed(1)}`)
                          .join('')}Z`}
                        fill={layer.color}
                        opacity={layer.opacity ?? 0.18}
                      />
                    );
                  case 'line':
                    return (
                      <path
                        key={index}
                        d={path(layer.points)}
                        fill="none"
                        stroke={layer.color}
                        strokeWidth={layer.width ?? 1.75}
                        strokeDasharray={layer.dashed ? '4 4' : undefined}
                        opacity={layer.opacity ?? 1}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    );
                  case 'scatter':
                    return (
                      <g key={index} fill={layer.color} opacity={layer.opacity ?? 0.5}>
                        {layer.points.map(([px, py], pointIndex) => (
                          <circle key={pointIndex} cx={x(px)} cy={y(py)} r={layer.r ?? 2} />
                        ))}
                      </g>
                    );
                  case 'bars':
                    return (
                      <g key={index}>
                        {layer.bars.map((bar, barIndex) => (
                          <rect
                            key={barIndex}
                            x={x(bar.x0) + 0.5}
                            width={Math.max(0.5, x(bar.x1) - x(bar.x0) - 1)}
                            y={Math.min(y(0), y(bar.y))}
                            height={Math.abs(y(0) - y(bar.y))}
                            fill={bar.color}
                            rx={1}
                          />
                        ))}
                      </g>
                    );
                  default:
                    return null;
                }
              })}
            </g>
            {shown.layers.map((layer, index) => {
              if (layer.type === 'vline') {
                const px = x(layer.x);
                if (px < 0 || px > innerWidth) return null;
                return (
                  <g key={`r${index}`}>
                    <line x1={px} x2={px} y1={0} y2={innerHeight} stroke={layer.color} strokeDasharray={layer.dashed === false ? undefined : '3 3'} strokeWidth={1.25} />
                    {layer.label ? (
                      <text x={px + (px > innerWidth - 90 ? -5 : 5)} y={10} fontSize={10} fill={layer.color} textAnchor={px > innerWidth - 90 ? 'end' : 'start'}>
                        {layer.label}
                      </text>
                    ) : null}
                  </g>
                );
              }
              if (layer.type === 'hline') {
                const py = clampY(layer.y);
                return (
                  <g key={`r${index}`}>
                    <line x1={0} x2={innerWidth} y1={py} y2={py} stroke={layer.color} strokeDasharray={layer.dashed === false ? undefined : '3 3'} strokeWidth={1.25} />
                    {layer.label ? (
                      <text x={innerWidth - 4} y={py - 5} fontSize={10} fill={layer.color} textAnchor="end">
                        {layer.label}
                      </text>
                    ) : null}
                  </g>
                );
              }
              if (layer.type === 'dot') {
                return (
                  <g key={`r${index}`}>
                    <circle cx={x(layer.x)} cy={clampY(layer.y)} r={(layer.r ?? 4) + 3} fill={layer.color} opacity={0.18} />
                    <circle cx={x(layer.x)} cy={clampY(layer.y)} r={layer.r ?? 4} fill={layer.color} stroke="#0f1115" strokeWidth={1.5} />
                    {layer.label ? (
                      <text
                        x={x(layer.x) + (x(layer.x) > innerWidth - 70 ? -8 : 8)}
                        y={clampY(layer.y) - 8}
                        textAnchor={x(layer.x) > innerWidth - 70 ? 'end' : 'start'}
                        fontSize={10.5}
                        fill="#eceef1"
                        fontWeight={500}
                      >
                        {layer.label}
                      </text>
                    ) : null}
                  </g>
                );
              }
              return null;
            })}
            {hoverX !== null && hoverLabel ? (
              <g>
                <line x1={x(hoverX)} x2={x(hoverX)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.25)" />
              </g>
            ) : null}
          </g>
        </svg>
      ) : null}
      {hoverX !== null && hoverLabel && width > 0 ? (
        <div
          className="pointer-events-none absolute top-2 rounded-sm border border-line-strong bg-surface-3/95 px-2 py-1 text-[11px] text-ink shadow-lg backdrop-blur"
          style={x(hoverX) + margin.left > width - 180 ? { right: width - (x(hoverX) + margin.left) + 10 } : { left: x(hoverX) + margin.left + 10 }}
        >
          {hoverLabel(hoverX)}
        </div>
      ) : null}
      {children}
    </div>
  );
}

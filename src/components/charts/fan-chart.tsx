'use client';

import { scaleLinear } from 'd3';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';

import { useWidth } from '@/components/charts/svg';
import { money } from '@/lib/format';

type Bands = Record<'p5' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95', number[]>;

/** Percentile fan for Monte Carlo paths: 5–95 and 25–75 bands, median line, contributions reference. */
export function FanChart({ bands, contributions, height = 300 }: { bands: Bands; contributions: number[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const months = bands.p50.length - 1;
  const margin = { top: 12, right: 76, bottom: 24, left: 64 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;
  const max = Math.max(...bands.p95, ...contributions);
  const y = scaleLinear().domain([0, max]).nice(5).range([innerHeight, 0]);
  const x = (month: number) => (months ? (month / months) * innerWidth : 0);
  const area = (upper: number[], lower: number[]) =>
    `${upper.map((value, month) => `${month ? 'L' : 'M'}${x(month).toFixed(1)},${y(value).toFixed(1)}`).join('')}${lower
      .map((value, month) => ({ value, month }))
      .reverse()
      .map(({ value, month }) => `L${x(month).toFixed(1)},${y(value).toFixed(1)}`)
      .join('')}Z`;
  const line = (values: number[]) => values.map((value, month) => `${month ? 'L' : 'M'}${x(month).toFixed(1)},${y(value).toFixed(1)}`).join('');
  const yearTicks = Array.from({ length: Math.floor(months / 12) + 1 }, (_, index) => index * 12).filter((month) => months <= 60 || month % 24 === 0);
  const end = months;

  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const month = Math.round(((event.clientX - bounds.left - margin.left) / (innerWidth || 1)) * months);
        setHover(Math.max(0, Math.min(months, month)));
      }}
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 ? (
        <svg width={width} height={height}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {y.ticks(5).map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line x1={0} x2={innerWidth} stroke="rgba(255,255,255,0.06)" />
                <text x={-8} dy="0.32em" textAnchor="end" fontSize={10} fill="#858a95" className="num">
                  {money(tick, { compact: true })}
                </text>
              </g>
            ))}
            {yearTicks.map((month) => (
              <text key={month} x={x(month)} y={innerHeight + 16} textAnchor="middle" fontSize={10} fill="#858a95">
                {month === 0 ? 'Now' : `${month / 12}y`}
              </text>
            ))}
            <motion.g initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
              <path d={area(bands.p95, bands.p5)} fill="rgba(205,212,222,0.07)" />
              <path d={area(bands.p90, bands.p10)} fill="rgba(205,212,222,0.07)" />
              <path d={area(bands.p75, bands.p25)} fill="rgba(205,212,222,0.14)" />
            </motion.g>
            <path d={line(contributions)} fill="none" stroke="#858a95" strokeWidth={1.5} strokeDasharray="4 4" />
            <motion.path
              d={line(bands.p50)}
              fill="none"
              stroke="#cdd4de"
              strokeWidth={2.5}
              strokeLinecap="round"
              initial={reduced ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              style={{ filter: 'drop-shadow(0 0 6px rgba(205,212,222,0.36))' }}
            />
            {(['p95', 'p50', 'p5'] as const).map((key) => (
              <text key={key} x={innerWidth + 8} y={y(bands[key][end])} dy="0.32em" fontSize={10.5} fill="#b9bdc6" className="num">
                {key === 'p50' ? 'Median ' : key === 'p95' ? '95th ' : '5th '}
                {money(bands[key][end], { compact: true })}
              </text>
            ))}
            {hover !== null ? (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.25)" />
                <circle cx={x(hover)} cy={y(bands.p50[hover])} r={4} fill="#cdd4de" stroke="#0f1115" strokeWidth={2} />
              </g>
            ) : null}
          </g>
        </svg>
      ) : null}
      {hover !== null && width > 0 ? (
        <div
          className="pointer-events-none absolute top-2 z-20 w-48 rounded-sm border border-line-strong bg-surface-3/95 px-2.5 py-2 text-[11px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.95)] backdrop-blur"
          style={{ left: Math.min(margin.left + x(hover) + 12, width - 200) }}
        >
          <div className="mb-1 text-muted">{hover === 0 ? 'Today' : `Month ${hover} (${(hover / 12).toFixed(1)} years)`}</div>
          {(
            [
              ['95th percentile', bands.p95[hover]],
              ['75th percentile', bands.p75[hover]],
              ['Median', bands.p50[hover]],
              ['25th percentile', bands.p25[hover]],
              ['5th percentile', bands.p5[hover]],
              ['Money put in', contributions[hover]],
            ] as Array<[string, number]>
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2 py-0.5">
              <span className="text-ink-2">{label}</span>
              <span className="num font-medium text-ink">{money(value, { digits: 0 })}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

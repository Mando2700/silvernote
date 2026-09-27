'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useId, useMemo } from 'react';

import { cn } from '@/lib/utils';

/** Tiny trend line that draws itself in. Colored by net direction unless a color is given. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color,
  className,
  area = true,
  strokeWidth = 1.5,
  baseline,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  area?: boolean;
  strokeWidth?: number;
  /** Draw a hairline at this value (e.g. previous close). */
  baseline?: number;
}) {
  const reduced = useReducedMotion();
  const gradientId = useId();
  const clean = values.filter((value) => Number.isFinite(value));
  const geometry = useMemo(() => {
    if (clean.length < 2) return null;
    const min = Math.min(...clean, baseline ?? Infinity);
    const max = Math.max(...clean, baseline ?? -Infinity);
    const span = max - min || 1;
    const pad = strokeWidth + 1;
    const x = (index: number) => (index / (clean.length - 1)) * width;
    const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
    const line = clean.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join('');
    return {
      line,
      fill: `${line}L${width},${height}L0,${height}Z`,
      baselineY: baseline !== undefined ? y(baseline) : null,
      lastX: x(clean.length - 1),
      lastY: y(clean[clean.length - 1]),
    };
  }, [clean, width, height, strokeWidth, baseline]);

  if (!geometry) return <svg width={width} height={height} className={className} aria-hidden />;
  const up = clean[clean.length - 1] >= (baseline ?? clean[0]);
  const stroke = color ?? (up ? 'var(--color-gain)' : 'var(--color-loss)');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('overflow-visible', className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {geometry.baselineY !== null ? (
        <line x1={0} x2={width} y1={geometry.baselineY} y2={geometry.baselineY} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      ) : null}
      {area ? (
        <motion.path
          d={geometry.fill}
          fill={`url(#${gradientId})`}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.35 }}
        />
      ) : null}
      <motion.path
        d={geometry.line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.circle
        cx={geometry.lastX}
        cy={geometry.lastY}
        r={2}
        fill={stroke}
        initial={reduced ? false : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.8, type: 'spring', stiffness: 400, damping: 20 }}
      />
    </svg>
  );
}

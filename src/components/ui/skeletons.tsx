import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/*
 * Loading placeholders shaped like the content they stand in for. No hooks, so they render from
 * server components too (route loading.tsx files). Every block shares one light sweep across the
 * viewport (see `.skeleton` in globals.css) and fades in after a beat, so quick loads never flash.
 */

/** Deterministic "random" widths so placeholders look organic without hydration mismatches. */
const WIDTHS = [72, 54, 88, 63, 80, 47, 69, 92, 58, 76];
const widthAt = (index: number, min = 0) => `${Math.max(min, WIDTHS[index % WIDTHS.length])}%`;

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('skeleton rounded-sm', className)} style={style} aria-hidden />;
}

/** Announces loading once for assistive tech; the shapes inside are hidden from it. */
export function SkeletonGroup({ label = 'Loading', className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-3" style={{ width: index === lines - 1 && lines > 1 ? '62%' : widthAt(index + 3, 85) }} />
      ))}
    </div>
  );
}

/** Kicker + title bars, matching PanelHeader. */
export function SkeletonHeader({ className, actions = false }: { className?: string; actions?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-3.5 pb-3', className)} aria-hidden>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-2 w-20" />
        <Skeleton className="h-3.5 w-36" />
      </div>
      {actions ? <Skeleton className="h-6.5 w-28" /> : null}
    </div>
  );
}

/** A panel frame with a header placeholder; put any skeleton body inside. */
export function SkeletonPanel({ className, bodyClassName, header = true, actions, children }: { className?: string; bodyClassName?: string; header?: boolean; actions?: boolean; children?: ReactNode }) {
  return (
    <div className={cn('panel overflow-hidden', className)} aria-hidden>
      {header ? <SkeletonHeader actions={actions} /> : null}
      {children ? <div className={cn('px-4 pb-4', !header && 'pt-4', bodyClassName)}>{children}</div> : null}
    </div>
  );
}

/** Grid of StatTile-shaped placeholders. */
export function SkeletonStats({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 md:grid-cols-4', className)} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-sm border border-line bg-surface-1 p-3">
          <Skeleton className="h-2.5" style={{ width: widthAt(index, 40) }} />
          <Skeleton className="mt-2.5 h-4.5 w-3/5" />
          <Skeleton className="mt-2 h-2.5 w-2/5" />
        </div>
      ))}
    </div>
  );
}

/** Table placeholder: header row, then rows with a logo + name column and right-aligned numbers. */
export function SkeletonTable({ rows = 6, cols = 5, logo = true, className }: { rows?: number; cols?: number; logo?: boolean; className?: string }) {
  const numeric = Math.max(0, cols - 1);
  return (
    <div className={cn('w-full', className)} aria-hidden>
      <div className="flex items-center gap-4 border-y border-line px-4 py-2.5">
        <Skeleton className="h-2.5 w-24" />
        <div className="ml-auto flex gap-6">
          {Array.from({ length: numeric }, (_, index) => (
            <Skeleton key={index} className={cn('h-2.5 w-12', index > 2 && 'hidden sm:block', index > 4 && 'sm:hidden lg:block')} />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 border-b border-line/60 px-4 py-2.5 last:border-b-0">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {logo ? <Skeleton className="size-6 shrink-0 rounded-full" /> : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-2.5 max-w-44" style={{ width: widthAt(row, 35) }} />
            </div>
          </div>
          <div className="flex gap-6">
            {Array.from({ length: numeric }, (_, col) => (
              <Skeleton key={col} className={cn('h-3 w-12', col > 2 && 'hidden sm:block', col > 4 && 'sm:hidden lg:block')} style={{ opacity: 0.6 + ((row + col) % 3) * 0.2 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stacked list rows (headlines, notes, filings): optional icon, a title line and a meta line. */
export function SkeletonList({ rows = 5, icon = false, className }: { rows?: number; icon?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-col divide-y divide-line/60', className)} aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-2.5">
          {icon ? <Skeleton className="size-7 shrink-0 rounded-sm" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3" style={{ width: widthAt(index, 50) }} />
            <Skeleton className="h-2.5 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal bars (sector weights, rankings). */
export function SkeletonBars({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-2.5 w-20 shrink-0" />
          <Skeleton className="h-2.5" style={{ width: widthAt(index * 3, 20) }} />
        </div>
      ))}
    </div>
  );
}

// A gentle, plausible price path (viewBox 0 0 400 100).
const CHART_PATH = 'M0 70 C 25 66, 40 74, 62 62 S 98 48, 120 54 S 160 72, 184 58 S 222 30, 248 38 S 288 56, 312 40 S 352 22, 372 28 S 392 18, 400 20';

/**
 * Chart placeholder: faint gridlines and a price line that draws itself on a loop, so a loading
 * chart reads as a chart rather than a grey box.
 */
export function SkeletonChart({ height = 240, className }: { height?: number | string; className?: string }) {
  return (
    <div className={cn('skeleton-chart relative w-full overflow-hidden rounded-sm border border-line/60 bg-white/[0.012]', className)} style={{ height }} aria-hidden>
      <div className="absolute inset-0 flex flex-col justify-between py-[8%]">
        {[0, 1, 2, 3].map((line) => (
          <div key={line} className="h-px w-full bg-white/[0.04]" />
        ))}
      </div>
      <svg className="skeleton-chart-plot absolute inset-x-0 bottom-[6%] h-[80%] w-full" viewBox="0 0 400 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="skeleton-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(205 212 222)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="rgb(205 212 222)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${CHART_PATH} L400 100 L0 100 Z`} fill="url(#skeleton-chart-fill)" />
        <path d={CHART_PATH} fill="none" stroke="rgb(205 212 222 / 0.22)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute right-3 bottom-2 left-3 flex justify-between">
        {[0, 1, 2, 3, 4].map((tick) => (
          <Skeleton key={tick} className="h-2 w-8 opacity-60" />
        ))}
      </div>
    </div>
  );
}

/** Card grid (lessons, pitches, calendar days). */
export function SkeletonCards({ count = 6, height = 160, className }: { count?: number; height?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="panel flex flex-col gap-2.5 p-4" style={{ minHeight: height }}>
          <Skeleton className="h-2 w-16" />
          <Skeleton className="h-4" style={{ width: widthAt(index, 45) }} />
          <SkeletonText lines={2} className="mt-1" />
          <div className="mt-auto flex gap-2 pt-2">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-5 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

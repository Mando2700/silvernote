'use client';

import useSWR from 'swr';

import { Delta } from '@/components/motion/delta';
import { Sparkline } from '@/components/motion/sparkline';
import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export type TapeItem = { symbol: string; label: string; unit: string; price: number | null; change: number | null; changePct: number | null; spark: number[] };

function formatTape(item: TapeItem) {
  if (item.price === null) return '—';
  const digits = item.price >= 1000 ? 0 : item.price >= 20 ? 2 : item.price >= 2 ? 3 : 4;
  const text = item.price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return item.unit === '%' ? `${text}%` : item.unit === '$' ? `$${text}` : text;
}

/** Cross-asset strip: volatility, rates, dollar, commodities, crypto, FX (Settings → Macro tape to change). */
export function MacroTape({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { data } = useSWR<TapeItem[]>('/api/macro/tape', { refreshInterval: 60_000 });
  if (!data) return <Skeleton className={cn('h-14 w-full', className)} />;
  return (
    <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-4 lg:grid-cols-7', className)}>
      {data.map((item) => (
        <div key={item.symbol} className="flex items-center justify-between gap-2 bg-surface-2 px-3 py-2" title={`${item.label} (${item.symbol})`}>
          <div className="min-w-0">
            <div className="truncate font-mono text-[10px] tracking-wider text-muted uppercase">{item.label}</div>
            <div className="num text-[13px] font-medium text-ink">{formatTape(item)}</div>
            {/* Yields move in points, not percent of themselves. */}
            {item.unit === '%' ? (
              <span className={cn('num text-[11px]', (item.change ?? 0) > 0 ? 'text-gain' : (item.change ?? 0) < 0 ? 'text-loss' : 'text-muted')}>
                {item.change === null ? '—' : `${item.change > 0 ? '+' : ''}${(item.change * 100).toFixed(1)} bp`}
              </span>
            ) : (
              <Delta value={item.changePct} alreadyPercent className="text-[11px]" />
            )}
          </div>
          {!compact && item.spark.length > 2 ? <Sparkline values={item.spark} width={44} height={22} area={false} strokeWidth={1.2} /> : null}
        </div>
      ))}
    </div>
  );
}

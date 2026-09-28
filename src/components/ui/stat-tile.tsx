import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Small bordered metric: label (with an optional hover explanation), value and a sub-line. */
export function StatTile({ label, value, sub, hint, className }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn('rounded-sm border border-line bg-surface-1 p-3', className)}>
      <div className="flex items-center gap-1 text-[11.5px] text-muted">
        {label}
        {hint ? (
          <span className="group/hint relative inline-flex cursor-help items-center">
            <Info className="size-3 text-faint" />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-56 -translate-x-1/2 rounded-sm border border-line bg-surface-3 px-2 py-1 text-[11px] font-normal text-ink opacity-0 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)] transition-opacity duration-100 group-hover/hint:opacity-100">
              {hint}
            </span>
          </span>
        ) : null}
      </div>
      <div className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-[11.5px]">{sub}</div> : null}
    </div>
  );
}

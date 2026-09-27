import { ViewTransition, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Standard page frame: kicker + title + actions row, with a soft crossfade between routes. */
export function Page({
  kicker,
  title,
  description,
  actions,
  children,
  className,
}: {
  kicker?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ViewTransition enter="page-fade" exit="page-fade" default="none">
      <div className={cn('flex flex-col gap-4', className)}>
        {title ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              {kicker ? <div className="kicker mb-1.5">{kicker}</div> : null}
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
              {description ? <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    </ViewTransition>
  );
}

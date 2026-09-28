import { ViewTransition, type ReactNode } from 'react';

import { ScrambleText } from '@/components/motion/scramble-text';
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
      <div className={cn('stagger flex flex-col gap-4', className)}>
        {title ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              {kicker ? (
                <div className="kicker mb-1.5 flex items-center gap-2">
                  <span className="relative inline-flex size-1.5 shrink-0" aria-hidden>
                    <span className="absolute inset-0 animate-ping rounded-full bg-ion/60 [animation-duration:2.4s]" />
                    <span className="relative size-1.5 rounded-full bg-ion shadow-[0_0_8px_var(--color-ion)]" />
                  </span>
                  {typeof kicker === 'string' ? <ScrambleText text={kicker} /> : kicker}
                </div>
              ) : null}
              <h1 className="bg-gradient-to-b from-white to-ink-2 bg-clip-text text-[24px] font-semibold tracking-[-0.025em] text-transparent">{title}</h1>
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

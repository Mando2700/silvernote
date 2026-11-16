import { KeepAliveFallback } from '@/components/shell/keep-alive';
import {
  Skeleton,
  SkeletonBars,
  SkeletonCards,
  SkeletonChart,
  SkeletonGroup,
  SkeletonList,
  SkeletonPanel,
  SkeletonStats,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeletons';
import { cn } from '@/lib/utils';

export type PageSkeletonVariant =
  | 'default'
  | 'dashboard'
  | 'company'
  | 'portfolio'
  | 'table'
  | 'split'
  | 'cards'
  | 'calendar'
  | 'chat'
  | 'article'
  | 'tool'
  | 'grid';

/** Kicker + page title + actions row, matching <Page>. */
function TitleSkeleton({ actions = true, description = false }: { actions?: boolean; description?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-2 w-24" />
        <Skeleton className="h-6 w-56" />
        {description ? <Skeleton className="h-3 w-80 max-w-[70vw]" /> : null}
      </div>
      {actions ? (
        <div className="flex gap-2">
          <Skeleton className="h-7.5 w-24" />
          <Skeleton className="h-7.5 w-20" />
        </div>
      ) : null}
    </div>
  );
}

function Body({ variant }: { variant: PageSkeletonVariant }) {
  switch (variant) {
    case 'dashboard':
      return (
        <>
          <SkeletonPanel>
            <SkeletonStats count={4} />
          </SkeletonPanel>
          <SkeletonPanel>
            <SkeletonChart height={420} />
          </SkeletonPanel>
          <div className="grid gap-4 lg:grid-cols-3">
            <SkeletonPanel>
              <SkeletonList rows={5} icon />
            </SkeletonPanel>
            <SkeletonPanel>
              <SkeletonBars rows={7} />
            </SkeletonPanel>
            <SkeletonPanel>
              <SkeletonList rows={5} />
            </SkeletonPanel>
          </div>
        </>
      );
    case 'company':
      return (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <Skeleton className="size-12 rounded-md" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-52" />
              <Skeleton className="h-3 w-36" />
            </div>
            <div className="ml-auto flex flex-col items-end gap-2">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="flex gap-3 border-b border-line pb-2">
            {[64, 80, 72, 56, 88, 60].map((width, index) => (
              <Skeleton key={index} className="h-4" style={{ width }} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <SkeletonPanel actions>
              <SkeletonChart height={340} />
            </SkeletonPanel>
            <SkeletonPanel>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                {Array.from({ length: 10 }, (_, index) => (
                  <div key={index} className="flex flex-col gap-1.5">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="h-3.5 w-12" />
                  </div>
                ))}
              </div>
            </SkeletonPanel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonPanel>
              <SkeletonText lines={5} />
            </SkeletonPanel>
            <SkeletonPanel>
              <SkeletonList rows={4} />
            </SkeletonPanel>
          </div>
        </>
      );
    case 'portfolio':
      return (
        <>
          <SkeletonStats count={4} />
          <SkeletonPanel actions>
            <SkeletonChart height={320} />
          </SkeletonPanel>
          <SkeletonPanel header bodyClassName="px-0 pb-0">
            <SkeletonTable rows={7} cols={7} />
          </SkeletonPanel>
        </>
      );
    case 'table':
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
          <SkeletonPanel header={false} bodyClassName="px-0 pb-0 pt-0">
            <SkeletonTable rows={12} cols={8} />
          </SkeletonPanel>
        </>
      );
    case 'split':
      return (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <SkeletonPanel>
            <SkeletonList rows={8} />
          </SkeletonPanel>
          <SkeletonPanel actions>
            <SkeletonText lines={4} />
            <SkeletonTable rows={6} cols={5} className="mt-5 -mx-4 w-[calc(100%+2rem)]" />
          </SkeletonPanel>
        </div>
      );
    case 'cards':
      return (
        <>
          <SkeletonPanel>
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-2.5 w-full max-w-md" />
              </div>
            </div>
          </SkeletonPanel>
          <SkeletonCards count={6} />
        </>
      );
    case 'calendar':
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-7.5 w-40" />
            <Skeleton className="h-7.5 w-28" />
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <SkeletonPanel key={index} className={cn(index > 1 && 'hidden md:block')}>
                <SkeletonList rows={6} icon />
              </SkeletonPanel>
            ))}
          </div>
        </>
      );
    case 'chat':
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pt-4">
          <div className="flex justify-end">
            <Skeleton className="h-10 w-2/5 rounded-lg" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <SkeletonText lines={4} className="flex-1" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-1/3 rounded-lg" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <SkeletonText lines={3} className="flex-1" />
          </div>
          <Skeleton className="mt-6 h-24 w-full rounded-lg" />
        </div>
      );
    case 'article':
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <Skeleton className="h-1.5 w-full rounded-full" />
          <SkeletonText lines={4} />
          <SkeletonPanel>
            <SkeletonChart height={260} />
          </SkeletonPanel>
          <SkeletonText lines={5} />
        </div>
      );
    case 'tool':
      return (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <SkeletonPanel>
            <div className="flex flex-col gap-4">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex flex-col gap-1.5">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
              <Skeleton className="mt-2 h-9 w-full" />
            </div>
          </SkeletonPanel>
          <div className="flex flex-col gap-4">
            <SkeletonStats count={4} />
            <SkeletonPanel actions>
              <SkeletonChart height={340} />
            </SkeletonPanel>
          </div>
        </div>
      );
    case 'grid':
      return (
        <>
          <Skeleton className="h-14 w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonPanel key={index} actions>
                <SkeletonChart height={220} />
              </SkeletonPanel>
            ))}
          </div>
        </>
      );
    default:
      return (
        <>
          <SkeletonPanel actions>
            <SkeletonChart height={280} />
          </SkeletonPanel>
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonPanel>
              <SkeletonList rows={5} />
            </SkeletonPanel>
            <SkeletonPanel>
              <SkeletonText lines={5} />
            </SkeletonPanel>
          </div>
        </>
      );
  }
}

/** Whole-page placeholder in the shape of the page that is loading. */
export function PageSkeleton({ variant = 'default', title = true }: { variant?: PageSkeletonVariant; title?: boolean }) {
  return (
    <SkeletonGroup label="Loading page" className="flex flex-col gap-4">
      {title && variant !== 'company' && variant !== 'chat' ? <TitleSkeleton description={variant === 'cards' || variant === 'tool'} /> : null}
      <Body variant={variant} />
    </SkeletonGroup>
  );
}

/**
 * For route loading.tsx files. A page that is still kept alive (visited earlier) is shown straight
 * away instead of a skeleton while its route payload arrives.
 */
export function RouteSkeleton(props: { variant?: PageSkeletonVariant; title?: boolean }) {
  return (
    <KeepAliveFallback>
      <PageSkeleton {...props} />
    </KeepAliveFallback>
  );
}

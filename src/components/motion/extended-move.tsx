import { Delta } from '@/components/motion/delta';
import type { ExtendedQuote } from '@/lib/data/types';
import { price } from '@/lib/format';
import { cn } from '@/lib/utils';

const SESSION_LABEL = { pre: 'Pre-market', post: 'After hours' } as const;

/** The small line under a price: the extended-hours move from the regular close ($ and %). */
export function ExtendedMove({ quote, className }: { quote: ExtendedQuote | null | undefined; className?: string }) {
  if (!quote) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[9.5px] leading-none', className)} title={`${SESSION_LABEL[quote.session]} ${price(quote.price)}`}>
      <Delta value={quote.change} kind="money" digits={2} className="text-[9.5px]" />
      <Delta value={quote.changePct} alreadyPercent className="text-[9.5px]" />
    </span>
  );
}

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { isNum, signedMoney, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Gain/loss text: its own color pair plus an explicit sign, so meaning never rests on color. */
export function Delta({
  value,
  kind = 'pct',
  alreadyPercent = false,
  digits = 2,
  arrow = false,
  className,
}: {
  value: number | null | undefined;
  kind?: 'pct' | 'money';
  alreadyPercent?: boolean;
  digits?: number;
  arrow?: boolean;
  className?: string;
}) {
  if (!isNum(value)) return <span className={cn('num text-muted', className)}>—</span>;
  const tone = value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-muted';
  const text = kind === 'pct' ? signedPct(value, digits, alreadyPercent) : signedMoney(value, { digits });
  return (
    <span className={cn('num inline-flex items-center gap-0.5 font-medium', tone, className)}>
      {arrow && value !== 0 ? value > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" /> : null}
      {text}
    </span>
  );
}

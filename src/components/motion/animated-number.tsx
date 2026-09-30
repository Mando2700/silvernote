'use client';

import { RollingNumber } from '@/components/motion/rolling-number';

/**
 * Animated figure used across the app: shown at its value on first render, then digits roll to
 * new values on update and glow green/red on each change. See RollingNumber.
 * `duration` and `from` are accepted for older call sites and ignored.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number | null | undefined;
  format: (value: number) => string;
  duration?: number;
  from?: 'zero' | 'near';
  className?: string;
}) {
  return <RollingNumber value={value} format={format} className={className} />;
}

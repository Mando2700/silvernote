'use client';

import { animate, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Counts from the previously shown value to the new one. The first appearance counts up from
 * zero once the number scrolls into view; later updates tween from the last value.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 0.9,
  from = 'zero',
  className,
}: {
  value: number | null | undefined;
  format: (value: number) => string;
  duration?: number;
  /** First count starts at zero, or just below the value (prices roll rather than count up). */
  from?: 'zero' | 'near';
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const previous = useRef<number | null>(null);
  const [animated, setAnimated] = useState<string | null>(null);
  const valid = typeof value === 'number' && Number.isFinite(value);
  // Callers pass inline formatters; read the latest one without restarting the tween.
  const show = useEffectEvent((latest: number) => setAnimated(format(latest)));

  useEffect(() => {
    if (!valid || reduced || !inView) return;
    const start = previous.current ?? (from === 'near' ? value * 0.985 : 0);
    const first = previous.current === null;
    previous.current = value;
    const controls = animate(start, value, {
      duration: first ? duration : Math.min(duration, 0.6),
      ease: [0.16, 1, 0.3, 1],
      onUpdate: show,
    });
    return () => controls.stop();
  }, [value, valid, inView, reduced, duration, from]);

  const text = !valid ? '—' : reduced ? format(value) : (animated ?? format(from === 'near' ? value * 0.985 : 0));
  return (
    <span ref={ref} className={cn('inline-block', className)}>
      {text}
    </span>
  );
}

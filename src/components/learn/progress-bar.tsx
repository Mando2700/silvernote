'use client';

import { motion, useInView, useReducedMotionConfig, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * A progress bar that fills with spring physics — it accelerates, eases in and settles rather than
 * snapping — starting when it scrolls into view (or when its kept-alive page is shown again), and
 * glides from its old value when progress changes. Optional `segments` draws a tick per item (e.g.
 * per lesson) so partial progress reads as "3½ of 5".
 */
export function ProgressBar({
  value,
  segments,
  className,
  fillClassName = 'bg-gradient-to-r from-brand-deep via-brand-soft to-brand-bright',
  delay = 0,
}: {
  value: number;
  segments?: number;
  className?: string;
  fillClassName?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '0px 0px -8% 0px' });
  const reduced = useReducedMotionConfig();
  const spring = useSpring(0, { stiffness: 55, damping: 17, mass: 1, restDelta: 0.0005 });
  const width = useTransform(spring, (current) => `${Math.max(0, Math.min(1, current)) * 100}%`);
  const target = Math.max(0, Math.min(1, value));

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      spring.jump(target);
      return;
    }
    const timer = window.setTimeout(() => spring.set(target), delay * 1000);
    return () => window.clearTimeout(timer);
  }, [inView, target, reduced, spring, delay]);

  return (
    <div ref={ref} className={cn('relative h-1.5 overflow-hidden rounded-full bg-surface-4', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(target * 100)}>
      <motion.div className={cn('relative h-full rounded-full', fillClassName)} style={{ width }}>
        {target > 0 && target < 1 ? <span className="absolute inset-y-0 right-0 w-3 rounded-full bg-white/50 blur-[3px]" /> : null}
      </motion.div>
      {segments && segments > 1
        ? Array.from({ length: segments - 1 }, (_, index) => (
            <span key={index} className="absolute inset-y-0 w-[2px] bg-surface-1" style={{ left: `calc(${((index + 1) / segments) * 100}% - 1px)` }} />
          ))
        : null}
    </div>
  );
}

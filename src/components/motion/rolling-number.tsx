'use client';

import { useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Odometer-style number: each digit rolls vertically to its new value, and the whole figure
 * briefly glows green/red when the displayed text changes. Tabular figures keep the width
 * steady, and nothing re-renders visibly unless the formatted text actually changes, so
 * sub-cent live ticks don't cause flicker.
 */
export function RollingNumber({
  value,
  format,
  className,
}: {
  value: number | null | undefined;
  format: (value: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const valid = typeof value === 'number' && Number.isFinite(value);
  const text = valid ? format(value) : '—';

  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState({ text, value });
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; count: number } | null>(null);
  if (text !== shown.text) {
    if (valid && typeof shown.value === 'number' && Number.isFinite(shown.value) && value !== shown.value) {
      setFlash({ dir: value > shown.value ? 'up' : 'down', count: (flash?.count ?? 0) + 1 });
    }
    setShown({ text, value });
  }

  // First appearance: every digit sits at 0 and rolls up once the number scrolls into view.
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });

  // Glow via the Web Animations API so the digits aren't remounted (which would skip the roll).
  useEffect(() => {
    if (!flash || !ref.current) return;
    const color = flash.dir === 'up' ? 'var(--color-gain)' : 'var(--color-loss)';
    const animation = ref.current.animate(
      [{ color, textShadow: `0 0 16px ${color}` }, { color, textShadow: `0 0 10px ${color}`, offset: 0.35 }, {}],
      { duration: 1400, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
    return () => animation.cancel();
  }, [flash]);

  // Align digits from the right so a changing length doesn't shift every column.
  const chars = text.split('');
  return (
    <span
      aria-label={text}
      ref={ref}
      className={cn('relative inline-flex tabular-nums', className)}
    >
      {chars.map((char, index) => {
        const slot = chars.length - index;
        if (!DIGITS.includes(char) || reduced) {
          return (
            <span key={`s${slot}`} aria-hidden>
              {char}
            </span>
          );
        }
        return (
          <span key={`d${slot}`} aria-hidden className="relative inline-block h-[1em] overflow-hidden leading-none">
            <span className="invisible">0</span>
            <span
              className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ transform: `translateY(-${inView ? Number(char) * 10 : 0}%)` }}
            >
              {DIGITS.map((digit) => (
                <span key={digit} className="h-[1em] leading-none">
                  {digit}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

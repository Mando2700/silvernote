'use client';

import { useReducedMotionConfig } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Interpolates any structure of numbers (objects, arrays, tuples) from `from` to `to` at `t`.
 * Arrays of different length are resampled so a 5-year series can morph into a 10-year one;
 * anything non-numeric (labels, colors, flags) takes the target value.
 */
export function lerpDeep<T>(from: unknown, to: T, t: number): T {
  if (t >= 1 || from === to) return to;
  if (typeof to === 'number') return (typeof from === 'number' && Number.isFinite(from) && Number.isFinite(to) ? from + (to - from) * t : to) as T;
  if (Array.isArray(to)) {
    if (!Array.isArray(from) || !from.length) return to;
    return to.map((item, index) => lerpDeep(from.length === to.length ? from[index] : resampleAt(from, to.length, index), item, t)) as T;
  }
  if (to && typeof to === 'object') {
    if (!from || typeof from !== 'object' || Array.isArray(from)) return to;
    const source = from as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(to)) out[key] = lerpDeep(source[key], value, t);
    return out as T;
  }
  return to;
}

function resampleAt(from: unknown[], length: number, index: number): unknown {
  if (length <= 1) return from[0];
  const position = (index / (length - 1)) * (from.length - 1);
  const lo = Math.floor(position);
  const hi = Math.min(from.length - 1, lo + 1);
  return lerpDeep(from[lo], from[hi], position - lo);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * Returns `target`, animated: when it changes, the returned value glides from whatever is on
 * screen to the new target (restarting mid-flight while a slider is dragged). Honors the app's
 * reduced-motion setting.
 */
export function useTweened<T>(target: T, duration = 420): T {
  const reduced = useReducedMotionConfig();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const targetRef = useRef(target);
  const frame = useRef(0);

  useEffect(() => {
    if (deepEqual(targetRef.current, target)) return;
    targetRef.current = target;
    cancelAnimationFrame(frame.current);
    const from = shownRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const progress = reduced || duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
      const next = progress >= 1 ? target : lerpDeep(from, target, ease(progress));
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [target, duration, reduced]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return shown;
}

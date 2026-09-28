'use client';

import { useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>';

/**
 * Text that decodes itself left to right once on mount, like a terminal resolving a readout.
 * Writes straight to the DOM (no re-renders) and renders the final text on the server, so
 * crawlers, screen readers and reduced-motion users only ever see the real string.
 */
export function ScrambleText({ text, duration = 700, className }: { text: string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const settled = Math.floor(progress * text.length);
      let out = text.slice(0, settled);
      for (let index = settled; index < text.length; index += 1) {
        const char = text[index];
        out += char === ' ' || char === '·' ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      node.textContent = out;
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      node.textContent = text;
    };
  }, [text, duration, reduced]);

  return (
    <span ref={ref} className={className} aria-label={text}>
      {text}
    </span>
  );
}

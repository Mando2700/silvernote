'use client';

import { AnimatePresence, motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Fixed background layers behind the workspace: grid, slowly breathing light and grain. */
export function Ambient() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="grid-backdrop absolute inset-0" />
      <div className="aurora absolute -inset-[10%]" />
      <div className="noise absolute inset-0" />
    </div>
  );
}

/**
 * One passive pointer listener for the whole app: it writes the pointer position (relative to the
 * panel under it) into --mx/--my, which the `panel` styles turn into a spotlight and a lit edge.
 */
export function usePanelSpotlight() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    let current: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const clear = (element: HTMLElement | null) => {
      element?.style.removeProperty('--mx');
      element?.style.removeProperty('--my');
    };

    const apply = () => {
      frame = 0;
      const event = last;
      if (!event) return;
      const target = event.target instanceof Element ? (event.target.closest('.panel') as HTMLElement | null) : null;
      if (target !== current) {
        clear(current);
        current = target;
      }
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      target.style.setProperty('--my', `${event.clientY - rect.top}px`);
    };

    const onMove = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      clear(current);
      current = null;
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      clear(current);
    };
  }, []);
}

/**
 * Thin glowing line along the top edge while a route loads. Starts on a click on an internal link
 * to a different page and completes when the pathname changes (or gives up after 10 s).
 */
export function RouteProgress() {
  const pathname = usePathname();
  // The pathname a navigation started from; the bar completes once the pathname moves on.
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const state = startedAt === null ? 'idle' : startedAt === pathname ? 'loading' : 'done';

  useEffect(() => {
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      setStartedAt(window.location.pathname);
      clearTimeout(giveUp);
      giveUp = setTimeout(() => setStartedAt(null), 10_000);
    };
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      clearTimeout(giveUp);
    };
  }, []);

  useEffect(() => {
    if (state !== 'done') return;
    const reset = setTimeout(() => setStartedAt(null), 380);
    return () => clearTimeout(reset);
  }, [state]);

  return (
    <AnimatePresence>
      {state !== 'idle' ? (
        <motion.div
          key="route-progress"
          className="route-progress pointer-events-none fixed top-0 left-0 z-[100] h-[2px] origin-left"
          style={{ width: '100%' }}
          initial={{ scaleX: 0, opacity: 1 }}
          animate={state === 'loading' ? { scaleX: 0.82, transition: { duration: 6, ease: [0.1, 0.6, 0.2, 1] } } : { scaleX: 1, transition: { duration: 0.25 } }}
          exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.1 } }}
          aria-hidden
        />
      ) : null}
    </AnimatePresence>
  );
}

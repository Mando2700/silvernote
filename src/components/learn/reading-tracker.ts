'use client';

import { useEffect, useRef, useState } from 'react';

import type { LearnState } from '@/components/learn/hooks';
import { api } from '@/lib/client';
import type { Lesson } from '@/lib/learn/curriculum';

const IDLE_AFTER_MS = 90_000;
const FLUSH_EVERY_S = 20;

/**
 * Seconds a section must be on screen before it counts as read: about a third of the time it takes
 * to read its text at 250 words a minute (skimming is fine, scrolling past is not), 5–75 s.
 */
function requiredDwell(element: HTMLElement) {
  const words = (element.innerText || '').split(/\s+/).filter(Boolean).length;
  return Math.min(75, Math.max(5, (words / 250) * 60 * 0.35));
}

/**
 * Tracks reading on a lesson page while it is on screen: a section is marked read once it has been
 * in view long enough and you have reached its end; active time (tab visible, some scroll, pointer or
 * key activity in the last 90 s) is added to the lesson so estimates can adapt to your pace.
 * Everything is saved in small batches and when you leave.
 */
export function useReadingTracker({
  lesson,
  anchor,
  serverRead,
  onSaved,
}: {
  lesson: Lesson;
  anchor: (id: string) => string;
  serverRead: string[];
  onSaved: (state: LearnState) => void;
}) {
  const [localRead, setLocalRead] = useState<string[]>([]);
  const known = useRef(new Set<string>());
  const dwell = useRef(new Map<string, number>());
  const required = useRef(new Map<string, number>());
  const pending = useRef({ sections: new Set<string>(), seconds: 0, sinceFlush: 0 });
  const lastActive = useRef(0);
  const save = useRef(onSaved);

  useEffect(() => {
    save.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    for (const id of serverRead) known.current.add(id);
  }, [serverRead]);

  useEffect(() => {
    const slug = lesson.slug;
    lastActive.current = Date.now();
    const payload = () => {
      const { sections, seconds } = pending.current;
      if (!sections.size && seconds < 3) return null;
      const body = { kind: 'read' as const, slug, sections: [...sections], seconds: Math.round(seconds) };
      pending.current = { sections: new Set(), seconds: 0, sinceFlush: 0 };
      return body;
    };
    const flush = () => {
      const body = payload();
      if (!body) return;
      api<LearnState>('/api/learn/progress', { body })
        .then((state) => save.current(state))
        .catch(() => {
          // Put it back so the next flush retries.
          body.sections.forEach((id) => pending.current.sections.add(id));
          pending.current.seconds += body.seconds;
        });
    };
    const beacon = () => {
      const body = payload();
      if (body) navigator.sendBeacon?.('/api/learn/progress', new Blob([JSON.stringify(body)], { type: 'application/json' }));
    };
    const active = () => {
      lastActive.current = Date.now();
    };

    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || Date.now() - lastActive.current > IDLE_AFTER_MS) return;
      pending.current.seconds += 1;
      pending.current.sinceFlush += 1;
      const viewport = window.innerHeight;
      const fresh: string[] = [];
      for (const section of lesson.sections) {
        if (known.current.has(section.id)) continue;
        const element = document.getElementById(anchor(section.id));
        if (!element || !element.getClientRects().length) continue;
        const rect = element.getBoundingClientRect();
        if (rect.top > viewport * 0.8 || rect.bottom < viewport * 0.2) continue;
        const seconds = (dwell.current.get(section.id) ?? 0) + 1;
        dwell.current.set(section.id, seconds);
        if (!required.current.has(section.id)) required.current.set(section.id, requiredDwell(element));
        if (seconds >= (required.current.get(section.id) ?? 10) && rect.bottom <= viewport * 0.95) {
          known.current.add(section.id);
          pending.current.sections.add(section.id);
          fresh.push(section.id);
        }
      }
      if (fresh.length) setLocalRead((current) => [...current, ...fresh]);
      if (fresh.length || pending.current.sinceFlush >= FLUSH_EVERY_S) flush();
    }, 1000);

    const events = ['scroll', 'pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((name) => window.addEventListener(name, active, { passive: true }));
    const onHide = () => {
      if (document.visibilityState === 'hidden') beacon();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', beacon);
    return () => {
      window.clearInterval(tick);
      events.forEach((name) => window.removeEventListener(name, active));
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', beacon);
      // Leaving the lesson (or its kept-alive page being hidden) saves what's pending.
      flush();
    };
  }, [lesson, anchor]);

  return new Set([...serverRead, ...localRead]);
}

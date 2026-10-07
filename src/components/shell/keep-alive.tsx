'use client';

import { usePathname, useSearchParams as useRouteSearchParams } from 'next/navigation';
import { Activity, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** Pages kept mounted (hidden) after you leave them; the least recently visited is dropped past this. */
const MAX_ALIVE = 10;

type Entry = { key: string; node: ReactNode };

type KeepAliveState = {
  entries: Entry[];
  activeKey: string | null;
  register: (key: string, node: ReactNode) => void;
  activate: (key: string) => void;
  deactivate: (key: string) => void;
  close: (path: string) => void;
  /** The last URL visited under a link's section (e.g. `/portfolio?id=2` for `/portfolio`), if that page is still alive. */
  resolveHref: (href: string) => string;
};

const KeepAliveContext = createContext<KeepAliveState | null>(null);
/** Whether the page a component belongs to is the one on screen. Outside a kept-alive page there is nothing to hide. */
const ActiveContext = createContext(true);

/** One page per pathname, whatever the case of its dynamic segments. */
export function keyOf(path: string) {
  return path.split('?')[0].replace(/\/+$/, '').toLowerCase() || '/';
}

function sectionOf(path: string) {
  return `/${keyOf(path).split('/')[1] ?? ''}`;
}

function useKeepAlive() {
  const value = useContext(KeepAliveContext);
  if (!value) throw new Error('useKeepAlive must be used inside <KeepAliveProvider>');
  return value;
}

/** Sidebar and link helpers: close a kept-alive page, or find where a section was left. */
export function useKeepAliveLinks() {
  const { close, resolveHref } = useKeepAlive();
  return { close, resolveHref };
}

/** Whether this component's page is the visible one (always true outside a kept-alive page). */
export function usePageActive() {
  return useContext(ActiveContext);
}

/**
 * `useSearchParams` for pages that live in the keep-alive deck. While the page is hidden it keeps the
 * params it last saw instead of following whatever page is on screen, so its state doesn't get rewritten.
 */
export function useSearchParams() {
  const live = useRouteSearchParams();
  const active = useContext(ActiveContext);
  const [held, setHeld] = useState(live);
  if (active && held !== live) setHeld(live);
  return active ? live : held;
}

/** Remembers the window scroll of one page while it is visible, and puts it back when it is shown again. */
function Slot({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollY = useRef(0);

  // A page that is display:none has no height, so the browser's own scroll events while hidden are noise.
  useEffect(() => {
    if (!active) return;
    const onScroll = () => {
      if (ref.current && ref.current.getClientRects().length > 0) scrollY.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [active]);

  // Next scrolls to the top after a navigation commits, so restore again on the next frames.
  useLayoutEffect(() => {
    if (!active || scrollY.current === 0) return;
    const target = scrollY.current;
    window.scrollTo(0, target);
    let frame = requestAnimationFrame(() => {
      window.scrollTo(0, target);
      frame = requestAnimationFrame(() => window.scrollTo(0, target));
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <ActiveContext.Provider value={active}>
      <div ref={ref}>{children}</div>
    </ActiveContext.Provider>
  );
}

/**
 * Keeps every visited page mounted next to the routed one. A route only reports its content (see KeepAlive);
 * the content itself is drawn by KeepAliveViews, so leaving a page hides it rather than unmounts it and
 * its state (filters, drafts, chat, chart range, scroll) is still there when you come back.
 */
export function KeepAliveProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useRouteSearchParams();
  // Least recently visited first.
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [lastHref, setLastHref] = useState<Record<string, string>>({});

  const register = useCallback((key: string, node: ReactNode) => {
    setEntries((current) => {
      const rest = current.filter((entry) => entry.key !== key);
      return [...rest, { key, node }].slice(-MAX_ALIVE);
    });
  }, []);
  const activate = useCallback((key: string) => setActiveKey(key), []);
  const deactivate = useCallback((key: string) => setActiveKey((current) => (current === key ? null : current)), []);
  const close = useCallback((path: string) => {
    const key = keyOf(path);
    setEntries((current) => current.filter((entry) => entry.key !== key));
    setLastHref((current) => Object.fromEntries(Object.entries(current).filter(([, href]) => keyOf(href) !== key)));
  }, []);

  const query = searchParams.toString();
  const href = `${pathname}${query ? `?${query}` : ''}`;
  if (lastHref[sectionOf(pathname)] !== href) setLastHref({ ...lastHref, [sectionOf(pathname)]: href });

  const resolveHref = useCallback(
    (link: string) => {
      const last = lastHref[sectionOf(link)];
      return last && entries.some((entry) => entry.key === keyOf(last)) ? last : link;
    },
    [lastHref, entries],
  );

  const value = useMemo(
    () => ({ entries, activeKey, register, activate, deactivate, close, resolveHref }),
    [entries, activeKey, register, activate, deactivate, close, resolveHref],
  );
  return <KeepAliveContext.Provider value={value}>{children}</KeepAliveContext.Provider>;
}

/** The kept-alive pages; render it where the routed page goes. */
export function KeepAliveViews() {
  const { entries, activeKey } = useKeepAlive();
  // activeKey follows the route a layout effect late, so on the render where the URL changes the page being left
  // would still count as active while reading the new page's params, and could navigate back to itself.
  const current = keyOf(usePathname());
  return entries.map(({ key, node }) => (
    <Activity key={key} mode={key === activeKey ? 'visible' : 'hidden'}>
      <Slot active={key === activeKey && key === current}>{node}</Slot>
    </Activity>
  ));
}

/** Wrap a page's content in this from its route: the content is drawn by the deck and kept alive after you navigate away. */
export function KeepAlive({ children }: { children: ReactNode }) {
  const key = keyOf(usePathname());
  const { register, activate, deactivate } = useKeepAlive();
  useLayoutEffect(() => {
    register(key, children);
  }, [register, key, children]);
  useLayoutEffect(() => {
    activate(key);
    return () => deactivate(key);
  }, [activate, deactivate, key]);
  return null;
}

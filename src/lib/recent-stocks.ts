import { useSyncExternalStore } from 'react';

/** A stock the user opened; `href` is the last URL they were on (including the tab), so reopening lands back on the same view. */
export type RecentStock = { symbol: string; name: string; href: string };

const KEY = 'silvernote.recent-stocks';
const MAX_RECENT = 8;
const EMPTY: RecentStock[] = [];

const listeners = new Set<() => void>();
let snapshot: RecentStock[] = EMPTY;
let loaded = false;

function isRecent(value: unknown): value is RecentStock {
  const item = value as Partial<RecentStock> | null;
  return typeof item?.symbol === 'string' && typeof item.name === 'string' && typeof item.href === 'string' && item.href.startsWith('/company/');
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    snapshot = Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, MAX_RECENT) : EMPTY;
  } catch {
    // storage unavailable or corrupt: start empty, the in-memory list still works for this tab
  }
}

function commit(next: RecentStock[]) {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the in-memory list carries the value
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    loaded = false;
    load();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot() {
  load();
  return snapshot;
}

/** Move a stock to the top of the list (or add it), keeping the latest name and URL. */
export function pushRecentStock(stock: RecentStock) {
  load();
  const current = snapshot[0];
  if (current && current.symbol === stock.symbol && current.name === stock.name && current.href === stock.href) return;
  commit([stock, ...snapshot.filter((item) => item.symbol !== stock.symbol)].slice(0, MAX_RECENT));
}

export function removeRecentStock(symbol: string) {
  load();
  commit(snapshot.filter((item) => item.symbol !== symbol));
}

/** Most recently opened first. Empty on the server and during hydration. */
export function useRecentStocks() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

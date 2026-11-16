'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { marketSession } from '@/lib/session';

/**
 * Browser side of live prices: components register the symbols they show, one poll of /api/live every
 * 15 s carries all of them (capped at 50, first registered first), and components re-render only when
 * prices arrive. It polls only while the tab is visible and the regular US session is open: short
 * requests cost a free host's plan a second each, where a held-open stream used it up.
 */

export type LivePrice = { symbol: string; price: number; change: number | null; changePct: number | null; timestamp: number };

const MAX = 50;
const POLL_MS = 15_000;
const wanted = new Map<string, number>();
const prices = new Map<string, LivePrice>();
const listeners = new Set<() => void>();
let version = 0;
let pollKey = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let watching = false;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

/** Re-check when the tab is shown or hidden and when the session opens or closes. */
function watchActivity() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('visibilitychange', schedule);
  setInterval(schedule, 60_000);
}

function pollWanted() {
  return document.visibilityState === 'visible' && marketSession() === 'regular';
}

async function poll() {
  const key = pollKey;
  if (!key) return;
  try {
    const response = await fetch(`/api/live?symbols=${encodeURIComponent(key)}`, { headers: { Accept: 'application/json' } });
    if (!response.ok || key !== pollKey) return;
    const { ticks } = (await response.json()) as { ticks: LivePrice[] };
    for (const tick of ticks) prices.set(tick.symbol, tick);
    if (ticks.length) notify();
  } catch {
    // keep the last prices; the next poll tries again
  }
}

function sync() {
  syncTimer = null;
  const symbols = pollWanted() ? [...wanted.keys()].slice(0, MAX).sort() : [];
  const key = symbols.join(',');
  if (key === pollKey) return;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pollKey = key;
  if (!key) return;
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_MS);
}

function schedule() {
  watchActivity();
  if (!syncTimer) syncTimer = setTimeout(sync, 250);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Prices for the given symbols, refreshed every 15 s while the tab is visible in the regular session. */
export function useLivePrices(symbols: readonly string[]): Record<string, LivePrice | undefined> {
  const key = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].join(',');
  useEffect(() => {
    if (!key) return;
    const list = key.split(',');
    for (const symbol of list) wanted.set(symbol, (wanted.get(symbol) ?? 0) + 1);
    schedule();
    return () => {
      for (const symbol of list) {
        const count = (wanted.get(symbol) ?? 1) - 1;
        if (count > 0) wanted.set(symbol, count);
        else wanted.delete(symbol);
      }
      schedule();
    };
  }, [key]);
  const current = useSyncExternalStore(subscribe, () => version, () => 0);
  return useMemo(() => {
    void current;
    const result: Record<string, LivePrice | undefined> = {};
    if (key) for (const symbol of key.split(',')) result[symbol] = prices.get(symbol);
    return result;
  }, [key, current]);
}

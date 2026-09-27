'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

/**
 * Browser side of the live price stream: components register the symbols they show, one
 * EventSource carries all of them (capped at 50, first registered first), and components
 * re-render only when prices arrive.
 */

export type LivePrice = { symbol: string; price: number; change: number | null; changePct: number | null; timestamp: number };

const MAX = 50;
const wanted = new Map<string, number>();
const prices = new Map<string, LivePrice>();
const listeners = new Set<() => void>();
let version = 0;
let source: EventSource | null = null;
let sourceKey = '';
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let unavailable = false;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function sync() {
  syncTimer = null;
  const symbols = [...wanted.keys()].slice(0, MAX).sort();
  const key = symbols.join(',');
  if (key === sourceKey || unavailable) return;
  source?.close();
  source = null;
  sourceKey = key;
  if (!symbols.length) return;
  const next = new EventSource(`/api/live?symbols=${encodeURIComponent(key)}`);
  next.onmessage = (event) => {
    try {
      for (const tick of JSON.parse(event.data) as LivePrice[]) prices.set(tick.symbol, tick);
      notify();
    } catch {}
  };
  // A non-200 answer (no Finnhub key) closes the stream for good: fall back to delayed data.
  next.onerror = () => {
    if (next.readyState === EventSource.CLOSED) {
      unavailable = true;
      if (source === next) source = null;
    }
  };
  source = next;
}

function schedule() {
  if (!syncTimer) syncTimer = setTimeout(sync, 250);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Real-time prices for the given symbols, when the server has a Finnhub key. */
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

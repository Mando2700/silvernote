'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { money, signedMoney } from '@/lib/format';

/**
 * Privacy mode: hides what a stranger could size up (portfolio dollar amounts and share counts) and leaves
 * percentages, weights and per-share prices visible, so the app can be screen-shared or shown in public.
 * It is a per-device choice kept in localStorage, so turning it on in a café doesn't hide anything on your desk.
 */
const KEY = 'silvernote:hide-values';
export const MASK = '•••••';

const listeners = new Set<() => void>();
let cached: boolean | null = null;

function read(): boolean {
  if (cached !== null) return cached;
  try {
    cached = window.localStorage.getItem(KEY) === '1';
  } catch {
    cached = false;
  }
  return cached;
}

function write(next: boolean) {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // Storage can be blocked (private window): the mode still works for this page view.
  }
  document.documentElement.dataset.privacy = next ? 'on' : 'off';
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab flipping the switch should flip this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cached = event.newValue === '1';
    document.documentElement.dataset.privacy = cached ? 'on' : 'off';
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** `hidden` is false on the server and during hydration, then settles on the saved choice. */
export function usePrivacy() {
  const hidden = useSyncExternalStore(subscribe, read, () => false);
  const toggle = useCallback(() => write(!read()), []);
  const set = useCallback((next: boolean) => write(next), []);
  return { hidden, toggle, set };
}

/** Make the saved choice visible to CSS (`html[data-privacy='on']`) as soon as the app mounts. */
export function applySavedPrivacy() {
  document.documentElement.dataset.privacy = read() ? 'on' : 'off';
}

/** Dollar formatters that show a mask while privacy mode is on. Use for amounts that belong to the user. */
export function useMoney() {
  const { hidden } = usePrivacy();
  return {
    hidden,
    money: (value: number | null | undefined, options?: Parameters<typeof money>[1]) => (hidden && typeof value === 'number' && Number.isFinite(value) ? MASK : money(value, options)),
    signedMoney: (value: number | null | undefined, options?: Parameters<typeof signedMoney>[1]) =>
      hidden && typeof value === 'number' && Number.isFinite(value) ? MASK : signedMoney(value, options),
  };
}

/** Share and unit counts: shown as-is, or masked. */
export function useQuantity() {
  const { hidden } = usePrivacy();
  return (value: number | null | undefined, maximumFractionDigits = 4) =>
    typeof value !== 'number' || !Number.isFinite(value) ? '—' : hidden ? MASK : value.toLocaleString('en-US', { maximumFractionDigits });
}

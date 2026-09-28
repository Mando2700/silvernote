'use client';

import useSWR from 'swr';

import type { ExtendedQuote } from '@/lib/data/types';

/** Pre-market / after-hours moves for the symbols on screen, refreshed every minute (empty during regular hours). */
export function useExtendedQuotes(symbols: readonly string[]): Record<string, ExtendedQuote | undefined> {
  const key = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].sort().slice(0, 60).join(',');
  const { data } = useSWR<Record<string, ExtendedQuote>>(key ? `/api/quotes/extended?symbols=${encodeURIComponent(key)}` : null, { refreshInterval: 60_000 });
  return data ?? {};
}

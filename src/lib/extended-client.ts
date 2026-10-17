'use client';

import { useState } from 'react';
import useSWR from 'swr';

import type { ExtendedQuote } from '@/lib/data/types';
import { marketSession } from '@/lib/session';

/** Quick re-polls while symbols are missing, before falling back to the minute refresh. */
const FILL_RETRIES = 5;

/** Pre-market / after-hours moves for the symbols on screen, refreshed every minute (empty during regular hours). */
export function useExtendedQuotes(symbols: readonly string[]): Record<string, ExtendedQuote | undefined> {
  const key = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))].sort().slice(0, 60).join(',');
  // On a cold cache the server answers with what loaded within its budget and keeps fetching the rest: re-poll quickly while
  // symbols are still missing, a few times only (funds and thin names without extended trading never get one).
  const [fill, setFill] = useState({ key: '', loads: 0, missing: false });
  const quick = fill.key === key && fill.missing && fill.loads <= FILL_RETRIES;
  const { data } = useSWR<Record<string, ExtendedQuote>>(key ? `/api/quotes/extended?symbols=${encodeURIComponent(key)}` : null, {
    refreshInterval: quick ? 3_000 : 60_000,
    onSuccess: (latest) =>
      setFill((previous) => ({
        key,
        loads: previous.key === key ? previous.loads + 1 : 1,
        missing: marketSession() !== 'regular' && key.split(',').some((symbol) => !latest[symbol]),
      })),
  });
  return data ?? {};
}

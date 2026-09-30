'use client';

import useSWR from 'swr';

import { useShell } from '@/components/shell/providers';

/** Converts USD amounts into the investor's base currency (Settings → Base currency). Null when USD or unavailable. */
export function useBaseCurrency() {
  const { prefs } = useShell();
  const currency = prefs.baseCurrency || 'USD';
  const { data } = useSWR<{ currency: string; perUsd: number | null }>(currency === 'USD' ? null : `/api/fx?currency=${currency}`, { refreshInterval: 30 * 60_000 });
  const rate = data?.perUsd ?? null;
  return {
    currency,
    rate,
    convert: (usd: number | null | undefined) => (rate && typeof usd === 'number' ? usd * rate : null),
    format: (usd: number | null | undefined, digits = 0) => {
      if (!rate || typeof usd !== 'number') return null;
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(usd * rate);
    },
  };
}

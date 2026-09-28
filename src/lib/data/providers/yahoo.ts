import 'server-only';

import { fetchJson, limiters } from '@/lib/data/http';
import type { Split } from '@/lib/finance/ledger';

/**
 * Yahoo Finance chart API (keyless, unofficial): used only for the split history, which none of the
 * other free sources expose. When it fails, callers infer splits from prices instead.
 */

type ChartPayload = {
  chart?: {
    result?: Array<{ events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> } }> | null;
    error?: { description?: string } | null;
  };
};

function newYorkDate(epochSeconds: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Every split on record for a US ticker, oldest first (factor = new shares per old share). */
export async function fetchSplits(symbol: string): Promise<Split[]> {
  const ticker = encodeURIComponent(symbol.toUpperCase().replace('.', '-'));
  const payload = await fetchJson<ChartPayload>(`https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?range=max&interval=3mo&events=split`, {
    provider: 'yahoo',
    limiter: limiters.yahoo,
    // Yahoo rate-limits full browser user agents that arrive without its cookies; a bare one is served.
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const events = payload.chart?.result?.[0]?.events?.splits ?? {};
  return Object.values(events)
    .filter((event) => event.numerator > 0 && event.denominator > 0 && Number.isFinite(event.date))
    .map((event) => ({ date: newYorkDate(event.date), factor: event.numerator / event.denominator }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

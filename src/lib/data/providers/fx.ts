import 'server-only';

import { cached, fetchJson, limiters } from '@/lib/data/http';

/** All USD cross rates in one keyless call (open.er-api.com, 160+ currencies incl. TWD); ECB as backup. */
async function usdRates(): Promise<Record<string, number>> {
  return cached('fx:usd-rates', 12 * 3600, async () => {
    try {
      const payload = await fetchJson<{ result?: string; rates?: Record<string, number> }>('https://open.er-api.com/v6/latest/USD', {
        provider: 'er-api',
        limiter: limiters.fred,
      });
      if (payload.result === 'success' && payload.rates?.EUR) return payload.rates;
    } catch {
      // fall through to the ECB rates
    }
    const payload = await fetchJson<{ rates?: Record<string, number> }>('https://api.frankfurter.dev/v1/latest?base=USD', {
      provider: 'frankfurter',
      limiter: limiters.fred,
    });
    if (!payload.rates) throw new Error('No FX rates available');
    return { USD: 1, ...payload.rates };
  });
}

/** How many USD one unit of `currency` buys, or null when no rate is available. */
export async function usdPerUnit(currency: string): Promise<number | null> {
  const code = currency.toUpperCase();
  if (code === 'USD') return 1;
  try {
    const rates = await usdRates();
    const unitsPerUsd = rates[code];
    return unitsPerUsd && Number.isFinite(unitsPerUsd) && unitsPerUsd > 0 ? 1 / unitsPerUsd : null;
  } catch {
    return null;
  }
}

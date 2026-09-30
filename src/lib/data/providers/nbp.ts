import 'server-only';

import { cached, fetchJson, limiters } from '@/lib/data/http';

type NbpPayload = { rates?: Array<{ effectiveDate: string; mid: number }> };

/** NBP table A mid rates (PLN per unit) for one calendar year; past years are kept for good. */
function yearRates(currency: string, year: number) {
  const current = new Date().getUTCFullYear();
  const end = year === current ? new Date().toISOString().slice(0, 10) : `${year}-12-31`;
  return cached(`nbp:${currency}:${year}`, year < current ? 365 * 86_400 : 6 * 3600, async () => {
    const payload = await fetchJson<NbpPayload>(`https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/${year}-01-01/${end}/?format=json`, {
      provider: 'nbp',
      limiter: limiters.fred,
    });
    return (payload.rates ?? []).map((row) => ({ date: row.effectiveDate, rate: row.mid }));
  });
}

/** Every NBP rate from the year before `fromYear` (for early-January trades) through today, ascending. */
export async function nbpRates(currency: string, fromYear: number) {
  const current = new Date().getUTCFullYear();
  const years = Array.from({ length: current - fromYear + 2 }, (_, index) => fromYear - 1 + index).filter((year) => year >= 2002);
  const lists = await Promise.all(years.map((year) => yearRates(currency, year).catch(() => [])));
  return lists.flat().sort((a, b) => a.date.localeCompare(b.date));
}

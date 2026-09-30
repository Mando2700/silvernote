import 'server-only';

import { cached } from '@/lib/data/http';
import * as nasdaq from '@/lib/data/providers/nasdaq';
import { todayInNewYork } from '@/lib/dates';
import { getUserSymbols } from '@/lib/services/news';
import { getSecuritiesBySymbols } from '@/lib/services/universe';

/** US releases that move the whole market. Everything else from the US is shown as normal importance. */
const MAJOR = /\b(CPI|PPI|PCE|nonfarm|non-farm|payrolls|unemployment rate|FOMC|fed(eral)? (funds|interest)|interest rate decision|GDP|retail sales|ISM|JOLTS|jobless claims|consumer (confidence|sentiment)|powell)\b/i;

export type CalendarDay = {
  date: string;
  earnings: Array<nasdaq.EarningsEvent & { mine: boolean }>;
  dividends: Array<nasdaq.DividendEvent & { mine: boolean }>;
  economy: Array<nasdaq.EconomicEvent & { major: boolean }>;
};

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Past days never change; today and the future refresh every few hours. */
function ttlFor(date: string) {
  return date < todayInNewYork() ? 30 * 86_400 : 4 * 3600;
}

export function earningsOn(date: string) {
  return cached(`cal:earnings:${date}`, ttlFor(date), () => nasdaq.fetchEarningsCalendar(date)).catch(() => [] as nasdaq.EarningsEvent[]);
}

function dividendsOn(date: string) {
  return cached(`cal:dividends:${date}`, ttlFor(date), () => nasdaq.fetchDividendCalendar(date)).catch(() => [] as nasdaq.DividendEvent[]);
}

function economyOn(date: string) {
  return cached(`cal:economy-v2:${date}`, date < todayInNewYork() ? 30 * 86_400 : 3600, () => nasdaq.fetchEconomicCalendar(date)).catch(() => [] as nasdaq.EconomicEvent[]);
}

/**
 * Earnings, ex-dividend dates and US economic releases between `from` and `to` (inclusive, at most
 * 31 days). `mine` marks the companies the investor holds or watches; for everyone else only
 * companies above `minMarketCap` are kept so a day isn't hundreds of micro caps.
 */
export async function getCalendar(userId: string, from: string, to: string, minMarketCap = 10e9): Promise<CalendarDay[]> {
  const dates: string[] = [];
  for (let date = from; date <= to && dates.length < 31; date = addDays(date, 1)) if (!isWeekend(date)) dates.push(date);
  const mine = new Set((await getUserSymbols(userId, 200)).map((row) => row.symbol));
  const days = await Promise.all(
    dates.map(async (date) => {
      const [earnings, dividends, economy] = await Promise.all([earningsOn(date), dividendsOn(date), economyOn(date)]);
      return { date, earnings, dividends, economy };
    }),
  );
  // Dividend rows carry no market value: keep listed common stocks the investor follows or large ones.
  const dividendSymbols = [...new Set(days.flatMap((day) => day.dividends.map((row) => row.symbol)))];
  const securities = new Map((await getSecuritiesBySymbols(dividendSymbols)).map((row) => [row.symbol, row]));
  return days.map((day) => ({
    date: day.date,
    earnings: day.earnings
      .map((row) => ({ ...row, mine: mine.has(row.symbol) }))
      .filter((row) => row.mine || (row.marketCap ?? 0) >= minMarketCap)
      .sort((a, b) => Number(b.mine) - Number(a.mine) || (b.marketCap ?? 0) - (a.marketCap ?? 0)),
    dividends: day.dividends
      .map((row) => ({ ...row, mine: mine.has(row.symbol) }))
      .filter((row) => {
        const security = securities.get(row.symbol);
        return row.mine || (security?.is_common && (security.market_cap ?? 0) >= minMarketCap);
      }),
    economy: day.economy
      .filter((row) => row.country === 'United States')
      .map((row) => ({ ...row, major: MAJOR.test(row.name) })),
  }));
}

/** The next scheduled report date for each symbol within `days` trading days (for alerts and previews). */
export async function upcomingEarnings(symbols: string[], days = 10) {
  const wanted = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const found = new Map<string, nasdaq.EarningsEvent>();
  const start = todayInNewYork();
  for (let offset = 0, checked = 0; checked < days && offset < days * 2; offset += 1) {
    const date = addDays(start, offset);
    if (isWeekend(date)) continue;
    checked += 1;
    for (const row of await earningsOn(date)) if (wanted.has(row.symbol) && !found.has(row.symbol)) found.set(row.symbol, row);
  }
  return found;
}

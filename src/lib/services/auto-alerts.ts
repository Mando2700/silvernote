import 'server-only';

import { cached } from '@/lib/data/http';
import { fetchEarningsReports, fmpEnabled } from '@/lib/data/providers/fmp';
import { fetchEarningsSurprises } from '@/lib/data/providers/nasdaq';
import { q } from '@/lib/db';
import { todayInNewYork } from '@/lib/dates';
import { earningsOn, economyOn, isMajorRelease, upcomingEarnings } from '@/lib/services/calendar';
import { getUserSymbols } from '@/lib/services/news';
import { claimSlot } from '@/lib/slots';

/** Symbol stored on alert events that aren't about a company (links to the Macro page). */
export const MACRO_SYMBOL = 'MACRO';

const DAY = 86_400;

async function record(userId: string, symbol: string, kind: string, message: string, value: number | null) {
  await q('insert into public.alert_events (user_id, symbol, kind, message, value) values ($1, $2, $3, $4, $5)', [userId, symbol, kind, message, value]);
}

const money = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function bigMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return money(value);
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY * 1000).toISOString().slice(0, 10);

type ReportFigures = { eps: number | null; epsEstimate: number | null; revenue: number | null; revenueEstimate: number | null; quarter: string | null };

/**
 * Reported vs consensus figures for the report on `date`. EPS comes from Nasdaq; revenue (and EPS
 * when Nasdaq is behind) from Financial Modeling Prep, which needs FMP_API_KEY. Null until published.
 */
async function reportFigures(symbol: string, date: string): Promise<ReportFigures | null> {
  const [nasdaq, fmp] = await Promise.all([
    cached(`earnings-surprise:${symbol}`, 20 * 60, () => fetchEarningsSurprises(symbol)).catch(() => []),
    fmpEnabled() ? cached(`fmp-earnings:${symbol}`, 20 * 60, () => fetchEarningsReports(symbol)).catch(() => []) : Promise.resolve([]),
  ]);
  // A report is matched by date, allowing a day either side for after-close releases.
  const near = (other: string) => Math.abs(Date.parse(`${other}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) <= DAY * 1000;
  const reported = nasdaq.find((row) => near(row.reportedOn) && row.eps !== null);
  const detailed = fmp.find((row) => near(row.date) && row.epsActual !== null);
  const eps = reported?.eps ?? detailed?.epsActual ?? null;
  if (eps === null) return null;
  return {
    eps,
    epsEstimate: reported?.consensus ?? detailed?.epsEstimate ?? null,
    revenue: detailed?.revenueActual ?? null,
    revenueEstimate: detailed?.revenueEstimate ?? null,
    quarter: reported?.fiscalQuarter || null,
  };
}

/** "$1.91 vs $1.88 est (beat +1.6%)": the same shape for EPS and revenue. */
function versus(actual: number, estimate: number | null, format: (value: number) => string) {
  if (estimate === null) return `${format(actual)} (no consensus)`;
  const pct = estimate === 0 ? null : ((actual - estimate) / Math.abs(estimate)) * 100;
  const verdict = pct === null || Math.abs(pct) < 0.05 ? 'in line' : pct > 0 ? 'beat' : 'miss';
  return `${format(actual)} vs ${format(estimate)} est (${verdict}${pct !== null && verdict !== 'in line' ? ` ${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%` : ''})`;
}

/**
 * Earnings heads-up for every company the investor holds or watches: once per report, on the day
 * before or the day of the report. Symbols with their own earnings alert are left to that alert.
 */
export async function evaluateEarningsWatch(userId: string) {
  const symbols = await getUserSymbols(userId, 200);
  if (!symbols.length) return 0;
  const manual = new Set(
    (await q<{ symbol: string }>(`select symbol from public.alerts where user_id = $1 and active and kind = 'earnings'`, [userId])).map((row) => row.symbol),
  );
  const upcoming = await upcomingEarnings(symbols.map((row) => row.symbol), 3);
  const today = todayInNewYork();
  let fired = 0;
  for (const entry of symbols) {
    const event = upcoming.get(entry.symbol);
    if (!event || manual.has(entry.symbol)) continue;
    const days = Math.round((Date.parse(`${event.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / (DAY * 1000));
    if (days < 0 || days > 1) continue;
    if (!(await claimSlot(`auto:earnings:${userId}:${entry.symbol}:${event.date}`, 10 * DAY))) continue;
    const when = event.time === 'pre' ? ' before the open' : event.time === 'post' ? ' after the close' : '';
    const revenueEstimate = fmpEnabled()
      ? (await cached(`fmp-earnings:${entry.symbol}`, 20 * 60, () => fetchEarningsReports(entry.symbol)).catch(() => [])).find((row) => row.date === event.date)?.revenueEstimate ?? null
      : null;
    const expects = [event.epsForecast !== null ? `EPS ${money(event.epsForecast)}` : null, revenueEstimate ? `revenue ${bigMoney(revenueEstimate)}` : null].filter(Boolean);
    const eps = expects.length ? ` Consensus: ${expects.join(', ')}${event.estimates ? ` (${event.estimates} analysts)` : ''}.` : '';
    const role = entry.held ? 'Your holding' : 'On your watchlist';
    await record(userId, entry.symbol, 'earnings', `${role} ${entry.symbol} reports ${days === 0 ? 'today' : 'tomorrow'}${when} (${event.date}).${eps}`, days);
    fired += 1;
  }
  return fired;
}

const toNumber = (text: string | null) => {
  const match = text?.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
};

/** Release times arrive in GMT; the alert states them in New York time, like the market. */
function easternTime(date: string, gmt: string | null) {
  if (!gmt || !/^\d{1,2}:\d{2}$/.test(gmt)) return null;
  return new Date(`${date}T${gmt.padStart(5, '0')}:00Z`).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

/**
 * Major US releases (CPI, jobs, FOMC, GDP, …): a heads-up on the morning of the release and the
 * result against consensus as soon as it is published. Each fires once per release.
 */
export async function evaluateMacroWatch(userId: string) {
  const today = todayInNewYork();
  const events = (await economyOn(today)).filter((row) => row.country === 'United States' && isMajorRelease(row.name));
  let fired = 0;
  for (const event of events) {
    const key = `${userId}:${today}:${event.name}`.slice(0, 200);
    const detail = [event.consensus ? `consensus ${event.consensus}` : null, event.previous ? `previous ${event.previous}` : null].filter(Boolean).join(', ');
    if (event.actual === null) {
      if (!(await claimSlot(`auto:macro:pre:${key}`, 2 * DAY))) continue;
      const time = easternTime(today, event.time);
      await record(userId, MACRO_SYMBOL, 'macro', `Today${time ? ` at ${time} ET` : ''}: ${event.name}${detail ? ` (${detail})` : ''}.`, null);
    } else {
      if (!(await claimSlot(`auto:macro:result:${key}`, 2 * DAY))) continue;
      const actual = toNumber(event.actual);
      const consensus = toNumber(event.consensus);
      const verdict = actual === null || consensus === null ? '' : actual > consensus ? ', above consensus' : actual < consensus ? ', below consensus' : ', in line with consensus';
      await record(userId, MACRO_SYMBOL, 'macro', `${event.name} came in at ${event.actual}${verdict}${detail ? ` (${detail})` : ''}.`, actual);
    }
    fired += 1;
  }
  return fired;
}

/**
 * Results for companies the investor holds or watches: EPS and revenue against consensus, sent once
 * as soon as the figures are published (the report day, or the next morning for after-close reports).
 */
export async function evaluateEarningsResults(userId: string) {
  const symbols = new Map((await getUserSymbols(userId, 200)).map((row) => [row.symbol, row]));
  if (!symbols.size) return 0;
  const today = todayInNewYork();
  let fired = 0;
  for (const date of [addDays(today, -1), today]) {
    for (const event of await earningsOn(date)) {
      const entry = symbols.get(event.symbol);
      if (!entry) continue;
      const slot = `auto:earnings-result:${userId}:${event.symbol}:${date}`;
      // Peek first so unpublished results are retried on the next tick instead of burning the slot.
      const figures = await reportFigures(event.symbol, date);
      if (!figures || figures.eps === null) continue;
      if (!(await claimSlot(slot, 10 * DAY))) continue;
      const parts = [`EPS ${versus(figures.eps, figures.epsEstimate, money)}`];
      if (figures.revenue !== null) parts.push(`Revenue ${versus(figures.revenue, figures.revenueEstimate, bigMoney)}`);
      const pct = figures.epsEstimate ? ((figures.eps - figures.epsEstimate) / Math.abs(figures.epsEstimate)) * 100 : null;
      const role = entry.held ? 'Your holding' : 'On your watchlist';
      await record(userId, event.symbol, 'earnings_result', `${role} ${event.symbol} reported${figures.quarter ? ` ${figures.quarter}` : ''}: ${parts.join('. ')}.`, pct);
      fired += 1;
    }
  }
  return fired;
}

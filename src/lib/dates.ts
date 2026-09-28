/** Calendar dates that do not depend on the server's time zone. ISO `YYYY-MM-DD`. */

/** Today's date on the US market calendar (New York). Holding periods and maturities count in these days. */
export function todayInNewYork(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The latest date that is already "today" somewhere on Earth (UTC+14). Use it to reject future-dated
 * input without rejecting a trade entered just after midnight in the user's own time zone.
 */
export function latestValidDate(now = new Date()) {
  return new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10);
}

/** Today in the viewer's own time zone (for date inputs in the browser). */
export function localToday(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

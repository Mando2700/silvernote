const NEW_YORK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });

/** Regular US session (9:30–16:00 New York) of the trading day containing `t`, in unix seconds. */
export function regularSession(t: number) {
  const parts = NEW_YORK.formatToParts(new Date(t * 1000));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) / 1000;
  const offset = wallAsUtc - t; // New York wall clock minus real UTC (negative)
  const midnight = Date.UTC(get('year'), get('month') - 1, get('day')) / 1000;
  return { open: midnight + 9.5 * 3600 - offset, close: midnight + 16 * 3600 - offset };
}

/** Whole-hour marks inside the regular session (10:00 … 16:00). */
export function sessionHours(session: { open: number; close: number }) {
  const hours: number[] = [];
  for (let t = session.open + 1800; t <= session.close; t += 3600) hours.push(t);
  return hours;
}

export type MarketSession = 'pre' | 'regular' | 'post' | 'closed';

/** Which US session `date` falls in (weekends closed; exchange holidays not modelled). */
export function marketSession(date: Date | number | string = new Date()): MarketSession {
  const t = typeof date === 'object' ? date.getTime() : typeof date === 'string' ? Date.parse(date) : date;
  const parts = NEW_YORK.formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const weekday = new Date(Date.UTC(get('year'), get('month') - 1, get('day'))).getUTCDay();
  if (weekday === 0 || weekday === 6) return 'closed';
  const minutes = get('hour') * 60 + get('minute');
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'regular';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'post';
  return 'closed';
}

/** How to label a price change taken in `session`. */
export const SESSION_CHANGE_LABEL: Record<MarketSession, { short: string; long: string }> = {
  pre: { short: 'Pre-mkt', long: 'Pre-market change' },
  regular: { short: 'Day', long: 'Day change' },
  post: { short: 'After-hrs', long: 'After-hours change' },
  closed: { short: 'Last day', long: 'Last session change' },
};

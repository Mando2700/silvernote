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

import 'server-only';

import { todayInNewYork } from '@/lib/dates';
import { q } from '@/lib/db';
import { getLiveQuote } from '@/lib/services/market';

export type AlertKind =
  | 'price_above'
  | 'price_below'
  | 'change_pct'
  | 'score_above'
  | 'score_below'
  | 'score_change'
  | 'filing'
  | 'insider_buy'
  | 'earnings'
  | 'metric_above'
  | 'metric_below';

export const ALERT_KINDS = [
  'price_above', 'price_below', 'change_pct', 'score_above', 'score_below', 'score_change',
  'filing', 'insider_buy', 'earnings', 'metric_above', 'metric_below',
] as const satisfies readonly AlertKind[];

/** Fundamental ratios a metric alert (or a thesis kill criterion) can watch, as the screener computes them. */
export const ALERT_METRICS = {
  revenueGrowth: { label: 'Revenue growth', percent: true },
  epsGrowth: { label: 'EPS growth', percent: true },
  grossMargin: { label: 'Gross margin', percent: true },
  operatingMargin: { label: 'Operating margin', percent: true },
  netMargin: { label: 'Net margin', percent: true },
  fcfMargin: { label: 'FCF margin', percent: true },
  roe: { label: 'Return on equity', percent: true },
  debtToEquity: { label: 'Debt / equity', percent: false },
  currentRatio: { label: 'Current ratio', percent: false },
  pe: { label: 'P/E', percent: false },
  ps: { label: 'P/S', percent: false },
  evEbitda: { label: 'EV / EBITDA', percent: false },
  fcfYield: { label: 'FCF yield', percent: true },
  dividendYield: { label: 'Dividend yield', percent: true },
  marketCap: { label: 'Market value', percent: false },
} as const;
export type AlertMetric = keyof typeof ALERT_METRICS;

export type AlertRow = {
  id: string;
  user_id: string;
  symbol: string;
  kind: AlertKind;
  threshold: number;
  active: boolean;
  note: string | null;
  last_value: number | null;
  triggered_at: Date | null;
  created_at: Date;
  metric: string | null;
  source: string | null;
  state: Record<string, unknown>;
};

const money = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

async function fire(alert: Pick<AlertRow, 'id' | 'user_id' | 'symbol' | 'kind'>, message: string, value: number, deactivate: boolean) {
  await q(
    'insert into public.alert_events (user_id, alert_id, symbol, kind, message, value) values ($1, $2, $3, $4, $5, $6)',
    [alert.user_id, alert.id, alert.symbol, alert.kind, message, value],
  );
  await q(
    `update public.alerts set triggered_at = now(), last_value = $2, active = case when $3 then false else active end where id = $1`,
    [alert.id, value, deactivate],
  );
}

/** Price alerts are checked after every market snapshot; above/below fire once, daily moves once per day. */
export async function evaluatePriceAlerts() {
  const rows = await q<AlertRow & { price: number | null; change_pct: number | null; name: string }>(
    `select a.*, s.price, s.change_pct, s.name from public.alerts a
     left join public.securities s on s.symbol = a.symbol
     where a.active and a.kind in ('price_above', 'price_below', 'change_pct')`,
  );
  // Funds and other symbols outside the stock universe are priced from a live quote.
  for (const alert of rows) {
    if (alert.price !== null && alert.price !== undefined) continue;
    const quote = await getLiveQuote(alert.symbol).catch(() => null);
    alert.price = quote?.price ?? null;
    alert.change_pct = quote?.changePct ?? null;
  }
  let fired = 0;
  const today = todayInNewYork();
  for (const alert of rows) {
    if (alert.price === null) continue;
    if (alert.kind === 'price_above' && alert.price >= alert.threshold) {
      await fire(alert, `${alert.symbol} rose to ${money(alert.price)}, above your ${money(alert.threshold)} alert.`, alert.price, true);
      fired += 1;
    } else if (alert.kind === 'price_below' && alert.price <= alert.threshold) {
      await fire(alert, `${alert.symbol} fell to ${money(alert.price)}, below your ${money(alert.threshold)} alert.`, alert.price, true);
      fired += 1;
    } else if (alert.kind === 'change_pct' && alert.change_pct !== null && Math.abs(alert.change_pct) >= alert.threshold) {
      const firedToday = alert.triggered_at && todayInNewYork(new Date(alert.triggered_at)) === today;
      if (!firedToday) {
        const sign = alert.change_pct > 0 ? '+' : '−';
        await fire(alert, `${alert.symbol} moved ${sign}${Math.abs(alert.change_pct).toFixed(2)}% today.`, alert.change_pct, false);
        fired += 1;
      }
    }
  }
  return fired;
}

/** Score alerts re-arm automatically: they fire on crossings and on large moves. */
export async function evaluateScoreAlerts(symbol: string, next: number, previous: number) {
  const rows = await q<AlertRow>(
    `select * from public.alerts where symbol = $1 and active and kind in ('score_above', 'score_below', 'score_change')`,
    [symbol],
  );
  for (const alert of rows) {
    if (alert.kind === 'score_above' && next >= alert.threshold && previous < alert.threshold) {
      await fire(alert, `${symbol}'s SilverNote Score climbed to ${next} (was ${previous}), crossing ${alert.threshold}.`, next, false);
    } else if (alert.kind === 'score_below' && next <= alert.threshold && previous > alert.threshold) {
      await fire(alert, `${symbol}'s SilverNote Score dropped to ${next} (was ${previous}), crossing ${alert.threshold}.`, next, false);
    } else if (alert.kind === 'score_change' && Math.abs(next - previous) >= alert.threshold) {
      await fire(alert, `${symbol}'s SilverNote Score moved ${next > previous ? '+' : '−'}${Math.abs(next - previous)} to ${next}.`, next, false);
    }
  }
}

export function listAlerts(userId: string, symbol?: string) {
  return symbol
    ? q<AlertRow>('select * from public.alerts where user_id = $1 and symbol = $2 order by created_at desc', [userId, symbol.toUpperCase()])
    : q<AlertRow>('select * from public.alerts where user_id = $1 order by active desc, created_at desc', [userId]);
}

export async function createAlert(
  userId: string,
  input: { symbol: string; kind: AlertKind; threshold: number; note?: string | null; metric?: string | null; source?: string | null },
) {
  if ((input.kind === 'metric_above' || input.kind === 'metric_below') && !(input.metric && input.metric in ALERT_METRICS)) {
    throw new Error('Metric alerts need a known metric.');
  }
  const [row] = await q<AlertRow>(
    'insert into public.alerts (user_id, symbol, kind, threshold, note, metric, source) values ($1, $2, $3, $4, $5, $6, $7) returning *',
    [userId, input.symbol.toUpperCase(), input.kind, input.threshold, input.note ?? null, input.metric ?? null, input.source ?? null],
  );
  return row;
}

export async function updateAlert(userId: string, id: string, patch: { active?: boolean; threshold?: number }) {
  const [row] = await q<AlertRow>(
    `update public.alerts set active = coalesce($3, active), threshold = coalesce($4, threshold)
     where id = $1 and user_id = $2 returning *`,
    [id, userId, patch.active ?? null, patch.threshold ?? null],
  );
  return row ?? null;
}

export async function deleteAlert(userId: string, id: string) {
  await q('delete from public.alerts where id = $1 and user_id = $2', [id, userId]);
}

export function listAlertEvents(userId: string, limit = 50) {
  return q<{ id: string; symbol: string; kind: string; message: string; value: number | null; created_at: Date; read_at: Date | null }>(
    'select id, symbol, kind, message, value, created_at, read_at from public.alert_events where user_id = $1 order by created_at desc limit $2',
    [userId, limit],
  );
}

export async function markEventsRead(userId: string) {
  await q('update public.alert_events set read_at = now() where user_id = $1 and read_at is null', [userId]);
}

// ─── Event alerts: filings, insider buying, earnings, fundamentals ──────────

const KEY_FILINGS = /^(10-K|10-Q|8-K|20-F|6-K|S-1|S-4|DEF 14A|SC 13D|SC 13G|424B)/;

async function saveState(id: string, state: Record<string, unknown>) {
  await q('update public.alerts set state = $2::jsonb where id = $1', [id, JSON.stringify(state)]);
}

const metricLabel = (metric: string, value: number) => {
  const meta = ALERT_METRICS[metric as AlertMetric];
  if (!meta) return String(value);
  return meta.percent ? `${(value * 100).toFixed(1)}%` : metric === 'marketCap' ? money(value) : value.toFixed(2);
};

/**
 * Filings, insider purchases, upcoming earnings and fundamental thresholds (thesis kill criteria).
 * Each alert remembers what it has already seen in `state`, so the first check only arms it.
 */
export async function evaluateEventAlerts() {
  const rows = await q<AlertRow>(
    `select * from public.alerts where active and kind in ('filing', 'insider_buy', 'earnings', 'metric_above', 'metric_below') order by symbol`,
  );
  if (!rows.length) return 0;
  const [{ getFilings }, { getInsiderTrades }, { upcomingEarnings }, { getUniverse }] = await Promise.all([
    import('@/lib/services/market'),
    import('@/lib/services/sec-insights'),
    import('@/lib/services/calendar'),
    import('@/lib/services/screener'),
  ]);
  let fired = 0;

  const earningsSymbols = rows.filter((row) => row.kind === 'earnings').map((row) => row.symbol);
  const earnings = earningsSymbols.length ? await upcomingEarnings(earningsSymbols, 10) : new Map();
  const metricRows = rows.filter((row) => row.kind === 'metric_above' || row.kind === 'metric_below');
  const universe = metricRows.length ? new Map((await getUniverse()).map((entry) => [entry.symbol, entry as unknown as Record<string, number | null>])) : new Map();

  for (const alert of rows) {
    const state = alert.state ?? {};
    try {
      if (alert.kind === 'filing') {
        const filings = (await getFilings(alert.symbol)).filter((filing) => KEY_FILINGS.test(filing.form));
        const seen = typeof state.lastAccession === 'string' ? state.lastAccession : null;
        const fresh = seen ? filings.slice(0, Math.max(0, filings.findIndex((filing) => filing.accession === seen))) : [];
        if (seen === null && filings[0]) await saveState(alert.id, { ...state, lastAccession: filings[0].accession });
        if (fresh.length) {
          for (const filing of fresh.slice(0, 3).reverse()) {
            await fire(alert, `${alert.symbol} filed a ${filing.form}${filing.description ? ` (${filing.description})` : ''} on ${filing.filedAt}.`, 0, false);
            fired += 1;
          }
          await saveState(alert.id, { ...state, lastAccession: fresh[0].accession });
        }
      } else if (alert.kind === 'insider_buy') {
        const buys = (await getInsiderTrades(alert.symbol, 15)).filter((row) => row.kind === 'buy' && (row.value ?? 0) >= alert.threshold);
        const seen = new Set(Array.isArray(state.seen) ? (state.seen as string[]) : []);
        const armed = Array.isArray(state.seen);
        const fresh = buys.filter((row) => !seen.has(`${row.accession}:${row.date}:${row.shares}`));
        if (armed) {
          for (const row of fresh.slice(0, 3)) {
            await fire(alert, `${row.owner} (${row.role}) bought ${row.shares.toLocaleString()} ${alert.symbol} shares${row.value ? ` for ${money(row.value)}` : ''} on ${row.date}.`, row.value ?? 0, false);
            fired += 1;
          }
        }
        for (const row of buys) seen.add(`${row.accession}:${row.date}:${row.shares}`);
        await saveState(alert.id, { ...state, seen: [...seen].slice(-200) });
      } else if (alert.kind === 'earnings') {
        const event = earnings.get(alert.symbol);
        if (event) {
          const days = Math.round((Date.parse(`${event.date}T12:00:00Z`) - Date.parse(`${todayInNewYork()}T12:00:00Z`)) / 86_400_000);
          if (days <= Math.max(0, alert.threshold) && state.notifiedFor !== event.date) {
            const when = event.time === 'pre' ? 'before the open' : event.time === 'post' ? 'after the close' : '';
            const eps = event.epsForecast !== null ? ` Consensus EPS ${money(event.epsForecast)}.` : '';
            await fire(alert, `${alert.symbol} reports ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`} (${event.date}${when ? `, ${when}` : ''}).${eps}`, days, false);
            await saveState(alert.id, { ...state, notifiedFor: event.date });
            fired += 1;
          }
        }
      } else if (alert.metric) {
        const value = universe.get(alert.symbol)?.[alert.metric];
        if (typeof value === 'number' && Number.isFinite(value)) {
          const breached = alert.kind === 'metric_above' ? value >= alert.threshold : value <= alert.threshold;
          // Fire on the crossing, re-arm once the metric is back on the right side.
          if (breached && state.breached !== true) {
            const label = ALERT_METRICS[alert.metric as AlertMetric]?.label ?? alert.metric;
            const direction = alert.kind === 'metric_above' ? 'rose to' : 'fell to';
            const prefix = alert.source === 'thesis' ? 'Thesis kill criterion hit: ' : '';
            await fire(alert, `${prefix}${alert.symbol} ${label} ${direction} ${metricLabel(alert.metric, value)} (limit ${metricLabel(alert.metric, alert.threshold)}).${alert.note ? ` ${alert.note}` : ''}`, value, false);
            fired += 1;
          }
          if (breached !== (state.breached === true)) await saveState(alert.id, { ...state, breached });
        }
      }
    } catch {
      // One bad symbol must not stop the sweep.
    }
  }
  return fired;
}

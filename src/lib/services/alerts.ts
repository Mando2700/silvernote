import 'server-only';

import { q } from '@/lib/db';

export type AlertKind = 'price_above' | 'price_below' | 'change_pct' | 'score_above' | 'score_below' | 'score_change';

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
     join public.securities s on s.symbol = a.symbol
     where a.active and a.kind in ('price_above', 'price_below', 'change_pct')`,
  );
  let fired = 0;
  for (const alert of rows) {
    if (alert.price === null) continue;
    if (alert.kind === 'price_above' && alert.price >= alert.threshold) {
      await fire(alert, `${alert.symbol} rose to ${money(alert.price)}, above your ${money(alert.threshold)} alert.`, alert.price, true);
      fired += 1;
    } else if (alert.kind === 'price_below' && alert.price <= alert.threshold) {
      await fire(alert, `${alert.symbol} fell to ${money(alert.price)}, below your ${money(alert.threshold)} alert.`, alert.price, true);
      fired += 1;
    } else if (alert.kind === 'change_pct' && alert.change_pct !== null && Math.abs(alert.change_pct) >= alert.threshold) {
      const firedToday = alert.triggered_at && new Date(alert.triggered_at).toDateString() === new Date().toDateString();
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

export async function createAlert(userId: string, input: { symbol: string; kind: AlertKind; threshold: number; note?: string | null }) {
  const [row] = await q<AlertRow>(
    'insert into public.alerts (user_id, symbol, kind, threshold, note) values ($1, $2, $3, $4, $5) returning *',
    [userId, input.symbol.toUpperCase(), input.kind, input.threshold, input.note ?? null],
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

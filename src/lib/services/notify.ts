import 'server-only';

import webpush from 'web-push';

import { q } from '@/lib/db';
import { env } from '@/lib/env';

export type Notice = { title: string; body: string; url?: string; tag?: string };

export function pushEnabled() {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
}

export function telegramEnabled() {
  return Boolean(env.telegramBotToken && env.telegramChatId);
}

let vapidReady = false;
function ensureVapid() {
  if (vapidReady || !pushEnabled()) return pushEnabled();
  webpush.setVapidDetails(`mailto:${env.ownerEmail || 'owner@silvernote.local'}`, env.vapidPublicKey, env.vapidPrivateKey);
  vapidReady = true;
  return true;
}

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

async function sendPush(userId: string, notice: Notice) {
  if (!ensureVapid()) return 0;
  const subs = await q<Subscription>('select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = $1 and failed_at is null', [userId]);
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(notice), { TTL: 6 * 3600 });
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped the subscription.
        if (status === 404 || status === 410) await q('delete from public.push_subscriptions where id = $1', [sub.id]);
        else await q('update public.push_subscriptions set failed_at = now() where id = $1', [sub.id]).catch(() => {});
      }
    }),
  );
  return sent;
}

function escapeTelegram(text: string) {
  return text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] as string);
}

async function sendTelegram(notice: Notice) {
  if (!telegramEnabled()) return false;
  const base = process.env.APP_URL?.replace(/\/$/, '') ?? '';
  const link = notice.url && base ? `\n<a href="${base}${notice.url}">Open in SilverNote</a>` : '';
  const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.telegramChatId,
      text: `<b>${escapeTelegram(notice.title)}</b>\n${escapeTelegram(notice.body).slice(0, 3500)}${link}`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

async function channels(userId: string) {
  const rows = await q<{ data: { notify?: { push?: boolean; telegram?: boolean } } }>('select data from public.user_settings where user_id = $1', [userId]);
  const notify = rows[0]?.data?.notify ?? {};
  // Both channels default on once configured; the settings page can turn either off.
  return { push: notify.push !== false, telegram: notify.telegram !== false };
}

/** Send one notice over every channel the owner has configured and left on. */
export async function notify(userId: string, notice: Notice) {
  const use = await channels(userId);
  const [push, telegram] = await Promise.all([
    use.push ? sendPush(userId, notice).catch(() => 0) : 0,
    use.telegram ? sendTelegram(notice).catch(() => false) : false,
  ]);
  return { push, telegram };
}

/** Deliver alert events that haven't gone out yet (older than two days are just marked, not sent). */
export async function deliverPendingEvents() {
  if (!pushEnabled() && !telegramEnabled()) return 0;
  const events = await q<{ id: string; user_id: string; symbol: string; message: string; created_at: Date }>(
    `select id, user_id, symbol, message, created_at from public.alert_events
     where delivered_at is null order by created_at limit 50`,
  );
  let delivered = 0;
  for (const event of events) {
    const fresh = Date.now() - new Date(event.created_at).getTime() < 2 * 86_400_000;
    if (fresh) {
      await notify(event.user_id, { title: `${event.symbol} alert`, body: event.message, url: `/company/${event.symbol}`, tag: `alert-${event.id}` });
      delivered += 1;
    }
    await q('update public.alert_events set delivered_at = now() where id = $1', [event.id]);
  }
  return delivered;
}

export async function savePushSubscription(userId: string, input: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null) {
  await q(
    `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failed_at = null`,
    [userId, input.endpoint, input.keys.p256dh, input.keys.auth, userAgent?.slice(0, 300) ?? null],
  );
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  await q('delete from public.push_subscriptions where user_id = $1 and endpoint = $2', [userId, endpoint]);
}

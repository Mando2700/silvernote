import 'server-only';

import { q } from '@/lib/db';
import { env } from '@/lib/env';
import { todayInNewYork } from '@/lib/dates';
import { schedulerTick } from '@/lib/jobs';
import { claimSlot } from '@/lib/slots';
import { evaluateEventAlerts, evaluatePriceAlerts } from '@/lib/services/alerts';
import { evaluateEarningsResults, evaluateEarningsWatch, evaluateMacroWatch } from '@/lib/services/auto-alerts';
import { earningsPreview, morningBrief, weeklyRedTeam } from '@/lib/services/briefs';
import { upcomingEarnings } from '@/lib/services/calendar';
import { getUserSymbols } from '@/lib/services/news';
import { deliverPendingEvents } from '@/lib/services/notify';

function newYorkClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)}`;
}

async function owners() {
  const rows = await q<{ user_id: string; data: { notify?: { morningBrief?: boolean; weeklyRedTeam?: boolean; earningsWatch?: boolean; macro?: boolean } } | null }>(
    `select u.user_id, s.data from (select distinct user_id from public.portfolios union select user_id from public.user_settings
       union select user_id from public.watchlists) u left join public.user_settings s on s.user_id = u.user_id`,
  );
  return rows;
}

type Step = { step: string; ok: boolean; detail?: unknown };

/** One scheduler run: refresh data, check every alert, deliver notifications and write any briefs that are due. */
export async function runCron(): Promise<Step[]> {
  const steps: Step[] = [];
  const run = async (step: string, work: () => Promise<unknown>) => {
    try {
      steps.push({ step, ok: true, detail: await work() });
    } catch (error) {
      steps.push({ step, ok: false, detail: (error as Error).message });
    }
  };

  await run('scheduler', () => schedulerTick());
  await run('price alerts', async () => ((await claimSlot('cron:price-alerts', 240)) ? evaluatePriceAlerts() : 'skipped'));
  await run('event alerts', async () => ((await claimSlot('cron:event-alerts', 25 * 60)) ? evaluateEventAlerts() : 'skipped'));
  await run('watch alerts', async () => {
    let fired = 0;
    for (const owner of await owners()) {
      const notify = owner.data?.notify ?? {};
      if (!(await claimSlot(`cron:watch-alerts:${owner.user_id}`, 10 * 60))) continue;
      if (notify.earningsWatch !== false) {
        fired += await evaluateEarningsWatch(owner.user_id).catch(() => 0);
        fired += await evaluateEarningsResults(owner.user_id).catch(() => 0);
      }
      if (notify.macro !== false) fired += await evaluateMacroWatch(owner.user_id).catch(() => 0);
    }
    return fired;
  });
  await run('deliver', () => deliverPendingEvents());

  if (!env.xaiKey) return steps;
  const clock = newYorkClock();
  const weekday = !['Sat', 'Sun'].includes(clock.weekday);
  const today = todayInNewYork();
  for (const owner of await owners()) {
    const notify = owner.data?.notify ?? {};
    if (weekday && clock.minutes >= 7 * 60 + 30 && clock.minutes < 11 * 60 && notify.morningBrief !== false) {
      if (await claimSlot(`brief:morning:${owner.user_id}:${today}`, 36 * 3600)) await run('morning brief', () => morningBrief(owner.user_id).then((row) => row.id));
    }
    if (clock.weekday === 'Sun' && clock.minutes >= 10 * 60 && notify.weeklyRedTeam !== false) {
      if (await claimSlot(`brief:redteam:${owner.user_id}:${isoWeek()}`, 8 * 86_400)) await run('red team', () => weeklyRedTeam(owner.user_id).then((rows) => rows.length));
    }
    // After the close: previews for holdings that report on the next trading day.
    if (weekday && clock.minutes >= 16 * 60 + 30 && clock.minutes < 22 * 60) {
      await run('earnings previews', async () => {
        const held = (await getUserSymbols(owner.user_id, 60)).filter((row) => row.held).map((row) => row.symbol);
        if (!held.length) return 0;
        const upcoming = await upcomingEarnings(held, 2);
        let made = 0;
        for (const event of upcoming.values()) {
          if (event.date <= today || made >= 3) continue;
          if (await claimSlot(`brief:preview:${owner.user_id}:${event.symbol}:${event.date}`, 10 * 86_400)) {
            await earningsPreview(owner.user_id, event.symbol, event.date);
            made += 1;
          }
        }
        return made;
      });
    }
  }
  return steps;
}

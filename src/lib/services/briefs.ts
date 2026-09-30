import 'server-only';

import { buildContext, SYSTEM_PROMPT } from '@/lib/ai/context';
import { streamGrok } from '@/lib/ai/grok';
import { runTool, TOOLS } from '@/lib/ai/tools';
import { q } from '@/lib/db';
import { env } from '@/lib/env';
import { todayInNewYork } from '@/lib/dates';
import { getCalendar } from '@/lib/services/calendar';
import { getMacroTape } from '@/lib/services/macro';
import { notify } from '@/lib/services/notify';

export type BriefKind = 'morning' | 'redteam' | 'earnings_preview';
export type BriefRow = { id: string; kind: BriefKind; symbol: string | null; title: string; content: string; created_at: Date };

/** One Grok answer, collected (web search and every SilverNote data tool are available to it). */
async function ask(userId: string, data: string, prompt: string) {
  if (!env.xaiKey) throw new Error('XAI_API_KEY is not set.');
  let text = '';
  for await (const chunk of streamGrok(
    [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n<DATA>\n${data}\n</DATA>` },
      { role: 'user', content: prompt },
    ],
    { model: env.xaiFastModel, tools: { definitions: TOOLS, run: (name, args) => runTool(name, args, { userId }) }, signal: AbortSignal.timeout(240_000) },
  )) {
    text += chunk;
  }
  return text.trim();
}

async function save(userId: string, kind: BriefKind, title: string, content: string, symbol: string | null = null) {
  const [row] = await q<BriefRow>(
    'insert into public.ai_briefs (user_id, kind, symbol, title, content) values ($1, $2, $3, $4, $5) returning id, kind, symbol, title, content, created_at',
    [userId, kind, symbol, title, content],
  );
  return row;
}

/** First sentence-ish of a markdown answer, for a notification body. */
function teaser(markdown: string) {
  return markdown.replace(/[#*_>`[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function morningBrief(userId: string) {
  const today = todayInNewYork();
  const [data, calendar, tape] = await Promise.all([
    buildContext(userId, { type: 'general' }),
    getCalendar(userId, today, today).catch(() => []),
    getMacroTape().catch(() => []),
  ]);
  const day = calendar[0];
  const events = [
    `MACRO TAPE: ${tape.map((item) => `${item.label} ${item.price?.toFixed(2) ?? '—'} (${item.changePct === null ? '—' : `${item.changePct > 0 ? '+' : ''}${item.changePct.toFixed(2)}%`})`).join(' · ')}`,
    `EARNINGS TODAY: ${day?.earnings.map((row) => `${row.symbol}${row.mine ? ' (mine)' : ''} ${row.time}`).join(', ') || 'none tracked'}`,
    `US ECONOMIC RELEASES TODAY: ${day?.economy.filter((row) => row.major).map((row) => `${row.time ?? ''} GMT ${row.name} (cons ${row.consensus ?? '—'}, prev ${row.previous ?? '—'})`).join('; ') || 'none major'}`,
  ].join('\n');
  const content = await ask(
    userId,
    `${data}\n${events}`,
    'Write my morning brief for the US session ahead, under 350 words, markdown. Sections: **Overnight & futures** (use web search), **What matters for my positions** (only held/watched names with real news, lead with anything that could change a thesis), **Today’s calendar** (earnings and macro releases above, with why they matter), **One thing to watch**. No generic filler; say so if nothing material happened.',
  );
  const row = await save(userId, 'morning', `Morning brief · ${today}`, content);
  await notify(userId, { title: row.title, body: teaser(content), url: '/?brief=morning', tag: 'morning-brief' });
  return row;
}

/** Challenge the investor's most recently edited theses (at most `limit`). */
export async function weeklyRedTeam(userId: string, limit = 4, only?: string) {
  const symbols = only
    ? [{ symbol: only }]
    : await q<{ symbol: string }>(
        `select symbol from public.thesis_versions where user_id = $1 group by symbol order by max(created_at) desc limit $2`,
        [userId, limit],
      );
  const rows: BriefRow[] = [];
  for (const { symbol } of symbols) {
    const data = await buildContext(userId, { type: 'company', symbol });
    const content = await ask(
      userId,
      data,
      `Red-team my ${symbol} thesis. Under 300 words, markdown: **Weakest assumption**, **Evidence against it this week** (search the web and X; cite dates), **What would prove me wrong next** (measurable, with levels), **Verdict** (hold conviction / lower / exit review). Be blunt; don't restate the thesis.`,
    );
    rows.push(await save(userId, 'redteam', `Red team · ${symbol}`, content, symbol));
  }
  if (rows.length && !only) await notify(userId, { title: 'Weekly thesis red team', body: `Grok challenged ${rows.map((row) => row.symbol).join(', ')}.`, url: '/?brief=redteam', tag: 'redteam' });
  return rows;
}

export async function earningsPreview(userId: string, symbol: string, reportDate?: string) {
  const data = await buildContext(userId, { type: 'company', symbol });
  const content = await ask(
    userId,
    data,
    `Earnings preview for ${symbol}${reportDate ? ` (reports ${reportDate})` : ''}. Under 350 words, markdown: **Consensus & the whisper** (EPS/revenue expectations, search for recent estimate revisions), **What the market is watching** (3 KPIs with the numbers that would beat or miss), **Last quarter recap**, **Implied move & positioning** (if available), **How it bears on my thesis**.`,
  );
  return save(userId, 'earnings_preview', `Earnings preview · ${symbol}`, content, symbol);
}

export function listBriefs(userId: string, kind?: BriefKind, limit = 20) {
  return kind
    ? q<BriefRow>('select id, kind, symbol, title, content, created_at from public.ai_briefs where user_id = $1 and kind = $2 order by created_at desc limit $3', [userId, kind, limit])
    : q<BriefRow>('select id, kind, symbol, title, content, created_at from public.ai_briefs where user_id = $1 order by created_at desc limit $2', [userId, limit]);
}

import 'server-only';

import { z } from 'zod';

import { symbolSchema } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { strategySchema } from '@/lib/backtest-schema';
import { q, q1 } from '@/lib/db';
import { screenDefinition, THESIS_SECTION_META, THESIS_SECTIONS } from '@/lib/schemas';
import { ALERT_KINDS, ALERT_METRICS, createAlert, deleteAlert, type AlertKind } from '@/lib/services/alerts';
import { getQuotes } from '@/lib/services/market';

import type { ToolDefinition } from '@/lib/ai/tools';

/**
 * Changes Grok can propose. A proposal is only stored as pending: the investor applies it with the
 * Confirm button on the card under the answer, and only then does `executeAction` run.
 */

const tags = z.array(z.string().trim().min(1).max(24)).max(10).optional();

const SCHEMAS = {
  create_note: z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(100_000), symbol: symbolSchema.nullish(), tags }),
  append_to_note: z.object({ note_id: z.string().uuid(), content: z.string().min(1).max(50_000) }),
  add_to_watchlist: z.object({ watchlist: z.string().trim().min(1).max(60), symbol: symbolSchema, note: z.string().max(500).optional(), tags }),
  remove_from_watchlist: z.object({ watchlist: z.string().trim().min(1).max(60), symbol: symbolSchema }),
  create_alert: z.object({
    symbol: symbolSchema,
    kind: z.enum(ALERT_KINDS),
    threshold: z.number().finite(),
    note: z.string().max(280).optional(),
    metric: z.enum(Object.keys(ALERT_METRICS) as [keyof typeof ALERT_METRICS, ...Array<keyof typeof ALERT_METRICS>]).optional(),
  }),
  delete_alert: z.object({ alert_id: z.string().uuid() }),
  update_workspace: z.object({
    symbol: symbolSchema,
    stance: z.enum(['long', 'short', 'watch', 'avoid']).optional(),
    conviction: z.number().int().min(1).max(5).optional(),
    target_price: z.number().positive().max(1e7).nullable().optional(),
    horizon: z.string().max(40).nullable().optional(),
  }),
  update_thesis: z.object({ symbol: symbolSchema, section: z.enum(THESIS_SECTIONS), content: z.string().min(1).max(40_000), change_note: z.string().max(280).optional() }),
  save_screen: z.object({ name: z.string().trim().min(1).max(80), definition: screenDefinition }),
  save_strategy: z.object({ name: z.string().trim().min(1).max(80), definition: strategySchema }),
} as const;

export type ActionKind = keyof typeof SCHEMAS;
type Payload<K extends ActionKind> = z.infer<(typeof SCHEMAS)[K]>;

const TOOL_PREFIX = 'propose_';
const confirmNote = 'Only proposes the change: the investor must press Confirm on the card under your answer before anything is saved.';

export const ACTION_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'propose_create_note',
    description: `Save a new research note (markdown). ${confirmNote}`,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown body.' },
        symbol: { type: 'string', description: 'Ticker to file it under, if any.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'content'],
    },
  },
  {
    type: 'function',
    name: 'propose_append_to_note',
    description: `Append text to the end of an existing note (ids from get_notes). ${confirmNote}`,
    parameters: { type: 'object', properties: { note_id: { type: 'string' }, content: { type: 'string' } }, required: ['note_id', 'content'] },
  },
  {
    type: 'function',
    name: 'propose_add_to_watchlist',
    description: `Add a ticker to a watchlist by name (created if it doesn't exist). ${confirmNote}`,
    parameters: {
      type: 'object',
      properties: { watchlist: { type: 'string', description: 'Watchlist name.' }, symbol: { type: 'string' }, note: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['watchlist', 'symbol'],
    },
  },
  {
    type: 'function',
    name: 'propose_remove_from_watchlist',
    description: `Remove a ticker from a watchlist. ${confirmNote}`,
    parameters: { type: 'object', properties: { watchlist: { type: 'string' }, symbol: { type: 'string' } }, required: ['watchlist', 'symbol'] },
  },
  {
    type: 'function',
    name: 'propose_create_alert',
    description: `Set an alert. price_above/price_below: price level; change_pct: daily move in percent (e.g. 5); score_above/score_below: SilverNote Score level; score_change: points of change; filing: any new 10-K/10-Q/8-K/proxy/13D (threshold 0); insider_buy: open-market insider purchases worth at least threshold dollars; earnings: threshold = days before the report to notify; metric_above/metric_below: a fundamental ratio crosses threshold (fractions for percentages, e.g. 0.4 = 40% gross margin) — set metric. ${confirmNote}`,
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        kind: { type: 'string', enum: [...ALERT_KINDS] },
        threshold: { type: 'number' },
        metric: { type: 'string', enum: Object.keys(ALERT_METRICS) },
        note: { type: 'string' },
      },
      required: ['symbol', 'kind', 'threshold'],
    },
  },
  {
    type: 'function',
    name: 'propose_delete_alert',
    description: `Delete an alert (ids from get_alerts). ${confirmNote}`,
    parameters: { type: 'object', properties: { alert_id: { type: 'string' } }, required: ['alert_id'] },
  },
  {
    type: 'function',
    name: 'propose_update_workspace',
    description: `Set stance, conviction (1–5), target price or horizon on a company workspace (created if missing). ${confirmNote}`,
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        stance: { type: 'string', enum: ['long', 'short', 'watch', 'avoid'] },
        conviction: { type: 'integer' },
        target_price: { type: 'number' },
        horizon: { type: 'string', description: 'e.g. "12-18 months".' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'propose_update_thesis',
    description: `Commit a new version of one thesis section (the old text stays in version history). Write the complete section, not a diff. Sections: ${THESIS_SECTIONS.join(', ')}. ${confirmNote}`,
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        section: { type: 'string', enum: [...THESIS_SECTIONS] },
        content: { type: 'string', description: 'Full markdown text of the section.' },
        change_note: { type: 'string', description: 'One line on what changed and why.' },
      },
      required: ['symbol', 'section', 'content'],
    },
  },
  {
    type: 'function',
    name: 'propose_save_screen',
    description: `Save a screener screen. definition: {sectors?: string[], filters?: [{key, min?, max?}] using screen metric keys, sort?: {key, dir}}. ${confirmNote}`,
    parameters: { type: 'object', properties: { name: { type: 'string' }, definition: { type: 'object' } }, required: ['name', 'definition'] },
  },
  {
    type: 'function',
    name: 'propose_save_strategy',
    description: `Save a backtest strategy (same shape as run_backtest's strategy). ${confirmNote}`,
    parameters: { type: 'object', properties: { name: { type: 'string' }, definition: { type: 'object' } }, required: ['name', 'definition'] },
  },
];

export function isActionTool(name: string) {
  return name.startsWith(TOOL_PREFIX) && name.slice(TOOL_PREFIX.length) in SCHEMAS;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** One line the investor reads on the confirm card. */
function describe(kind: ActionKind, payload: Payload<ActionKind>): string {
  switch (kind) {
    case 'create_note': {
      const p = payload as Payload<'create_note'>;
      return `Save note “${p.title}”${p.symbol ? ` on ${p.symbol}` : ''} (${p.content.length.toLocaleString()} characters)`;
    }
    case 'append_to_note':
      return `Append ${(payload as Payload<'append_to_note'>).content.length.toLocaleString()} characters to a note`;
    case 'add_to_watchlist': {
      const p = payload as Payload<'add_to_watchlist'>;
      return `Add ${p.symbol} to watchlist “${p.watchlist}”${p.note ? ` — ${clip(p.note, 80)}` : ''}`;
    }
    case 'remove_from_watchlist': {
      const p = payload as Payload<'remove_from_watchlist'>;
      return `Remove ${p.symbol} from watchlist “${p.watchlist}”`;
    }
    case 'create_alert': {
      const p = payload as Payload<'create_alert'>;
      const what: Record<AlertKind, string> = {
        price_above: `price rises above ${p.threshold}`,
        price_below: `price falls below ${p.threshold}`,
        change_pct: `moves ${p.threshold}% in a day`,
        score_above: `SilverNote Score rises above ${p.threshold}`,
        score_below: `SilverNote Score falls below ${p.threshold}`,
        score_change: `SilverNote Score changes by ${p.threshold} points`,
        filing: 'files a 10-K, 10-Q, 8-K or other key form',
        insider_buy: `insiders buy at least $${p.threshold.toLocaleString()} on the open market`,
        earnings: `is ${p.threshold} day(s) from reporting earnings`,
        metric_above: `${p.metric ? ALERT_METRICS[p.metric].label : 'metric'} rises above ${p.threshold}`,
        metric_below: `${p.metric ? ALERT_METRICS[p.metric].label : 'metric'} falls below ${p.threshold}`,
      };
      return `Alert when ${p.symbol} ${what[p.kind]}`;
    }
    case 'delete_alert':
      return 'Delete an alert';
    case 'update_workspace': {
      const p = payload as Payload<'update_workspace'>;
      const parts = [
        p.stance && `stance ${p.stance}`,
        p.conviction && `conviction ${p.conviction}/5`,
        p.target_price !== undefined && `target ${p.target_price ?? 'none'}`,
        p.horizon !== undefined && `horizon ${p.horizon ?? 'none'}`,
      ].filter(Boolean);
      return `Update ${p.symbol} workspace: ${parts.join(', ') || 'no changes'}`;
    }
    case 'update_thesis': {
      const p = payload as Payload<'update_thesis'>;
      return `Commit a new “${THESIS_SECTION_META[p.section].title}” section for ${p.symbol}${p.change_note ? ` — ${clip(p.change_note, 100)}` : ''}`;
    }
    case 'save_screen':
      return `Save screen “${(payload as Payload<'save_screen'>).name}”`;
    case 'save_strategy':
      return `Save backtest strategy “${(payload as Payload<'save_strategy'>).name}”`;
  }
}

/** Validate a proposal from Grok and store it as pending. Returns the text Grok sees. */
export async function proposeAction(userId: string, threadId: string | null | undefined, toolName: string, args: Record<string, unknown>) {
  const kind = toolName.slice(TOOL_PREFIX.length) as ActionKind;
  const parsed = SCHEMAS[kind].safeParse(args);
  if (!parsed.success) return `Not proposed, invalid input: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`;
  const payload = parsed.data;
  // Catch references to things that don't exist now, rather than on confirm.
  if (kind === 'append_to_note' && !(await q1('select 1 from public.notes where id = $1 and user_id = $2', [(payload as Payload<'append_to_note'>).note_id, userId]))) {
    return 'Not proposed: no note with that id (use get_notes).';
  }
  if (kind === 'delete_alert' && !(await q1('select 1 from public.alerts where id = $1 and user_id = $2', [(payload as Payload<'delete_alert'>).alert_id, userId]))) {
    return 'Not proposed: no alert with that id (use get_alerts).';
  }
  const summary = describe(kind, payload);
  const [row] = await q<{ id: string }>('insert into public.ai_actions (user_id, thread_id, kind, payload, summary) values ($1, $2, $3, $4::jsonb, $5) returning id', [
    userId,
    threadId ?? null,
    kind,
    JSON.stringify(payload),
    summary,
  ]);
  return `Proposed (action ${row.id}): ${summary}. NOT applied yet — the investor will see a Confirm button under your answer. Say that it's ready to confirm; don't say it's done.`;
}

async function watchlistByName(userId: string, name: string, create: boolean) {
  const existing = await q1<{ id: string; name: string }>('select id, name from public.watchlists where user_id = $1 and lower(name) = lower($2) order by created_at limit 1', [userId, name]);
  if (existing || !create) return existing;
  const [row] = await q<{ id: string; name: string }>(
    `insert into public.watchlists (user_id, name, columns, position)
     values ($1, $2, $3::jsonb, coalesce((select max(position) + 1 from public.watchlists where user_id = $1), 0)) returning id, name`,
    [userId, name, JSON.stringify(['price', 'changePct', 'sinceAdded', 'marketCap', 'pe', 'revenueGrowth', 'score'])],
  );
  return row;
}

/** Apply a confirmed action as the investor. Returns where to find the result in the app. */
async function execute(userId: string, kind: ActionKind, raw: unknown): Promise<{ href: string | null }> {
  const payload = SCHEMAS[kind].parse(raw);
  switch (kind) {
    case 'create_note': {
      const p = payload as Payload<'create_note'>;
      const [note] = await q<{ id: string }>('insert into public.notes (user_id, symbol, title, content, tags) values ($1, $2, $3, $4, $5::text[]) returning id', [
        userId,
        p.symbol || null,
        p.title,
        p.content,
        p.tags ?? [],
      ]);
      await q('insert into public.note_versions (note_id, user_id, title, content) values ($1, $2, $3, $4)', [note.id, userId, p.title, p.content]);
      return { href: `/notes?note=${note.id}` };
    }
    case 'append_to_note': {
      const p = payload as Payload<'append_to_note'>;
      const [note] = await q<{ id: string; title: string; content: string }>(
        `update public.notes set content = case when content = '' then $3 else content || E'\\n\\n' || $3 end, updated_at = now()
         where id = $1 and user_id = $2 returning id, title, content`,
        [p.note_id, userId, p.content],
      );
      if (!note) throw new HttpError(404, 'That note no longer exists.');
      await q('insert into public.note_versions (note_id, user_id, title, content) values ($1, $2, $3, $4)', [note.id, userId, note.title, note.content]);
      return { href: `/notes?note=${note.id}` };
    }
    case 'add_to_watchlist': {
      const p = payload as Payload<'add_to_watchlist'>;
      const list = (await watchlistByName(userId, p.watchlist, true))!;
      const price = (await getQuotes([p.symbol]))[p.symbol]?.price ?? null;
      await q(
        `insert into public.watchlist_items (watchlist_id, user_id, symbol, tags, note, added_price, position)
         values ($1, $2, $3, $4::text[], $5, $6, coalesce((select max(position) + 1 from public.watchlist_items where watchlist_id = $1), 0))
         on conflict (watchlist_id, symbol) do update set tags = excluded.tags, note = coalesce(excluded.note, watchlist_items.note)`,
        [list.id, userId, p.symbol, p.tags ?? [], p.note ?? null, price],
      );
      return { href: `/watchlists?id=${list.id}` };
    }
    case 'remove_from_watchlist': {
      const p = payload as Payload<'remove_from_watchlist'>;
      const list = await watchlistByName(userId, p.watchlist, false);
      if (!list) throw new HttpError(404, `No watchlist named “${p.watchlist}”.`);
      await q('delete from public.watchlist_items where watchlist_id = $1 and symbol = $2 and user_id = $3', [list.id, p.symbol, userId]);
      return { href: `/watchlists?id=${list.id}` };
    }
    case 'create_alert': {
      await createAlert(userId, payload as Payload<'create_alert'>);
      return { href: '/watchlists?tab=alerts' };
    }
    case 'delete_alert': {
      await deleteAlert(userId, (payload as Payload<'delete_alert'>).alert_id);
      return { href: '/watchlists?tab=alerts' };
    }
    case 'update_workspace': {
      const p = payload as Payload<'update_workspace'>;
      await q(
        `insert into public.workspaces (user_id, symbol, stance, conviction, target_price, horizon)
         values ($1, $2, coalesce($3, 'watch'), coalesce($4, 3), $5, $6)
         on conflict (user_id, symbol) do update set
           stance = coalesce($3, workspaces.stance), conviction = coalesce($4, workspaces.conviction),
           target_price = case when $7::boolean then $5 else workspaces.target_price end,
           horizon = case when $8::boolean then $6 else workspaces.horizon end, updated_at = now()`,
        [userId, p.symbol, p.stance ?? null, p.conviction ?? null, p.target_price ?? null, p.horizon ?? null, p.target_price !== undefined, p.horizon !== undefined],
      );
      return { href: `/company/${p.symbol}?tab=workspace` };
    }
    case 'update_thesis': {
      const p = payload as Payload<'update_thesis'>;
      await q(`insert into public.workspaces (user_id, symbol) values ($1, $2) on conflict (user_id, symbol) do update set updated_at = now()`, [userId, p.symbol]);
      const meta = await q1<{ stance: string; conviction: number; target_price: number | null }>(
        'select stance, conviction, target_price from public.workspaces where user_id = $1 and symbol = $2',
        [userId, p.symbol],
      );
      const price = (await getQuotes([p.symbol]))[p.symbol]?.price ?? null;
      await q(
        `insert into public.thesis_versions (user_id, symbol, section, content, change_note, stance, conviction, target_price, price_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [userId, p.symbol, p.section, p.content, p.change_note ?? 'Drafted with Grok', meta?.stance ?? null, meta?.conviction ?? null, meta?.target_price ?? null, price],
      );
      return { href: `/company/${p.symbol}?tab=workspace` };
    }
    case 'save_screen': {
      const p = payload as Payload<'save_screen'>;
      await q('insert into public.saved_screens (user_id, name, definition) values ($1, $2, $3::jsonb)', [userId, p.name, JSON.stringify(p.definition)]);
      return { href: '/explorer' };
    }
    case 'save_strategy': {
      const p = payload as Payload<'save_strategy'>;
      await q('insert into public.backtest_strategies (user_id, name, definition) values ($1, $2, $3::jsonb)', [userId, p.name, JSON.stringify(p.definition)]);
      return { href: '/backtest' };
    }
  }
}

export type ActionView = { id: string; kind: string; summary: string; status: 'pending' | 'done' | 'declined' | 'failed'; href: string | null; error: string | null; preview: string | null };

type ActionRow = { id: string; kind: string; summary: string; status: ActionView['status']; payload: Record<string, unknown>; result: { href?: string | null } | null; error: string | null };

/** What the card shows: the summary, plus the text being written for notes and theses so it can be read before confirming. */
export function toView(row: ActionRow): ActionView {
  const content = typeof row.payload?.content === 'string' ? row.payload.content : null;
  return { id: row.id, kind: row.kind, summary: row.summary, status: row.status, href: row.result?.href ?? null, error: row.error, preview: content ? clip(content, 4_000) : null };
}

export async function listActions(userId: string, where: { threadId?: string; messageIds?: string[] }) {
  const rows = where.messageIds
    ? await q<ActionRow & { message_id: string }>('select id, kind, summary, status, payload, result, error, message_id from public.ai_actions where user_id = $1 and message_id = any($2::uuid[]) order by created_at', [
        userId,
        where.messageIds,
      ])
    : await q<ActionRow & { message_id: string }>('select id, kind, summary, status, payload, result, error, message_id from public.ai_actions where user_id = $1 and thread_id = $2 order by created_at', [userId, where.threadId]);
  return rows;
}

/** Confirm (run) or decline a pending action. Each action runs at most once. */
export async function resolveAction(userId: string, id: string, decision: 'confirm' | 'decline'): Promise<ActionView> {
  // Claim it atomically so a double click can't apply it twice.
  const claimed = await q1<ActionRow>(
    `update public.ai_actions set status = $3, resolved_at = now() where id = $1 and user_id = $2 and status = 'pending'
     returning id, kind, summary, status, payload, result, error`,
    [id, userId, decision === 'confirm' ? 'done' : 'declined'],
  );
  if (!claimed) {
    const current = await q1<ActionRow>('select id, kind, summary, status, payload, result, error from public.ai_actions where id = $1 and user_id = $2', [id, userId]);
    if (!current) throw new HttpError(404, 'Action not found.');
    return toView(current);
  }
  if (decision === 'decline') return toView(claimed);
  try {
    const result = await execute(userId, claimed.kind as ActionKind, claimed.payload);
    await q('update public.ai_actions set result = $3::jsonb where id = $1 and user_id = $2', [id, userId, JSON.stringify(result)]);
    return toView({ ...claimed, result });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join('; ') : (error as Error).message;
    await q(`update public.ai_actions set status = 'failed', error = $3 where id = $1 and user_id = $2`, [id, userId, message]);
    return toView({ ...claimed, status: 'failed', error: message });
  }
}

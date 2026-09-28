import { z } from 'zod';

import { body, route } from '@/lib/api';
import { listActions, toView } from '@/lib/ai/actions';
import { buildContext, SYSTEM_PROMPT, type AssistantContext } from '@/lib/ai/context';
import { GrokError, streamGrok, type ChatMessage } from '@/lib/ai/grok';
import { USAGE_SEPARATOR, usageCost, type TokenUsage } from '@/lib/ai/pricing';
import { runTool, TOOLS } from '@/lib/ai/tools';
import { q, q1 } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  threadId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(20_000),
  context: z
    .union([
      z.object({ type: z.literal('company'), symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.\-]{1,16}$/) }),
      z.object({ type: z.literal('portfolio'), id: z.string().uuid() }),
      z.object({ type: z.literal('general') }),
    ])
    .default({ type: 'general' }),
  mode: z.enum(['fast', 'standard', 'thinking']).default('standard'),
});

const FILING_DIRECTIVE = /\[filing:(https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/[^\]\s]+)\]/;

export const POST = route(async ({ request, user }) => {
  const input = await body(request, schema);
  const context = input.context as AssistantContext;
  const filingUrl = input.message.match(FILING_DIRECTIVE)?.[1] ?? null;

  let threadId = input.threadId ?? null;
  if (threadId) {
    const owned = await q1('select id from public.chat_threads where id = $1 and user_id = $2', [threadId, user.id]);
    if (!owned) threadId = null;
  }
  if (!threadId) {
    const title = input.message.replace(FILING_DIRECTIVE, '').trim().slice(0, 80) || 'New conversation';
    const [thread] = await q<{ id: string }>('insert into public.chat_threads (user_id, title, context) values ($1, $2, $3::jsonb) returning id', [
      user.id,
      title,
      JSON.stringify(context),
    ]);
    threadId = thread.id;
  }
  const lite = input.mode === 'fast';
  const history = await q<{ role: 'user' | 'assistant'; content: string }>(
    'select role, content from public.chat_messages where thread_id = $1 order by created_at desc limit $2',
    [threadId, lite ? 6 : 16],
  );
  await q('insert into public.chat_messages (thread_id, user_id, role, content) values ($1, $2, $3, $4)', [threadId, user.id, 'user', input.message]);
  await q('update public.chat_threads set updated_at = now(), context = $2::jsonb where id = $1', [threadId, JSON.stringify(context)]);

  const encoder = new TextEncoder();
  const settings = await q1<{ data: { aiModel?: string | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = '';
      const model = input.mode === 'thinking' ? settings?.data?.aiModel || env.xaiModel : lite ? env.xaiFastLiteModel : env.xaiFastModel;
      const usage: TokenUsage = { input: 0, output: 0, cached: 0 };
      const push = (text: string) => {
        answer += text;
        controller.enqueue(encoder.encode(text));
      };
      try {
        if (!env.xaiKey) {
          push(
            '**Grok isn’t connected yet.** Add your xAI key to `.env.local`:\n\n```\nXAI_API_KEY=xai-...\n```\n\nThen restart `npm run dev`. The key stays on the server — the browser never sees it. Everything else in SilverNote works without it.',
          );
        } else {
          const [data, earlier] = await Promise.all([buildContext(user.id, context, filingUrl, input.message, { lite }), listActions(user.id, { threadId: threadId! })]);
          // So Grok knows which of its earlier proposals were applied, declined or failed.
          const actionLog = earlier.length
            ? `\nCHANGES YOU PROPOSED EARLIER IN THIS CONVERSATION: ${earlier.map((action) => `${action.summary} → ${action.status}${action.error ? ` (${action.error})` : ''}`).join('; ')}`
            : '';
          const messages: ChatMessage[] = [
            { role: 'system', content: `${SYSTEM_PROMPT}\n\n<DATA>\n${data}${actionLog}\n</DATA>` },
            ...history.reverse().map((message) => {
              const content = message.content.replace(FILING_DIRECTIVE, '');
              return { role: message.role, content: lite && content.length > 1500 ? `${content.slice(0, 1500)}…` : content };
            }),
            { role: 'user', content: input.message.replace(FILING_DIRECTIVE, '(filing text included in DATA)') },
          ];
          for await (const chunk of streamGrok(messages, {
            model,
            signal: request.signal,
            tools: {
              definitions: TOOLS,
              run: (name, args) => runTool(name, args, { userId: user.id, portfolioId: context.type === 'portfolio' ? context.id : null, threadId }),
            },
            onUsage: (round) => {
              usage.input += round.input;
              usage.output += round.output;
              usage.cached += round.cached;
            },
          })) push(chunk);
        }
      } catch (error) {
        const message =
          error instanceof GrokError && error.status === 401
            ? 'The xAI API rejected the key. Check `XAI_API_KEY` in `.env.local`.'
            : `Grok request failed: ${(error as Error).message}`;
        push(`\n\n> ${message}`);
      } finally {
        const metered = usage.input + usage.output > 0;
        const cost = metered ? usageCost(usage, model) : null;
        // Changes Grok proposed during this answer, shown as confirm cards under it.
        const proposed = await q<Parameters<typeof toView>[0]>(
          `select id, kind, summary, status, payload, result, error from public.ai_actions where thread_id = $1 and user_id = $2 and message_id is null order by created_at`,
          [threadId, user.id],
        ).catch(() => []);
        if (answer.trim() || proposed.length) {
          const saved = await q1<{ id: string }>(
            'insert into public.chat_messages (thread_id, user_id, role, content, input_tokens, output_tokens, cost_usd) values ($1, $2, $3, $4, $5, $6, $7) returning id',
            [threadId, user.id, 'assistant', answer.trim() ? answer : 'Ready for you to confirm:', metered ? usage.input : null, metered ? usage.output : null, cost],
          ).catch(() => null);
          if (saved && proposed.length) {
            await q('update public.ai_actions set message_id = $1 where id = any($2::uuid[])', [saved.id, proposed.map((action) => action.id)]).catch(() => {});
          }
        }
        // Trailer after a record separator; the client strips it from the visible answer.
        if (metered || proposed.length) {
          try {
            const actions = proposed.map(toView);
            controller.enqueue(encoder.encode(`${USAGE_SEPARATOR}${JSON.stringify({ ...(metered ? { input: usage.input, output: usage.output, cost } : {}), actions })}`));
          } catch {
            // client already disconnected
          }
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Thread-Id': threadId },
  });
});

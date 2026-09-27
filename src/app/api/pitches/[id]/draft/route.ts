import { z } from 'zod';

import { body, notFound, route } from '@/lib/api';
import { companyContext, SYSTEM_PROMPT } from '@/lib/ai/context';
import { GrokError, streamGrok } from '@/lib/ai/grok';
import { HttpError } from '@/lib/auth';
import { q1 } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const section = z.object({ id: z.string().max(40), kind: z.string().max(40), title: z.string().max(120), content: z.string().max(40_000), included: z.boolean() });

/** What a good version of each section looks like. */
const GUIDANCE: Record<string, string> = {
  summary: 'One tight paragraph: what the market is missing, why now, and what it is worth. End with one line: recommendation, target price and upside.',
  company: 'Two short paragraphs: what the company sells and to whom, how it makes money (segments, margins), and where it sits competitively.',
  thesis: 'Three to five numbered points. Each is a specific claim followed by the evidence from the data.',
  drivers: 'A bullet list of the three to five variables that move the value, each with its latest reading and direction.',
  financials: 'Keep any table that is already there (you may update it from the data). Add three bullets that interpret the trends in growth, margins and cash generation.',
  valuation: 'A fair-value range with the method (peer multiples, the company’s own history, simple DCF logic), the key assumptions, and a compact multiples table versus the sector median.',
  catalysts: 'A bullet list of concrete events with expected timing and why each matters.',
  risks: 'A bullet list: the risk, how likely, the likely damage, and what you would watch.',
  disconfirming: 'A bullet list of specific, observable signals with thresholds that would prove the thesis wrong (e.g. "gross margin below 60% for two quarters").',
  score: 'Summarize what the SilverNote Score says (overall, strongest and weakest components, confidence) and what it cannot capture for this company.',
};

export const POST = route<{ id: string }>(async ({ request, user, params }) => {
  const input = await body(request, z.object({ sectionId: z.string().max(40), instruction: z.string().max(2000).optional(), sections: z.array(section).max(30) }));
  const pitch = await q1<{ symbol: string; title: string; recommendation: string; target_price: number | null }>(
    'select symbol, title, recommendation, target_price from public.pitches where id = $1 and user_id = $2',
    [params.id, user.id],
  );
  if (!pitch) notFound('Pitch not found.');
  if (!env.xaiKey) throw new HttpError(400, 'Grok isn’t connected. Add XAI_API_KEY to .env.local and restart the server.');
  const target = input.sections.find((item) => item.id === input.sectionId);
  if (!target) throw new HttpError(400, 'Unknown section.');

  const data = await companyContext(user.id, pitch.symbol);
  const others = input.sections
    .filter((item) => item.included && item.id !== target.id && item.content.trim())
    .map((item) => `## ${item.title}\n${item.content}`)
    .join('\n\n')
    .slice(0, 14_000);
  const messages = [
    {
      role: 'system' as const,
      content: `${SYSTEM_PROMPT}\n\nYou are drafting one section of an investment pitch. Reply with the section body only, in Markdown, without the section heading and without any preamble or sign-off.\n\n<DATA>\n${data}\n</DATA>`,
    },
    {
      role: 'user' as const,
      content: [
        `Pitch: "${pitch.title}" — ${pitch.recommendation.toUpperCase()} ${pitch.symbol}${pitch.target_price ? `, target $${pitch.target_price}` : ''}.`,
        others ? `Other sections so far:\n\n${others}` : '',
        `Draft the "${target.title}" section. ${GUIDANCE[target.kind] ?? 'Keep it specific, quantitative and short.'}`,
        input.instruction ? `Extra instruction: ${input.instruction}` : '',
        target.content.trim() ? `Current draft of this section (keep what is right, fix what is not, drop placeholders):\n\n${target.content}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  const settings = await q1<{ data: { aiModel?: string | null } }>('select data from public.user_settings where user_id = $1', [user.id]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamGrok(messages, { model: settings?.data?.aiModel ?? undefined, signal: request.signal })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        const message = error instanceof GrokError && error.status === 401 ? 'The xAI API rejected the key.' : (error as Error).message;
        controller.enqueue(encoder.encode(`\n\n> Grok request failed: ${message}`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
});

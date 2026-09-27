import 'server-only';

import { env } from '@/lib/env';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const BASE = 'https://api.x.ai/v1';

export class GrokError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Parse a server-sent-events stream into JSON payloads. */
async function* sse(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (data && data !== '[DONE]') {
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          // ignore keep-alives and partial frames
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

async function errorText(response: Response) {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: string | { message?: string }; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    return parsed.error?.message ?? parsed.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || response.statusText;
  }
}

async function* viaResponses(messages: ChatMessage[], model: string, signal?: AbortSignal) {
  const response = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.xaiKey}` },
    body: JSON.stringify({ model, input: messages, stream: true, store: false }),
    signal,
  });
  if (!response.ok) throw new GrokError(response.status, await errorText(response));
  for await (const event of sse(response)) {
    const type = String(event.type ?? '');
    if (type === 'response.output_text.delta' && typeof event.delta === 'string') yield event.delta;
    else if (type === 'error' || type === 'response.failed') {
      const detail = (event.error as { message?: string } | undefined)?.message ?? (event.response as { error?: { message?: string } } | undefined)?.error?.message;
      throw new GrokError(500, detail ?? 'Grok returned an error.');
    }
  }
}

async function* viaChatCompletions(messages: ChatMessage[], model: string, signal?: AbortSignal) {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.xaiKey}` },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!response.ok) throw new GrokError(response.status, await errorText(response));
  for await (const event of sse(response)) {
    const choices = event.choices as Array<{ delta?: { content?: string } }> | undefined;
    const delta = choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/**
 * Stream a Grok answer. Uses the Responses API (xAI's current endpoint) and falls back to the
 * legacy Chat Completions endpoint if the account or model doesn't support it.
 */
export async function* streamGrok(messages: ChatMessage[], options: { model?: string; signal?: AbortSignal } = {}) {
  if (!env.xaiKey) throw new GrokError(401, 'XAI_API_KEY is not set.');
  const model = options.model || env.xaiModel;
  let produced = false;
  try {
    for await (const chunk of viaResponses(messages, model, options.signal)) {
      produced = true;
      yield chunk;
    }
    if (produced) return;
  } catch (error) {
    if (produced || (error instanceof GrokError && [401, 403, 429].includes(error.status))) throw error;
  }
  yield* viaChatCompletions(messages, model, options.signal);
}

export type VisionImage = { base64: string; mimeType: string };

/**
 * One non-streaming vision request that must answer with JSON matching `schema` (xAI structured
 * outputs). Returns the raw JSON text; callers validate and sanitize it.
 */
export async function completeGrokVisionJson(input: {
  system: string;
  prompt: string;
  image: VisionImage;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
}) {
  if (!env.xaiKey) throw new GrokError(401, 'XAI_API_KEY is not set.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 45_000);
  let response: Response;
  try {
    response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.xaiKey}` },
      body: JSON.stringify({
        model: env.xaiVisionModel,
        temperature: 0,
        max_tokens: input.maxTokens ?? 4200,
        messages: [
          { role: 'system', content: input.system },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${input.image.mimeType};base64,${input.image.base64}`, detail: 'high' } },
              { type: 'text', text: input.prompt },
            ],
          },
        ],
        response_format: { type: 'json_schema', json_schema: { name: input.schemaName, schema: input.schema, strict: true } },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new GrokError(504, 'Reading the photo timed out. Try a smaller or clearer image.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new GrokError(response.status, await errorText(response));
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new GrokError(502, 'Grok returned no output for the photo.');
  return text;
}

export async function listModels() {
  if (!env.xaiKey) return [];
  const response = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${env.xaiKey}` } });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: Array<{ id: string }> };
  return (payload.data ?? []).map((model) => model.id).sort();
}

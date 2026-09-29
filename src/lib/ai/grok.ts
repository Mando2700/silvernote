import 'server-only';

import type { TokenUsage } from '@/lib/ai/pricing';
import type { ToolDefinition } from '@/lib/ai/tools';
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

export type ToolRunner = { definitions: ToolDefinition[]; run: (name: string, args: string) => Promise<string> };

type FunctionCall = { type: 'function_call'; call_id: string; name: string; arguments: string };

/** Most tool rounds per answer, so a confused model can't loop forever. */
const MAX_TOOL_ROUNDS = 12;

type UsageSink = (usage: TokenUsage) => void;

function addUsage(sink: UsageSink | undefined, raw: unknown) {
  if (!sink || !raw || typeof raw !== 'object') return;
  const usage = raw as {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
  sink({
    input: usage.input_tokens ?? usage.prompt_tokens ?? 0,
    output: usage.output_tokens ?? usage.completion_tokens ?? 0,
    cached: usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
  });
}

async function* viaResponses(messages: ChatMessage[], model: string, signal?: AbortSignal, tools?: ToolRunner, onUsage?: UsageSink) {
  const input: unknown[] = [...messages];
  for (let round = 0; ; round += 1) {
    // After the last allowed round, drop the functions so Grok has to answer with what it has.
    const functions = tools && round < MAX_TOOL_ROUNDS ? tools.definitions : [];
    const response = await fetch(`${BASE}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.xaiKey}` },
      // Server-side search lets Grok answer "why" questions (a debt raise, a guidance cut) that the numbers alone can't.
      body: JSON.stringify({ model, input, stream: true, store: false, tools: [{ type: 'web_search' }, { type: 'x_search' }, ...functions] }),
      signal,
    });
    if (!response.ok) throw new GrokError(response.status, await errorText(response));
    const calls = new Map<string, FunctionCall>();
    let text = '';
    for await (const event of sse(response)) {
      const type = String(event.type ?? '');
      if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta;
        yield event.delta;
      } else if (type === 'response.output_item.done' || type === 'response.completed') {
        if (type === 'response.completed') addUsage(onUsage, (event.response as { usage?: unknown } | undefined)?.usage);
        const items = type === 'response.completed' ?((event.response as { output?: unknown[] } | undefined)?.output ?? []) : [event.item];
        for (const item of items as Array<Partial<FunctionCall>>) {
          if (item?.type === 'function_call' && item.call_id && item.name) {
            calls.set(item.call_id, { type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments ?? '{}' });
          }
        }
      } else if (type === 'error' || type === 'response.failed') {
        const detail = (event.error as { message?: string } | undefined)?.message ?? (event.response as { error?: { message?: string } } | undefined)?.error?.message;
        throw new GrokError(500, detail ?? 'Grok returned an error.');
      }
    }
    if (!calls.size || !tools) return;
    if (text) input.push({ role: 'assistant', content: text });
    const outputs = await Promise.all([...calls.values()].map(async (call) => ({ type: 'function_call_output', call_id: call.call_id, output: await tools.run(call.name, call.arguments) })));
    input.push(...calls.values(), ...outputs);
  }
}

async function* viaChatCompletions(messages: ChatMessage[], model: string, signal?: AbortSignal, onUsage?: UsageSink) {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.xaiKey}` },
    body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
  if (!response.ok) throw new GrokError(response.status, await errorText(response));
  for await (const event of sse(response)) {
    addUsage(onUsage, event.usage);
    const choices = event.choices as Array<{ delta?: { content?: string } }> | undefined;
    const delta = choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/**
 * Stream a Grok answer. Uses the Responses API (xAI's current endpoint), running any SilverNote
 * `tools` Grok calls along the way, and falls back to the legacy Chat Completions endpoint (no
 * tools) if the account or model doesn't support it.
 */
export async function* streamGrok(
  messages: ChatMessage[],
  options: { model?: string; signal?: AbortSignal; tools?: ToolRunner; onUsage?: (usage: TokenUsage) => void } = {},
) {
  if (!env.xaiKey) throw new GrokError(401, 'XAI_API_KEY is not set.');
  const model = options.model || env.xaiModel;
  let produced = false;
  try {
    for await (const chunk of viaResponses(messages, model, options.signal, options.tools, options.onUsage)) {
      produced = true;
      yield chunk;
    }
    if (produced) return;
  } catch (error) {
    if (produced || (error instanceof GrokError && [401, 403, 429].includes(error.status))) throw error;
  }
  yield* viaChatCompletions(messages, model, options.signal, options.onUsage);
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

/**
 * One non-streaming text request that must answer with JSON matching `schema` (xAI structured
 * outputs). Returns the raw JSON text; callers validate it.
 */
export async function completeGrokJson(input: {
  system: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}) {
  if (!env.xaiKey) throw new GrokError(401, 'XAI_API_KEY is not set.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 90_000);
  let response: Response;
  try {
    response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.xaiKey}` },
      body: JSON.stringify({
        model: input.model || env.xaiFastModel,
        max_tokens: input.maxTokens ?? 3000,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
        response_format: { type: 'json_schema', json_schema: { name: input.schemaName, schema: input.schema, strict: true } },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new GrokError(504, 'Grok took too long to answer. Try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new GrokError(response.status, await errorText(response));
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new GrokError(502, 'Grok returned no output.');
  return text;
}

export async function listModels() {
  if (!env.xaiKey) return [];
  const response = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${env.xaiKey}` } });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: Array<{ id: string }> };
  return (payload.data ?? []).map((model) => model.id).sort();
}

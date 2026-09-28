export type TokenUsage = { input: number; output: number; cached: number };

export type ChatMode = 'fast' | 'standard' | 'thinking';

/** Precedes the JSON usage trailer at the end of a streamed chat answer. */
export const USAGE_SEPARATOR = '\u001e';

/** USD per million tokens (xAI list prices). Checked most-specific first. */
const PRICES: Array<[RegExp, { input: number; cached: number; output: number }]> = [
  [/grok-4[\w.-]*fast/, { input: 0.2, cached: 0.05, output: 0.5 }],
  [/grok-code-fast/, { input: 0.2, cached: 0.02, output: 1.5 }],
  [/grok-3-mini/, { input: 0.3, cached: 0.075, output: 0.5 }],
  [/grok-3/, { input: 3, cached: 0.75, output: 15 }],
  [/grok-4/, { input: 3, cached: 0.75, output: 15 }],
];

export function usageCost(usage: TokenUsage, model: string) {
  const price = PRICES.find(([pattern]) => pattern.test(model))?.[1] ?? PRICES[PRICES.length - 1][1];
  const cached = Math.min(usage.cached, usage.input);
  return ((usage.input - cached) * price.input + cached * price.cached + usage.output * price.output) / 1_000_000;
}

export function formatTokens(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatCost(usd: number) {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

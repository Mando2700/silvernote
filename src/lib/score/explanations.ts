import type { MetricResult, ScoreConfidence, ScoreLabel, SubScore, SubScoreKey } from './types';

export function scoreLabel(score: number): ScoreLabel {
  if (score >= 85) return 'Excellent';
  if (score >= 75) return 'Strong';
  if (score >= 65) return 'Good';
  if (score >= 50) return 'Mixed';
  return 'Weak';
}

function describe(item: MetricResult) {
  return `${item.metric.name.toLowerCase()} (${item.metric.formattedValue})`;
}

export function componentReason(input: {
  name: string;
  score: number;
  confidence: ScoreConfidence;
  metrics: MetricResult[];
}) {
  const ranked = input.metrics
    .filter((item) => item.normalizedScore !== null && item.metric.isAvailable)
    .sort((a, b) => (b.normalizedScore ?? 0) - (a.normalizedScore ?? 0));
  const best = ranked[0];
  const worst = ranked.at(-1);
  if (!best) return `Too little reliable evidence to rate ${input.name.toLowerCase()} with confidence, so it is scored conservatively.`;
  if (input.score >= 80) return `A clear strength, anchored by ${describe(best)}.`;
  if (input.score >= 65) return `Solid, with ${describe(best)} doing the heavy lifting.`;
  if (input.score >= 50) return `Mixed: ${describe(best)} is offset by ${describe(worst ?? best)}.`;
  return `A weak spot, dragged down most by ${describe(worst ?? best)}.`;
}

const WATCH_COPY: Record<SubScoreKey, string> = {
  growth: 'Can revenue, EPS and free cash flow keep compounding without leaning on easy comparisons?',
  profitability: 'Do margins and returns on capital hold up as the business grows?',
  valuation: 'Does growth, margin and cash generation catch up with the price being paid?',
  financialHealth: 'Do leverage, liquidity and free cash flow keep the balance sheet resilient?',
  momentum: 'Does the price trend stabilize, or keep confirming the current direction?',
  earningsQuality: 'Does reported profit keep converting into cash over the next few reports?',
  competitivePosition: 'Do scale, pricing power and returns keep defending the franchise?',
  efficiency: 'Do asset productivity and cash conversion keep improving?',
  risk: 'Do volatility, drawdowns and balance-sheet stress become easier to live with?',
  futureOutlook: 'Do estimates and trend support improve enough to back the next leg?',
};

function byScoreDesc(subScores: SubScore[]) {
  return [...subScores].sort((a, b) => b.score - a.score);
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function strengths(subScores: SubScore[]) {
  return byScoreDesc(subScores)
    .filter((item) => item.score >= 70)
    .slice(0, 3)
    .map((item) => `${item.name} — ${lowerFirst(item.reason)}`);
}

export function weaknesses(subScores: SubScore[]) {
  return [...subScores]
    .sort((a, b) => a.score - b.score)
    .filter((item) => item.score < 65)
    .slice(0, 3)
    .map((item) => `${item.name} — ${lowerFirst(item.reason)}`);
}

export function watchItems(subScores: SubScore[]) {
  return [...subScores]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((item) => WATCH_COPY[item.key]);
}

function joinWords(items: string[]) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function shortSummary(companyName: string | undefined, subScores: SubScore[]) {
  const name = companyName?.trim() || 'This company';
  const ranked = byScoreDesc(subScores);
  const leaders = ranked.slice(0, 2).map((item) => item.name.toLowerCase());
  const weakest = ranked.at(-1);
  const lead = leaders.length ? joinWords(leaders) : 'the available evidence';
  const tail =
    weakest && weakest.score < 65
      ? `; ${weakest.name.toLowerCase()} is the main thing holding it back`
      : '; no single area drags on the result';
  return `${name} scores best on ${lead}${tail}.`;
}

export function detailedDescription(input: {
  companyName?: string;
  subScores: SubScore[];
  strengths: string[];
  weaknesses: string[];
  watchItems: string[];
}) {
  const name = input.companyName?.trim() || 'The company';
  const ranked = byScoreDesc(input.subScores);
  const paragraphs: string[] = [];
  const [first, second] = ranked;
  paragraphs.push(
    first && second
      ? `${name}’s SilverNote Score is driven mostly by ${first.name.toLowerCase()} and ${second.name.toLowerCase()}.`
      : `${name}’s SilverNote Score reflects the filings, prices and market data available right now.`,
  );
  const strip = (text: string) => text.trim().replace(/\.+$/, '');
  if (input.strengths.length) paragraphs.push(`Where it stands out: ${input.strengths.slice(0, 2).map(strip).join('; ')}.`);
  const weakest = ranked.at(-1);
  if (weakest && (input.weaknesses.length || weakest.score < 65)) {
    const pressure = input.weaknesses.length ? input.weaknesses.slice(0, 2).map(strip).join('; ') : weakest.name.toLowerCase();
    paragraphs.push(`Where it struggles: ${pressure}.`);
  }
  if (input.watchItems.length) paragraphs.push(`Open questions: ${input.watchItems.slice(0, 2).join(' ')}`);
  return paragraphs.slice(0, 4).join('\n\n');
}

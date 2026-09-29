/**
 * Instant structure check for a practice pitch. The categories and weights follow the way pitch
 * competitions (Kentucky Gatton, Young Investors Society) and hedge-fund interviewers judge pitches:
 * a clear call, a variant view, evidence, dated catalysts, a valuation with asymmetry, and risks with
 * a kill switch. It checks form, not judgment — Grok's grade is the judgment.
 */

export type PitchDirection = 'long' | 'short';

export type PitchDraft = {
  symbol: string;
  direction: PitchDirection;
  /** Current price when written (from live data). */
  price: number | null;
  target: number | null;
  bull: number | null;
  bear: number | null;
  horizonMonths: number;
  summary: string;
  variant: string;
  thesis: string;
  catalysts: string;
  valuation: string;
  risks: string;
  disconfirming: string;
};

export type RubricKey = 'recommendation' | 'variant' | 'thesis' | 'catalysts' | 'valuation' | 'risks' | 'disconfirming';

export type RubricItem = { key: RubricKey; label: string; weight: number; score: number; notes: string[] };

export type RubricResult = { total: number; items: RubricItem[]; upside: number | null; skew: number | null };

export const RUBRIC_WEIGHTS: Array<{ key: RubricKey; label: string; weight: number; what: string }> = [
  { key: 'recommendation', label: 'Recommendation', weight: 10, what: 'Direction, target price and time frame, consistent with each other.' },
  { key: 'variant', label: 'Variant view', weight: 20, what: 'What the market believes, why it is wrong, with a number.' },
  { key: 'thesis', label: 'Thesis & evidence', weight: 15, what: 'Two to four pillars, each backed by data.' },
  { key: 'catalysts', label: 'Catalysts', weight: 15, what: 'Dated events in the horizon that close the gap.' },
  { key: 'valuation', label: 'Valuation', weight: 15, what: 'A named method, the math, and bull/bear cases.' },
  { key: 'risks', label: 'Risks & mitigants', weight: 15, what: 'Company-specific risks, their cost and how you’d manage them.' },
  { key: 'disconfirming', label: 'Kill criteria', weight: 10, what: 'Measurable signals that would prove you wrong.' },
];

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const hasNumber = (text: string) => /\d/.test(text);
const numberCount = (text: string) => (text.match(/\d+(?:[.,]\d+)?\s*(?:%|x|×|bp|bps|b|bn|m|mm|k)?/gi) ?? []).length;
/** Bullet or numbered lines, or else sentences. */
function points(text: string) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => /^([-*•]|\d+[.)])\s+/.test(line));
  if (bullets.length >= 2) return bullets;
  return text.split(/(?<=[.!?])\s+|\n+/).map((line) => line.trim()).filter((line) => words(line) >= 4);
}

const TIMING = /\b(q[1-4]|h[12]|fy\s?\d{2,4}|20\d{2}|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?|earnings|investor day|within \d+|next \d+|\d+\s*(months?|weeks?|quarters?)|this (year|quarter)|guidance|report|vote|ruling|decision|approval|closing|close of|launch date|expiry|expiration)\b/i;
const CONTRAST = /\b(market|consensus|street|investors?|priced|pricing in|implies|implied|expects?|expectations?|believes?|underestimat\w*|overestimat\w*|misses|missing|ignor\w*|overlook\w*|mispric\w*|wrong|while|but|however|whereas)\b/i;
const METHOD = /\b(dcf|discounted cash flow|ev\s*\/\s*ebitda|ev\/ebit|p\s*\/\s*e|pe ratio|p\/fcf|fcf yield|free cash flow yield|p\/s|ev\/sales|p\/b|sum[- ]of[- ]the[- ]parts|sotp|multiple|precedent|comps|comparable|reverse dcf|nav|dividend discount|ddm)\b/i;
const MITIGATE = /\b(mitigat\w*|hedg\w*|offset|protect\w*|stop|size|sizing|watch|monitor|limit\w*|downside|floor|cushion|balance sheet|net cash|because|unlikely|probability|priced in)\b/i;
const THRESHOLD = /\b(below|above|under|over|less than|more than|falls?|drops?|rises?|exceeds?|misses?|fails?|for (two|three|\d+) (consecutive )?(quarters?|months?|years?)|<|>|≤|≥)\b/i;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function scorePitch(draft: PitchDraft): RubricResult {
  const items: RubricItem[] = [];
  const upside = draft.price && draft.target ? draft.target / draft.price - 1 : null;
  const directionalUpside = upside === null ? null : draft.direction === 'long' ? upside : -upside;
  const up = draft.price && draft.bull ? Math.abs(draft.bull - draft.price) : null;
  const down = draft.price && draft.bear ? Math.abs(draft.price - draft.bear) : null;
  const skew =
    draft.price && draft.bull && draft.bear && down && up
      ? draft.direction === 'long'
        ? (draft.bull - draft.price) / (draft.price - draft.bear)
        : (draft.price - draft.bear) / (draft.bull - draft.price)
      : null;

  // Recommendation
  {
    const notes: string[] = [];
    let score = 0;
    if (draft.target && draft.target > 0) score += 0.4;
    else notes.push('Set a target price — a pitch without one is an opinion.');
    if (draft.horizonMonths > 0 && draft.horizonMonths <= 36) score += 0.2;
    else notes.push('Give a time frame (6–18 months is typical).');
    if (directionalUpside !== null) {
      if (directionalUpside <= 0) notes.push(`The target implies ${draft.direction === 'long' ? 'no upside' : 'no downside'} — it contradicts a ${draft.direction}.`);
      else if (directionalUpside < 0.1) {
        score += 0.2;
        notes.push('Under 10% expected return rarely justifies the risk; most funds want 20%+ for a long.');
      } else if (directionalUpside > 1.5) {
        score += 0.25;
        notes.push('Target implies more than 150% — expect heavy pushback; show exactly how you get there.');
      } else score += 0.4;
    }
    if (words(draft.summary) >= 12) {
      if (words(draft.summary) > 90) notes.push('Tighten the summary to two or three sentences.');
    } else notes.push('Write a one- or two-sentence summary: call, target, and the core reason.');
    items.push({ key: 'recommendation', label: 'Recommendation', weight: 10, score: clamp01(score) * (words(draft.summary) >= 12 ? 1 : 0.7), notes });
  }

  // Variant view
  {
    const notes: string[] = [];
    const count = words(draft.variant);
    let score = clamp01(count / 45) * 0.45;
    if (count < 20) notes.push('Spell out what the market believes and why it is wrong.');
    if (CONTRAST.test(draft.variant)) score += 0.3;
    else notes.push('Contrast your view with consensus explicitly ("the market prices…, but…").');
    if (hasNumber(draft.variant)) score += 0.25;
    else notes.push('Quantify the disagreement (e.g. "priced for 5% growth; we see 12%").');
    items.push({ key: 'variant', label: 'Variant view', weight: 20, score: clamp01(score), notes });
  }

  // Thesis pillars
  {
    const notes: string[] = [];
    const pillars = points(draft.thesis);
    const withData = pillars.filter(hasNumber).length;
    let score = 0;
    if (pillars.length >= 2 && pillars.length <= 5) score += 0.45;
    else if (pillars.length === 1) {
      score += 0.2;
      notes.push('Break the thesis into two to four separate pillars.');
    } else if (pillars.length > 5) {
      score += 0.3;
      notes.push('More than five points dilutes the argument — keep the strongest three.');
    } else notes.push('Add two to four thesis pillars.');
    score += pillars.length ? 0.55 * (withData / pillars.length) : 0;
    if (pillars.length && withData < pillars.length) notes.push(`${pillars.length - withData} pillar${pillars.length - withData === 1 ? ' has' : 's have'} no numbers — back each claim with data.`);
    items.push({ key: 'thesis', label: 'Thesis & evidence', weight: 15, score: clamp01(score), notes });
  }

  // Catalysts
  {
    const notes: string[] = [];
    const list = points(draft.catalysts);
    const dated = list.filter((line) => TIMING.test(line)).length;
    let score = list.length ? Math.min(0.4, list.length * 0.15) : 0;
    if (!list.length) notes.push('List the events that will make the market see what you see.');
    score += list.length ? 0.6 * (dated / list.length) : 0;
    if (list.length && dated < list.length) notes.push(`${list.length - dated} catalyst${list.length - dated === 1 ? ' is' : 's are'} undated — hard catalysts have a date or a reporting event.`);
    items.push({ key: 'catalysts', label: 'Catalysts', weight: 15, score: clamp01(score), notes });
  }

  // Valuation
  {
    const notes: string[] = [];
    let score = 0;
    if (METHOD.test(draft.valuation)) score += 0.3;
    else notes.push('Name the method: DCF, EV/EBITDA versus peers, FCF yield, sum-of-the-parts…');
    score += Math.min(0.3, numberCount(draft.valuation) * 0.06);
    if (numberCount(draft.valuation) < 3) notes.push('Show the math: the multiple or rate, the metric, and the resulting value.');
    if (draft.bull && draft.bear) {
      score += 0.2;
      if (skew !== null) {
        if (skew >= 2) score += 0.2;
        else if (skew >= 1) {
          score += 0.1;
          notes.push(`Upside-to-downside is ${skew.toFixed(1)}:1 — many PMs want 2:1 or better.`);
        } else notes.push(`Upside-to-downside is only ${skew.toFixed(1)}:1 — the payoff isn’t asymmetric.`);
      }
    } else notes.push('Add bull and bear values to show the payoff is asymmetric.');
    items.push({ key: 'valuation', label: 'Valuation', weight: 15, score: clamp01(score), notes });
  }

  // Risks
  {
    const notes: string[] = [];
    const list = points(draft.risks);
    let score = Math.min(0.45, list.length * 0.18);
    if (list.length < 2) notes.push('Name at least two company-specific risks.');
    if (MITIGATE.test(draft.risks)) score += 0.3;
    else notes.push('Say why each risk is manageable or how you would size or hedge for it.');
    if (hasNumber(draft.risks)) score += 0.25;
    else notes.push('Quantify the damage if a risk hits (e.g. the bear-case value).');
    items.push({ key: 'risks', label: 'Risks & mitigants', weight: 15, score: clamp01(score), notes });
  }

  // Disconfirming evidence
  {
    const notes: string[] = [];
    const list = points(draft.disconfirming);
    const specific = list.filter((line) => THRESHOLD.test(line) && hasNumber(line)).length;
    let score = list.length ? 0.3 : 0;
    if (!list.length) notes.push('Write down what would make you sell — before you own it.');
    score += list.length ? 0.7 * (specific / list.length) : 0;
    if (list.length && specific < list.length) notes.push('Give each kill criterion a threshold ("gross margin below 60% for two quarters").');
    items.push({ key: 'disconfirming', label: 'Kill criteria', weight: 10, score: clamp01(score), notes });
  }

  const total = Math.round(items.reduce((sum, item) => sum + item.score * item.weight, 0));
  return { total, items, upside, skew };
}

/** A pitch counts as started once any of its written sections has content. */
export function isPitchEmpty(draft: PitchDraft) {
  return ![draft.summary, draft.variant, draft.thesis, draft.catalysts, draft.valuation, draft.risks, draft.disconfirming].some((text) => text.trim());
}

import { diffArrays } from 'diff';

const START = /item\s*1a\.?\s*[-–—:.]?\s*risk\s+factors/gi;
const END = /item\s*1b\.?\s*[-–—:.]?\s*unresolved|item\s*1c\.?\s*[-–—:.]?\s*cybersecurity|item\s*2\.?\s*[-–—:.]?\s*properties/i;

/**
 * The "Item 1A. Risk Factors" section of a 10-K's plain text. The heading also appears in the table
 * of contents, so the longest candidate section wins.
 */
export function extractRiskFactors(text: string) {
  let best = '';
  for (const match of text.matchAll(START)) {
    const rest = text.slice(match.index + match[0].length);
    const end = rest.search(END);
    const section = (end === -1 ? rest.slice(0, 400_000) : rest.slice(0, end)).trim();
    if (section.length > best.length) best = section;
  }
  return best;
}

/** Paragraphs long enough to be a risk (headings and page furniture are dropped). */
export function riskParagraphs(section: string) {
  return section
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length >= 80 && !/^table of contents$/i.test(paragraph));
}

const normalize = (paragraph: string) => paragraph.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');

export type RiskDiff = {
  added: string[];
  removed: string[];
  /** Paragraphs that were reworded rather than added or dropped (most words in common). */
  modified: Array<{ before: string; after: string }>;
  unchanged: number;
  previousCount: number;
  currentCount: number;
};

function similarity(a: string, b: string) {
  const left = new Set(normalize(a).split(' '));
  const right = new Set(normalize(b).split(' '));
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(1, Math.max(left.size, right.size));
}

/** Paragraph-level changes between last year's and this year's risk factors. */
export function diffRiskFactors(previous: string, current: string): RiskDiff {
  const before = riskParagraphs(previous);
  const after = riskParagraphs(current);
  const parts = diffArrays(before.map(normalize), after.map(normalize));
  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;
  let i = 0;
  let j = 0;
  for (const part of parts) {
    const count = part.count ?? part.value.length;
    if (part.added) {
      added.push(...after.slice(j, j + count));
      j += count;
    } else if (part.removed) {
      removed.push(...before.slice(i, i + count));
      i += count;
    } else {
      unchanged += count;
      i += count;
      j += count;
    }
  }
  // Pair each dropped paragraph with its closest new one; close pairs are edits, not new risks.
  const modified: RiskDiff['modified'] = [];
  const remainingAdded = [...added];
  const remainingRemoved: string[] = [];
  for (const old of removed) {
    let bestIndex = -1;
    let bestScore = 0.6;
    remainingAdded.forEach((candidate, index) => {
      const score = similarity(old, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex === -1) remainingRemoved.push(old);
    else modified.push({ before: old, after: remainingAdded.splice(bestIndex, 1)[0] });
  }
  return { added: remainingAdded, removed: remainingRemoved, modified, unchanged, previousCount: before.length, currentCount: after.length };
}

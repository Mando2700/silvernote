import type { ScoreConfidence } from './types';

export function clamp(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function divide(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

/** Linear 0→1 between a weak and a strong value (higher is better). */
export function scoreHigher(value: number | null, weak: number, strong: number) {
  if (value === null || !Number.isFinite(value) || strong === weak) return null;
  return clamp((value - weak) / (strong - weak));
}

/** Linear 1→0 between a strong and a weak value (lower is better). */
export function scoreLower(value: number | null, strong: number, weak: number) {
  if (value === null || !Number.isFinite(value) || weak === strong) return null;
  return clamp((weak - value) / (weak - strong));
}

/** 1 inside the ideal band, fading to 0 at the weak bounds on either side. */
export function scoreRange(value: number | null, lowIdeal: number, highIdeal: number, lowWeak: number, highWeak: number) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value >= lowIdeal && value <= highIdeal) return 1;
  if (value < lowIdeal) return scoreHigher(value, lowWeak, lowIdeal);
  return scoreLower(value, highIdeal, highWeak);
}

/**
 * Lower multiples score better, but non-positive multiples score zero and suspiciously
 * cheap ones (below the distress floor) are capped: cheap is not automatically good.
 */
export function scoreReasonableLower(value: number | null, attractive: number, expensive: number, distressFloor: number) {
  const base = scoreLower(value, attractive, expensive);
  if (base === null || value === null) return base;
  if (value <= 0) return 0;
  if (value < distressFloor) return Math.min(0.58, base);
  return base;
}

/** Growth rates: collapse below −25%, full marks at +25%. */
export function scoreGrowth(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < -0.25) return 0;
  return scoreHigher(value, -0.05, 0.25);
}

/** Coefficient of variation: 0.08 or less is stable, 0.65 or more is erratic. */
export function scoreStabilityCoefficient(value: number | null) {
  return scoreLower(value, 0.08, 0.65);
}

export function confidenceFromCoverage(coverage: number): ScoreConfidence {
  if (coverage >= 0.82) return 'High';
  if (coverage >= 0.62) return 'Medium';
  if (coverage >= 0.34) return 'Low';
  return 'Insufficient';
}

/** Providers mix 12.5 and 0.125 for the same percentage; values above 1.5 are treated as whole percents. */
export function normalizeProviderPercent(value: number | null) {
  if (value === null) return null;
  return Math.abs(value) > 1.5 ? value / 100 : value;
}

export function average(values: Array<number | null | undefined>) {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function standardDeviation(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance);
}

export function coefficientOfVariation(values: Array<number | null | undefined>) {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length < 2) return null;
  const absoluteMean = Math.abs(finite.reduce((sum, value) => sum + value, 0) / finite.length);
  const deviation = standardDeviation(finite);
  if (absoluteMean === 0 || deviation === null) return null;
  return deviation / absoluteMean;
}

export function growth(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  const value = (current - previous) / Math.abs(previous);
  return Number.isFinite(value) ? value : null;
}

/** Compound growth from values ordered newest first; only positive values qualify. */
export function cagr(values: Array<number | null | undefined>, periods: number) {
  const positive = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (positive.length <= periods) return null;
  const latest = positive[0];
  const base = positive[periods];
  if (latest <= 0 || base <= 0) return null;
  const value = (latest / base) ** (1 / periods) - 1;
  return Number.isFinite(value) ? value : null;
}

export function formatPercent(value: number | null, signed = false) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const percent = value * 100;
  const sign = signed && percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(Math.abs(percent) >= 10 ? 1 : 2)}%`;
}

export function formatMultiple(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}x`;
}

export function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(Math.abs(value) >= 100 ? 0 : 2);
}

export function formatCurrencyCompact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absolute >= 1e12) return `${sign}$${(absolute / 1e12).toFixed(1)}T`;
  if (absolute >= 1e9) return `${sign}$${(absolute / 1e9).toFixed(1)}B`;
  if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(1)}M`;
  if (absolute >= 1e3) return `${sign}$${(absolute / 1e3).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(absolute >= 100 ? 0 : 2)}`;
}

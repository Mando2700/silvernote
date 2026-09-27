import { CONFIDENCE_RANK, MISSING_DATA_PRIOR } from './constants';
import { clamp, confidenceFromCoverage } from './normalization';
import type { MetricResult, ScoreConfidence } from './types';

/** Share of the component's metric weight that has real data behind it. */
export function metricCoverage(metrics: MetricResult[]) {
  const total = metrics.reduce((sum, item) => sum + item.metric.weight, 0);
  if (total <= 0) return 0;
  const available = metrics
    .filter((item) => item.normalizedScore !== null)
    .reduce((sum, item) => sum + item.metric.weight, 0);
  return clamp(available / total);
}

/** Share of the metrics flagged as required that are available (falls back to weighted coverage). */
export function requiredMetricCoverage(metrics: MetricResult[]) {
  const required = metrics.filter((item) => item.required);
  if (required.length === 0) return metricCoverage(metrics);
  return clamp(required.filter((item) => item.normalizedScore !== null).length / required.length);
}

export function componentConfidence(metrics: MetricResult[]): ScoreConfidence {
  const blended = metricCoverage(metrics) * 0.62 + requiredMetricCoverage(metrics) * 0.38;
  return confidenceFromCoverage(blended);
}

/**
 * Weighted average of the available metrics, shrunk toward a skeptical prior in proportion to
 * the missing evidence: thin data can't produce a flattering score, but a gap in coverage
 * (no analyst estimates, short price history) doesn't read as a collapse in the business either.
 */
export function componentNormalizedScore(metrics: MetricResult[]) {
  const available = metrics.filter((item) => item.normalizedScore !== null);
  const availableWeight = available.reduce((sum, item) => sum + item.metric.weight, 0);
  if (available.length === 0 || availableWeight <= 0) return MISSING_DATA_PRIOR;
  const weightedAverage =
    available.reduce((sum, item) => sum + (item.normalizedScore ?? 0) * item.metric.weight, 0) / availableWeight;
  const reliability = clamp(metricCoverage(metrics) * 0.7 + requiredMetricCoverage(metrics) * 0.3);
  return clamp(MISSING_DATA_PRIOR + (weightedAverage - MISSING_DATA_PRIOR) * reliability);
}

export function combineConfidence(items: Array<{ confidence: ScoreConfidence; weight: number }>): ScoreConfidence {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return 'Insufficient';
  const averageRank = items.reduce((sum, item) => sum + CONFIDENCE_RANK[item.confidence] * item.weight, 0) / totalWeight;
  if (averageRank >= 2.55) return 'High';
  if (averageRank >= 1.75) return 'Medium';
  if (averageRank >= 0.85) return 'Low';
  return 'Insufficient';
}

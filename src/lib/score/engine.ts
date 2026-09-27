import { SCORE_MAX, SCORE_VERSION, SUB_SCORES } from './constants';
import { combineConfidence, componentConfidence, componentNormalizedScore, metricCoverage, requiredMetricCoverage } from './confidence';
import {
  componentReason,
  detailedDescription,
  scoreLabel,
  shortSummary,
  strengths as buildStrengths,
  watchItems as buildWatchItems,
  weaknesses as buildWeaknesses,
} from './explanations';
import { buildMetricGroups, marketScaleMetric, type MetricGroups } from './metrics';
import { clamp, roundTo } from './normalization';
import type { MetricResult, MissingDataItem, SilverNoteScore, ScoreDataSource, ScoreInput, SubScore, SubScoreKey } from './types';

/**
 * SilverNote Score: ten weighted components built from ~70 normalized metrics.
 *
 *   metric      → 0..1 via a threshold curve (sector-aware bands for margins, returns and leverage)
 *   component   → weighted mean of its available metrics, shrunk toward a skeptical prior by missing data, × 100
 *   overall     → weighted mean of the ten components (weights sum to 100), capped by red flags
 */
export function calculateSilverNoteScore(input: ScoreInput): SilverNoteScore {
  const groups = buildMetricGroups(input);
  const subScores = SUB_SCORES.map((definition): SubScore => {
    const metrics = selectComponentMetrics(input, groups, definition.key);
    const score = roundTo(componentNormalizedScore(metrics) * 100);
    const confidence = componentConfidence(metrics);
    return {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      weight: definition.weight,
      score,
      confidence,
      reason: componentReason({ name: definition.name, score, confidence, metrics }),
      metrics,
    };
  });

  const { score: overallScore, flags } = applyRedFlags(overall(subScores), subScores);
  const strengths = buildStrengths(subScores);
  const weaknesses = buildWeaknesses(subScores);
  const watchItems = [...flags, ...buildWatchItems(subScores)];

  return {
    symbol: normalizeSymbol(input.symbol),
    companyName: input.companyName,
    overallScore,
    maxScore: SCORE_MAX,
    label: scoreLabel(overallScore),
    confidence: combineConfidence(subScores),
    dataQualityScore: roundTo(clamp(dataQuality(subScores), 0, 5), 1),
    subScores,
    dataQualityMetrics: groups.dataQualityConfidence,
    shortSummary: shortSummary(input.companyName, subScores),
    detailedDescription: detailedDescription({ companyName: input.companyName, subScores, strengths, weaknesses, watchItems }),
    strengths,
    weaknesses,
    watchItems,
    missingData: missingData(subScores),
    sources: sources(input, subScores),
    version: SCORE_VERSION,
    calculatedAt: input.calculatedAt ?? new Date().toISOString(),
  };
}

export function overall(subScores: Array<Pick<SubScore, 'score' | 'weight'>>) {
  const totalWeight = subScores.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return 0;
  const mean = subScores.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
  return roundTo(clamp(mean, 0, SCORE_MAX));
}

/**
 * A weighted mean lets strengths paper over a fatal weakness. These caps stop a company with a
 * distressed balance sheet or earnings that don't turn into cash from rating well on everything else.
 */
const RED_FLAGS: Array<{ key: SubScoreKey; below: number; cap: number; message: string }> = [
  { key: 'financialHealth', below: 25, cap: 45, message: 'The balance sheet is under real strain, which caps the overall score.' },
  { key: 'earningsQuality', below: 25, cap: 55, message: 'Reported profit is not showing up as cash, which caps the overall score.' },
  { key: 'profitability', below: 15, cap: 50, message: 'The business is deeply unprofitable, which caps the overall score.' },
];

export function applyRedFlags(score: number, subScores: Array<Pick<SubScore, 'key' | 'score' | 'confidence'>>) {
  let capped = score;
  const flags: string[] = [];
  for (const flag of RED_FLAGS) {
    const item = subScores.find((entry) => entry.key === flag.key);
    // Only trust a red flag that rests on real evidence.
    if (!item || item.confidence === 'Insufficient' || item.score >= flag.below || capped <= flag.cap) continue;
    capped = flag.cap;
    flags.push(flag.message);
  }
  return { score: capped, flags };
}

function pick(groups: MetricGroups, group: keyof MetricGroups, ids?: string[]) {
  const metrics = groups[group] ?? [];
  if (!ids) return metrics;
  const wanted = new Set(ids);
  return metrics.filter((item) => wanted.has(item.metric.id));
}

/** Which evidence feeds which component. Several metrics deliberately inform more than one. */
export function selectComponentMetrics(input: ScoreInput, groups: MetricGroups, key: SubScoreKey): MetricResult[] {
  switch (key) {
    case 'growth':
      return pick(groups, 'growthQuality');
    case 'profitability':
      return pick(groups, 'profitabilityEfficiency', ['grossMargin', 'operatingMargin', 'ebitdaMargin', 'netMargin', 'roe', 'roa', 'roic', 'marginTrend']);
    case 'valuation':
      return pick(groups, 'valuation');
    case 'financialHealth':
      return pick(groups, 'financialStrength');
    case 'momentum':
      return pick(groups, 'marketMomentum');
    case 'earningsQuality':
      return pick(groups, 'earningsQuality');
    case 'competitivePosition':
      return [
        marketScaleMetric(input),
        ...pick(groups, 'profitabilityEfficiency', ['grossMargin', 'roic']),
        ...pick(groups, 'growthQuality', ['revenueCagr3y', 'growthConsistency']),
      ];
    case 'efficiency':
      return [
        ...pick(groups, 'profitabilityEfficiency', ['assetTurnover', 'roa']),
        ...pick(groups, 'earningsQuality', ['cashConversionConsistency']),
      ];
    case 'risk':
      return [
        ...pick(groups, 'riskStability'),
        ...pick(groups, 'financialStrength', ['fcfDebtCoverage', 'interestCoverage']),
      ];
    case 'futureOutlook':
      // Forward-looking fundamentals only; price trend lives in Momentum.
      return [
        ...pick(groups, 'growthQuality', ['forwardRevenueGrowth', 'forwardEpsGrowth', 'revenueCagr3y', 'epsCagr3y', 'cashBackedGrowth']),
        ...pick(groups, 'profitabilityEfficiency', ['marginTrend']),
        ...pick(groups, 'valuation', ['peg']),
      ];
    default:
      return [];
  }
}

function dataQuality(subScores: SubScore[]) {
  const totalWeight = subScores.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted =
    subScores.reduce((sum, item) => {
      const blended = metricCoverage(item.metrics) * 0.72 + requiredMetricCoverage(item.metrics) * 0.28;
      return sum + blended * item.weight;
    }, 0) / totalWeight;
  return weighted * 5;
}

function missingData(subScores: SubScore[]): MissingDataItem[] {
  const seen = new Set<string>();
  const items: MissingDataItem[] = [];
  for (const subScore of subScores) {
    for (const item of subScore.metrics) {
      if (item.metric.isAvailable) continue;
      const key = `${subScore.key}:${item.metric.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ subScore: subScore.key, metricId: item.metric.id, label: item.metric.name, reason: missingReason(item.metric.sourceField, subScore.name) });
    }
  }
  return items;
}

function missingReason(sourceField: string, componentName: string) {
  if (/forward|estimate/i.test(sourceField)) return 'No analyst estimate is available for this company.';
  if (sourceField.includes('candles') || sourceField.includes('sma')) return 'Not enough price history is loaded yet.';
  if (sourceField.includes('metrics.')) return 'The market data sources did not provide this figure.';
  if (/financials|annual|ratio|statements/.test(sourceField)) return `The filings do not contain enough detail for this ${componentName.toLowerCase()} measure.`;
  return 'No source currently provides this figure.';
}

function sources(input: ScoreInput, subScores: SubScore[]): ScoreDataSource[] {
  const map = new Map<string, ScoreDataSource>();
  for (const subScore of subScores) {
    for (const item of subScore.metrics) {
      if (!item.metric.isAvailable) continue;
      const name = item.metric.sourceName ?? 'SilverNote data layer';
      const entry = map.get(name) ?? { name, fields: [] };
      if (!entry.fields.includes(item.metric.sourceField)) entry.fields.push(item.metric.sourceField);
      if (!entry.lastUpdated && item.metric.asOfDate) entry.lastUpdated = item.metric.asOfDate;
      map.set(name, entry);
    }
  }
  if (input.quote) {
    const name = input.quote.source ?? 'Market quote';
    const entry = map.get(name) ?? { name, fields: [] };
    for (const field of ['quote.price', 'quote.change', 'quote.timestamp']) if (!entry.fields.includes(field)) entry.fields.push(field);
    entry.lastUpdated = input.quote.lastUpdated ?? entry.lastUpdated;
    map.set(name, entry);
  }
  return [...map.values()].map((entry) => ({ ...entry, fields: entry.fields.slice(0, 12) })).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 24);
}

import type { StatementPeriod } from '@/lib/finance/statement-types';

export type ScoreLabel = 'Excellent' | 'Strong' | 'Good' | 'Mixed' | 'Weak';
export type ScoreConfidence = 'High' | 'Medium' | 'Low' | 'Insufficient';
export type MetricDirection = 'higher-is-better' | 'lower-is-better' | 'range-is-best' | 'sector-relative';

/** Evidence groups: every metric is computed inside one of these. */
export type MetricGroupId =
  | 'financialStrength'
  | 'profitabilityEfficiency'
  | 'growthQuality'
  | 'valuation'
  | 'marketMomentum'
  | 'riskStability'
  | 'earningsQuality'
  | 'dataQualityConfidence';

/** The ten components that make up the headline number. */
export type SubScoreKey =
  | 'growth'
  | 'profitability'
  | 'valuation'
  | 'financialHealth'
  | 'momentum'
  | 'earningsQuality'
  | 'competitivePosition'
  | 'efficiency'
  | 'risk'
  | 'futureOutlook';

export type ScoreMetric = {
  id: string;
  name: string;
  group: MetricGroupId | 'marketScale';
  rawValue: number | string | null;
  formattedValue: string;
  /** Points earned (normalized score × weight); null when unavailable. */
  score: number | null;
  maxScore: number;
  weight: number;
  direction: MetricDirection;
  sourceField: string;
  sourceName?: string;
  asOfDate?: string;
  explanation: string;
  isAvailable: boolean;
};

export type MetricResult = {
  metric: ScoreMetric;
  /** 0–1 once available, null when the input is missing. */
  normalizedScore: number | null;
  required?: boolean;
};

export type SubScore = {
  key: SubScoreKey;
  name: string;
  description: string;
  weight: number;
  score: number;
  confidence: ScoreConfidence;
  reason: string;
  metrics: MetricResult[];
};

export type MissingDataItem = {
  subScore: SubScoreKey;
  metricId: string;
  label: string;
  reason: string;
};

export type ScoreDataSource = {
  name: string;
  fields: string[];
  lastUpdated?: string;
};

export type SilverNoteScore = {
  symbol: string;
  companyName?: string;
  overallScore: number;
  maxScore: 100;
  label: ScoreLabel;
  confidence: ScoreConfidence;
  /** 0–5: how much of the evidence the engine could actually use. */
  dataQualityScore: number;
  subScores: SubScore[];
  dataQualityMetrics: MetricResult[];
  shortSummary: string;
  detailedDescription: string;
  strengths: string[];
  weaknesses: string[];
  watchItems: string[];
  missingData: MissingDataItem[];
  sources: ScoreDataSource[];
  version: string;
  calculatedAt: string;
};

export type ScoreCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type ScoreQuote = {
  currentPrice?: number | null;
  change?: number | null;
  changePercent?: number | null;
  marketCap?: number | null;
  timestamp?: number | null;
  lastUpdated?: string | null;
  source?: string | null;
};

export type ScoreProfile = {
  name?: string | null;
  industry?: string | null;
  sector?: string | null;
  marketCap?: number | null;
  sharesOutstanding?: number | null;
};

export type ScoreRatioCategoryKey =
  | 'valuation'
  | 'profitability'
  | 'growth'
  | 'financialHealth'
  | 'cashFlow'
  | 'technicals';

export type ScoreRatio = {
  category: ScoreRatioCategoryKey;
  id: string;
  name: string;
  kind: 'currency' | 'multiple' | 'number' | 'percent';
  value: number | null;
};

export type ScoreRatioCategory = {
  key: ScoreRatioCategoryKey;
  title: string;
  ratios: ScoreRatio[];
};

export type StatementAvailability = 'ok' | 'unavailable' | 'error';

export type ScoreInput = {
  symbol: string;
  companyName?: string;
  calculatedAt?: string;
  candles: ScoreCandle[];
  quote: ScoreQuote | null;
  profile: ScoreProfile | null;
  /** Additional market metrics (beta, 52-week range, moving averages, forward estimates…). */
  metrics: Record<string, number | string | null>;
  /** Most recent annual figures merged across the three statements. */
  latest: StatementPeriod;
  annual: StatementPeriod[];
  quarterly: StatementPeriod[];
  ratios: ScoreRatioCategory[];
  dataQuality: {
    hasBasic: boolean;
    hasMetrics: boolean;
    hasFinancials: boolean;
    incomeStatement: StatementAvailability;
    balanceSheet: StatementAvailability;
    cashFlow: StatementAvailability;
    hasPeerData?: boolean;
  };
};

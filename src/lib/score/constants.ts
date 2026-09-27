import type { MetricGroupId, SubScoreKey } from './types';

export const SCORE_MAX = 100;
export const SCORE_VERSION = 'silvernote-score-1.1';

type SubScoreDefinition = { key: SubScoreKey; name: string; description: string; weight: number };
type GroupDefinition = { id: MetricGroupId; name: string; description: string; weight: number };

/**
 * Component weights sum to 100; the headline score is their weighted mean.
 * The score rates the business, so price-driven components (momentum, most of risk) carry little weight.
 */
export const SUB_SCORES: readonly SubScoreDefinition[] = [
  { key: 'growth', name: 'Growth', weight: 15, description: 'How fast sales, earnings and free cash flow are compounding, and how steadily.' },
  { key: 'profitability', name: 'Profitability', weight: 15, description: 'Margins at every level of the income statement and returns on the capital employed.' },
  { key: 'valuation', name: 'Valuation', weight: 12, description: 'What the market charges for earnings, sales and cash flow, adjusted for quality.' },
  { key: 'financialHealth', name: 'Financial Health', weight: 13, description: 'Leverage, liquidity and how comfortably cash flow services the debt.' },
  { key: 'momentum', name: 'Momentum', weight: 3, description: 'Price trend across horizons, position against moving averages and the 52-week high.' },
  { key: 'earningsQuality', name: 'Earnings Quality', weight: 11, description: 'Whether reported profit turns into cash, accrual pressure and share-count discipline.' },
  { key: 'competitivePosition', name: 'Competitive Position', weight: 10, description: 'Measurable signs of an edge: scale, pricing power, returns and durable growth.' },
  { key: 'efficiency', name: 'Efficiency', weight: 7, description: 'How productively assets and capital are used and how well profit converts to cash.' },
  { key: 'risk', name: 'Risk', weight: 6, description: 'Volatility, drawdowns, earnings stability, balance-sheet stress and valuation risk.' },
  { key: 'futureOutlook', name: 'Future Outlook', weight: 8, description: 'Forward estimates, multi-year growth runway and trend support for what comes next.' },
];

export const SUB_SCORE_BY_KEY = Object.fromEntries(SUB_SCORES.map((item) => [item.key, item])) as Record<
  SubScoreKey,
  SubScoreDefinition
>;

/** Evidence groups. A group's weight scales the weight of every metric inside it. */
export const METRIC_GROUPS: readonly GroupDefinition[] = [
  { id: 'financialStrength', name: 'Financial Strength', weight: 18, description: 'Balance-sheet resilience, liquidity and debt capacity.' },
  { id: 'profitabilityEfficiency', name: 'Profitability & Efficiency', weight: 18, description: 'Margins, returns on capital and asset productivity.' },
  { id: 'growthQuality', name: 'Growth Quality', weight: 18, description: 'Durable growth in sales, earnings, EBITDA and free cash flow.' },
  { id: 'valuation', name: 'Valuation', weight: 16, description: 'Multiples and yields read against quality and growth.' },
  { id: 'marketMomentum', name: 'Market Momentum', weight: 10, description: 'Recent price strength and trend structure.' },
  { id: 'riskStability', name: 'Risk & Stability', weight: 10, description: 'Volatility, drawdowns, beta and distress indicators.' },
  { id: 'earningsQuality', name: 'Earnings Quality', weight: 5, description: 'Cash backing, accruals and dilution.' },
  { id: 'dataQualityConfidence', name: 'Data Quality', weight: 5, description: 'Breadth, depth and freshness of the evidence.' },
];

export const METRIC_GROUP_BY_ID = Object.fromEntries(METRIC_GROUPS.map((item) => [item.id, item])) as Record<
  MetricGroupId,
  GroupDefinition
>;

export const CONFIDENCE_RANK = { Insufficient: 0, Low: 1, Medium: 2, High: 3 } as const;

/**
 * Missing evidence pulls a component toward this skeptical prior (0–1) instead of toward zero:
 * unknown is treated as slightly below average, not as a failure.
 */
export const MISSING_DATA_PRIOR = 0.4;

import type { StatementPeriod } from '@/lib/finance/statement-types';

import { METRIC_GROUP_BY_ID } from './constants';
import {
  average,
  cagr,
  clamp,
  coefficientOfVariation,
  divide,
  formatMultiple,
  formatNumber,
  formatPercent,
  growth,
  normalizeProviderPercent,
  scoreGrowth,
  scoreHigher,
  scoreLower,
  scoreRange,
  scoreReasonableLower,
  scoreStabilityCoefficient,
  standardDeviation,
  toFiniteNumber,
} from './normalization';
import type { MetricDirection, MetricGroupId, MetricResult, ScoreInput } from './types';

type MetricSpec = {
  id: string;
  name: string;
  direction: MetricDirection;
  raw: number | string | null;
  normalized: number | null;
  weight: number;
  required?: boolean;
  formatted: string;
  sourceField: string;
  sourceName: string;
  explanation: string;
  asOfDate?: string | null;
};

function build(group: MetricGroupId, spec: MetricSpec): MetricResult {
  const normalized = spec.normalized === null ? null : clamp(spec.normalized);
  const maxScore = METRIC_GROUP_BY_ID[group].weight * spec.weight;
  const isAvailable = spec.raw !== null && spec.raw !== undefined && normalized !== null;
  return {
    metric: {
      id: spec.id,
      name: spec.name,
      group,
      rawValue: spec.raw ?? null,
      formattedValue: isAvailable ? spec.formatted : 'n/a',
      score: isAvailable ? (normalized as number) * maxScore : null,
      maxScore,
      weight: maxScore,
      direction: spec.direction,
      sourceField: spec.sourceField,
      sourceName: spec.sourceName,
      asOfDate: spec.asOfDate ?? undefined,
      explanation: spec.explanation,
      isAvailable,
    },
    normalizedScore: isAvailable ? normalized : null,
    required: spec.required ?? false,
  };
}

/** Threshold bands that differ by business model; a grocer and a software firm can't share one margin scale. */
type SectorBands = {
  gross: [number, number];
  operating: [number, number];
  ebitda: [number, number];
  net: [number, number];
  roa: [number, number];
  assetTurnover: [number, number];
  debtEquity: [number, number];
  netDebtEbitda: [number, number];
};

const DEFAULT_BANDS: SectorBands = {
  gross: [0.18, 0.62], operating: [0.02, 0.28], ebitda: [0.06, 0.34], net: [0, 0.22],
  roa: [0.02, 0.14], assetTurnover: [0.25, 1.2], debtEquity: [0.35, 2.6], netDebtEbitda: [0.5, 4.5],
};

export function sectorBands(input: ScoreInput): SectorBands {
  const sector = input.profile?.sector ?? '';
  const industry = input.profile?.industry ?? '';
  if (/retail|grocer|food distribut|wholesale|distributors|supermarket|drug stores|automobile/i.test(industry)) {
    return { ...DEFAULT_BANDS, gross: [0.12, 0.42], operating: [0.01, 0.12], ebitda: [0.03, 0.16], net: [0, 0.08], roa: [0.02, 0.1], assetTurnover: [0.8, 2.4] };
  }
  if (/utilit/i.test(sector)) {
    return { ...DEFAULT_BANDS, operating: [0.06, 0.3], ebitda: [0.15, 0.45], net: [0.02, 0.16], roa: [0.01, 0.05], assetTurnover: [0.1, 0.4], debtEquity: [0.8, 2.8], netDebtEbitda: [3, 6.5] };
  }
  if (/real estate/i.test(sector)) {
    return { ...DEFAULT_BANDS, operating: [0.1, 0.45], ebitda: [0.3, 0.7], net: [0, 0.35], roa: [0.01, 0.06], assetTurnover: [0.05, 0.2], debtEquity: [0.5, 2.2], netDebtEbitda: [3, 8] };
  }
  if (/consumer staples/i.test(sector)) {
    return { ...DEFAULT_BANDS, gross: [0.2, 0.55], operating: [0.03, 0.22], ebitda: [0.06, 0.26], net: [0, 0.15], roa: [0.02, 0.12], assetTurnover: [0.5, 1.6] };
  }
  if (/industrials|materials|energy/i.test(sector)) {
    return { ...DEFAULT_BANDS, gross: [0.12, 0.45], operating: [0.02, 0.2], ebitda: [0.06, 0.3], net: [0, 0.14], roa: [0.02, 0.1], assetTurnover: [0.35, 1.2] };
  }
  return DEFAULT_BANDS;
}

export function buildMetricGroups(input: ScoreInput) {
  return {
    financialStrength: financialStrength(input),
    profitabilityEfficiency: profitabilityEfficiency(input),
    growthQuality: growthQuality(input),
    valuation: valuation(input),
    marketMomentum: marketMomentum(input),
    riskStability: riskStability(input),
    earningsQuality: earningsQuality(input),
    dataQualityConfidence: dataQualityConfidence(input),
  } satisfies Record<MetricGroupId, MetricResult[]>;
}

export type MetricGroups = ReturnType<typeof buildMetricGroups>;

// ─── Financial strength ─────────────────────────────────────────────────────

function financialStrength(input: ScoreInput): MetricResult[] {
  if (isBank(input)) return bankFinancialStrength(input);
  const g = 'financialStrength' as const;
  const latest = input.latest;
  const asOfDate = latest.fiscalDate;
  const debtEquity = ratio(input, 'debtEquity');
  const netDebtEbitda = ratio(input, 'netDebtEbitda');
  const currentRatio = ratio(input, 'currentRatio');
  const quickRatio = divide(subtract(latest.currentAssets, latest.inventory ?? 0), latest.currentLiabilities);
  const cashCoverage = divide(latest.cash, latest.currentLiabilities);
  const fcfDebtCoverage = divide(latest.freeCashFlow, latest.totalDebt);
  const interestCoverage = metricNumber(input, ['interestCoverage', 'interestCoverageTTM']);
  const leverageTrend = trend(input.annual, (period) => period.totalDebt);
  const bands = sectorBands(input);

  return [
    build(g, {
      id: 'debtToEquity', name: 'Debt to equity', direction: 'lower-is-better', required: true, weight: 0.18,
      raw: debtEquity, formatted: formatMultiple(debtEquity), asOfDate,
      normalized: debtEquity !== null && debtEquity < 0 ? 0 : scoreLower(debtEquity, ...bands.debtEquity),
      sourceField: 'ratio.debtEquity', sourceName: 'Balance sheet',
      explanation: debtEquity !== null && debtEquity < 0
        ? 'Shareholder equity is negative, so this reads as a warning sign rather than low leverage.'
        : 'Less debt per dollar of equity leaves room to absorb a bad year and keep investing.',
    }),
    build(g, {
      id: 'netDebtEbitda', name: 'Net debt / EBITDA', direction: 'lower-is-better', required: true, weight: 0.17,
      raw: netDebtEbitda, formatted: formatMultiple(netDebtEbitda), asOfDate,
      normalized: netDebtEbitda !== null && netDebtEbitda < 0 ? 1 : scoreLower(netDebtEbitda, ...bands.netDebtEbitda),
      sourceField: 'ratio.netDebtEbitda', sourceName: 'Balance sheet and income statement',
      explanation: 'Years of operating earnings needed to pay off debt net of cash. A net cash position scores full marks.',
    }),
    build(g, {
      id: 'currentRatio', name: 'Current ratio', direction: 'range-is-best', required: true, weight: 0.14,
      raw: currentRatio, formatted: formatMultiple(currentRatio), asOfDate,
      normalized: scoreRange(currentRatio, 1.2, 2.6, 0.65, 5),
      sourceField: 'ratio.currentRatio', sourceName: 'Balance sheet',
      explanation: 'Short-term assets against short-term bills. Best in a comfortable band; hoarding far beyond it earns nothing extra.',
    }),
    build(g, {
      id: 'quickRatio', name: 'Quick ratio', direction: 'range-is-best', weight: 0.1,
      raw: quickRatio, formatted: formatMultiple(quickRatio), asOfDate,
      normalized: scoreRange(quickRatio, 0.9, 2.2, 0.45, 4),
      sourceField: 'financials.(currentAssets-inventory)/currentLiabilities', sourceName: 'Balance sheet',
      explanation: 'A stricter liquidity test that ignores inventory, which can be slow to turn into cash.',
    }),
    build(g, {
      id: 'cashShortTermCoverage', name: 'Cash / current liabilities', direction: 'higher-is-better', weight: 0.11,
      raw: cashCoverage, formatted: formatMultiple(cashCoverage), asOfDate,
      normalized: scoreRange(cashCoverage, 0.35, 1.8, 0.05, 3.5),
      sourceField: 'financials.cash/currentLiabilities', sourceName: 'Balance sheet',
      explanation: 'How much of the next year’s obligations could be met from cash on hand alone.',
    }),
    build(g, {
      id: 'fcfDebtCoverage', name: 'FCF / total debt', direction: 'higher-is-better', required: true, weight: 0.13,
      raw: fcfDebtCoverage, formatted: formatPercent(fcfDebtCoverage), asOfDate,
      normalized: scoreHigher(fcfDebtCoverage, -0.02, 0.35),
      sourceField: 'financials.freeCashFlow/totalDebt', sourceName: 'Cash flow statement and balance sheet',
      explanation: 'The share of debt one year of free cash flow could retire.',
    }),
    build(g, {
      id: 'interestCoverage', name: 'Interest coverage', direction: 'higher-is-better', weight: 0.09,
      raw: interestCoverage, formatted: formatMultiple(interestCoverage), asOfDate,
      normalized: scoreHigher(interestCoverage, 1.5, 8),
      sourceField: 'metrics.interestCoverage', sourceName: 'Operating income / interest expense',
      explanation: 'How many times operating profit covers the interest bill.',
    }),
    build(g, {
      id: 'leverageTrend', name: 'Debt trend', direction: 'lower-is-better', weight: 0.08,
      raw: leverageTrend, formatted: formatPercent(leverageTrend, true), asOfDate,
      normalized: leverageTrend !== null ? (leverageTrend <= -0.1 ? 1 : scoreLower(leverageTrend, 0.05, 0.75)) : null,
      sourceField: 'annual.totalDebt', sourceName: 'Annual balance sheets',
      explanation: 'Change in total debt across recent fiscal years; paying debt down scores well, piling it on does not.',
    }),
  ];
}

function bankFinancialStrength(input: ScoreInput): MetricResult[] {
  const g = 'financialStrength' as const;
  const latest = input.latest;
  const asOfDate = latest.fiscalDate;
  const capitalRatio = normalizeProviderPercent(metricNumber(input, ['commonEquityTier1Ratio', 'cet1Ratio', 'tier1CapitalRatio']));
  const equityToAssets = divide(latest.totalEquity, latest.totalAssets);
  const roa = ratio(input, 'roa') ?? divide(latest.netIncome, latest.totalAssets);
  const roe = ratio(input, 'roe') ?? divide(latest.netIncome, latest.totalEquity);
  const profitableYears = positiveShare(input.annual, (period) => period.netIncome);
  const capitalTrend = trend(input.annual, (period) => period.totalEquity);

  return [
    build(g, {
      id: 'regulatoryCapitalRatio', name: 'Regulatory capital ratio', direction: 'higher-is-better', required: true, weight: 0.22,
      raw: capitalRatio, formatted: formatPercent(capitalRatio), asOfDate,
      normalized: scoreHigher(capitalRatio, 0.08, 0.14),
      sourceField: 'metrics.commonEquityTier1Ratio', sourceName: 'Market metrics',
      explanation: 'CET1 or Tier 1 capital: the regulator’s own measure of a bank’s loss-absorbing buffer.',
    }),
    build(g, {
      id: 'equityToAssets', name: 'Equity / assets', direction: 'higher-is-better', required: true, weight: 0.26,
      raw: equityToAssets, formatted: formatPercent(equityToAssets), asOfDate,
      normalized: scoreHigher(equityToAssets, 0.045, 0.1),
      sourceField: 'financials.totalEquity/totalAssets', sourceName: 'Balance sheet',
      explanation: 'Accounting capital as a share of the balance sheet; a backstop when regulatory ratios are not available.',
    }),
    build(g, {
      id: 'bankReturnOnAssets', name: 'Return on assets', direction: 'higher-is-better', required: true, weight: 0.18,
      raw: roa, formatted: formatPercent(roa), asOfDate,
      normalized: scoreHigher(roa, 0.004, 0.014),
      sourceField: 'ratio.roa', sourceName: 'Income statement and balance sheet',
      explanation: 'Profit earned on the asset base, the engine that rebuilds capital from retained earnings.',
    }),
    build(g, {
      id: 'bankReturnOnEquity', name: 'Return on equity', direction: 'range-is-best', weight: 0.14,
      raw: roe, formatted: formatPercent(roe), asOfDate,
      normalized: scoreRange(roe, 0.1, 0.2, 0.03, 0.35),
      sourceField: 'ratio.roe', sourceName: 'Income statement and balance sheet',
      explanation: 'Healthy bank returns sit in a band; extreme ROE usually means extra leverage, not extra safety.',
    }),
    build(g, {
      id: 'profitableYearConsistency', name: 'Profitable years', direction: 'higher-is-better', required: true, weight: 0.12,
      raw: profitableYears, asOfDate,
      formatted: profitableYears === null ? 'n/a' : `${Math.round(profitableYears * 100)}% of years`,
      normalized: scoreHigher(profitableYears, 0.5, 1),
      sourceField: 'annual.netIncome', sourceName: 'Annual income statements',
      explanation: 'Share of recent fiscal years that ended in profit.',
    }),
    build(g, {
      id: 'bankCapitalTrend', name: 'Capital trend', direction: 'higher-is-better', weight: 0.08,
      raw: capitalTrend, formatted: formatPercent(capitalTrend, true), asOfDate,
      normalized: scoreHigher(capitalTrend, -0.12, 0.12),
      sourceField: 'annual.totalEquity', sourceName: 'Annual balance sheets',
      explanation: 'Whether reported equity is growing or shrinking across recent years.',
    }),
  ];
}

// ─── Profitability & efficiency ─────────────────────────────────────────────

function profitabilityEfficiency(input: ScoreInput): MetricResult[] {
  const g = 'profitabilityEfficiency' as const;
  const latest = input.latest;
  const asOfDate = latest.fiscalDate;
  const grossMargin = ratio(input, 'grossMargin');
  const operatingMargin = ratio(input, 'operatingMargin');
  const ebitdaMargin = ratio(input, 'ebitdaMargin');
  const netMargin = ratio(input, 'netMargin');
  // ROE is meaningless on negative equity (a loss over a deficit reads as a high return).
  const roe = latest.totalEquity != null && latest.totalEquity <= 0 ? null : ratio(input, 'roe');
  const roa = ratio(input, 'roa');
  const roic = returnOnInvestedCapital(latest);
  const bands = sectorBands(input);
  const assetTurnover = divide(latest.revenue, latest.totalAssets);
  const marginTrend = trend(input.annual, (period) => divide(period.netIncome, period.revenue));

  const margin = (id: string, name: string, value: number | null, [weak, strong]: [number, number], weight: number, required: boolean, explanation: string, sourceField: string) =>
    build(g, {
      id, name, direction: 'higher-is-better', required, weight, raw: value, formatted: formatPercent(value), asOfDate,
      normalized: scoreHigher(value, weak, strong), sourceField, sourceName: 'Income statement', explanation,
    });

  return [
    margin('grossMargin', 'Gross margin', grossMargin, bands.gross, 0.13, true, 'What is left of each sales dollar after direct costs — a read on pricing power.', 'ratio.grossMargin'),
    margin('operatingMargin', 'Operating margin', operatingMargin, bands.operating, 0.14, true, 'Profit from the core business after all operating costs.', 'ratio.operatingMargin'),
    margin('ebitdaMargin', 'EBITDA margin', ebitdaMargin, bands.ebitda, 0.11, false, 'Operating profit before depreciation and amortization, as a share of sales.', 'ratio.ebitdaMargin'),
    margin('netMargin', 'Net margin', netMargin, bands.net, 0.13, true, 'Bottom-line profit after interest, taxes and one-offs.', 'ratio.netMargin'),
    build(g, {
      id: 'roe', name: 'Return on equity', direction: 'higher-is-better', weight: 0.12, raw: roe, formatted: formatPercent(roe), asOfDate,
      normalized: scoreHigher(roe, 0.04, 0.28), sourceField: 'ratio.roe', sourceName: 'Income statement and balance sheet',
      explanation: 'Profit generated on shareholders’ capital.',
    }),
    build(g, {
      id: 'roa', name: 'Return on assets', direction: 'higher-is-better', weight: 0.1, raw: roa, formatted: formatPercent(roa), asOfDate,
      normalized: scoreHigher(roa, ...bands.roa), sourceField: 'ratio.roa', sourceName: 'Income statement and balance sheet',
      explanation: 'Profit generated on everything the company owns, comparable across capital structures.',
    }),
    build(g, {
      id: 'roic', name: 'Return on invested capital', direction: 'higher-is-better', weight: 0.12, raw: roic, formatted: formatPercent(roic), asOfDate,
      normalized: scoreHigher(roic, 0.04, 0.22), sourceField: 'financials.nopat/investedCapital', sourceName: 'Reported financials',
      explanation: 'After-tax operating profit on the debt and equity actually put to work, net of cash.',
    }),
    build(g, {
      id: 'assetTurnover', name: 'Asset turnover', direction: 'higher-is-better', weight: 0.07, raw: assetTurnover, formatted: formatMultiple(assetTurnover), asOfDate,
      normalized: scoreHigher(assetTurnover, ...bands.assetTurnover), sourceField: 'financials.revenue/totalAssets', sourceName: 'Income statement and balance sheet',
      explanation: 'Sales generated per dollar of assets.',
    }),
    build(g, {
      id: 'marginTrend', name: 'Net margin trend', direction: 'higher-is-better', weight: 0.08, raw: marginTrend, formatted: formatPercent(marginTrend, true), asOfDate,
      normalized: scoreHigher(marginTrend, -0.08, 0.08), sourceField: 'annual.netMargin', sourceName: 'Annual income statements',
      explanation: 'Whether net margin has been widening or eroding over recent years.',
    }),
  ];
}

// ─── Growth quality ─────────────────────────────────────────────────────────

function growthQuality(input: ScoreInput): MetricResult[] {
  const g = 'growthQuality' as const;
  const asOfDate = input.latest.fiscalDate;
  const revenueGrowth = ratio(input, 'revenueGrowth');
  const revenueCagr3y = ratio(input, 'revenueCagr3y');
  const epsGrowth = ratio(input, 'epsGrowth');
  const epsCagr3y = cagr(input.annual.map((period) => period.epsDiluted), 3);
  const fcfGrowth = ratio(input, 'fcfGrowth');
  const ebitdaGrowth = trend(input.annual, (period) => period.ebitda);
  const forwardRevenueGrowth = normalizeProviderPercent(metricNumber(input, ['forwardRevenueGrowth', 'revenueGrowthForward', 'revenueEstimateGrowth']));
  const forwardEpsGrowth = normalizeProviderPercent(metricNumber(input, ['forwardEpsGrowth', 'epsGrowthForward', 'epsEstimateGrowth']));
  const consistency = positiveGrowthShare(input.annual, (period) => period.revenue);
  const cashBacked = average([scoreGrowth(revenueGrowth), scoreGrowth(fcfGrowth), scoreHigher(ratio(input, 'fcfMargin'), 0, 0.18)]);

  const growthMetric = (id: string, name: string, value: number | null, weight: number, required: boolean, sourceField: string, sourceName: string, explanation: string, dated = true) =>
    build(g, {
      id, name, direction: 'higher-is-better', required, weight, raw: value, formatted: formatPercent(value, true),
      asOfDate: dated ? asOfDate : null, normalized: scoreGrowth(value), sourceField, sourceName, explanation,
    });

  return [
    growthMetric('revenueGrowthYoy', 'Revenue growth (1Y)', revenueGrowth, 0.15, true, 'ratio.revenueGrowth', 'Income statement', 'Latest year-over-year change in sales.'),
    growthMetric('revenueCagr3y', 'Revenue CAGR (3Y)', revenueCagr3y, 0.13, true, 'ratio.revenueCagr3y', 'Annual income statements', 'Compound annual sales growth over three years, which smooths out a single lucky or unlucky year.'),
    growthMetric('epsGrowthYoy', 'EPS growth (1Y)', epsGrowth, 0.11, false, 'ratio.epsGrowth', 'Income statement', 'Change in diluted earnings per share; buybacks and tax items can flatter or depress it.'),
    growthMetric('epsCagr3y', 'EPS CAGR (3Y)', epsCagr3y, 0.1, false, 'annual.epsDiluted', 'Annual income statements', 'Three-year compound growth in diluted EPS.'),
    growthMetric('fcfGrowth', 'Free cash flow growth', fcfGrowth, 0.12, true, 'ratio.fcfGrowth', 'Cash flow statement', 'Whether growth is showing up as more free cash, not just more reported profit.'),
    growthMetric('ebitdaGrowth', 'EBITDA growth', ebitdaGrowth, 0.1, false, 'annual.ebitda', 'Annual income statements', 'Change in operating earnings power across recent years.'),
    growthMetric('forwardRevenueGrowth', 'Forward revenue growth', forwardRevenueGrowth, 0.08, false, 'metrics.forwardRevenueGrowth', 'Analyst estimates', 'Consensus expectation for next year’s sales growth, used only when estimates exist.', false),
    growthMetric('forwardEpsGrowth', 'Forward EPS growth', forwardEpsGrowth, 0.07, false, 'metrics.forwardEpsGrowth', 'Analyst estimates', 'Consensus expectation for next year’s EPS growth, used only when estimates exist.', false),
    build(g, {
      id: 'growthConsistency', name: 'Growth consistency', direction: 'higher-is-better', weight: 0.08, raw: consistency, asOfDate,
      formatted: consistency === null ? 'n/a' : `${Math.round(consistency * 100)}% of years up`,
      normalized: consistency, sourceField: 'annual.revenue', sourceName: 'Annual income statements',
      explanation: 'Share of recent years in which sales grew — steady compounding beats one big jump.',
    }),
    build(g, {
      id: 'cashBackedGrowth', name: 'Cash-backed growth', direction: 'higher-is-better', weight: 0.06, raw: cashBacked, asOfDate,
      formatted: cashBacked === null ? 'n/a' : `${Math.round(cashBacked * 100)}/100`,
      normalized: cashBacked, sourceField: 'derived.revenueGrowth+fcfGrowth+fcfMargin', sourceName: 'Derived from reported financials',
      explanation: 'Blends sales growth with free-cash-flow growth and margin, so growth that burns cash scores lower.',
    }),
  ];
}

// ─── Valuation ──────────────────────────────────────────────────────────────

function valuation(input: ScoreInput): MetricResult[] {
  const g = 'valuation' as const;
  const latest = input.latest;
  const asOfDate = latest.fiscalDate;
  const pe = ratio(input, 'pe');
  const forwardPe = metricNumber(input, ['forwardPE', 'forwardPe', 'peForwardAnnual']);
  const epsGrowth = ratio(input, 'epsGrowth');
  const peUnavailable = pe === null || pe <= 0;
  const peg = !peUnavailable
    ? metricNumber(input, ['pegRatio', 'pegTTM']) ?? (pe !== null && epsGrowth !== null && epsGrowth > 0 ? pe / (epsGrowth * 100) : null)
    : null;
  const ps = ratio(input, 'ps');
  const pb = ratio(input, 'pb');
  const evEbitda = ratio(input, 'evEbitda');
  const evSales = divide(enterpriseValue(input), latest.revenue);
  const pfcf = ratio(input, 'pfcf');
  const fcfYield = ratio(input, 'fcfYield');
  const earningsYield = ratio(input, 'earningsYield');
  const netMargin = ratio(input, 'netMargin');
  const revenueGrowth = ratio(input, 'revenueGrowth');
  const netBand = sectorBands(input).net;
  // High-margin businesses (relative to their sector) earn a more generous sales-multiple band.
  const highMargin = netMargin !== null && netMargin > netBand[1] * 0.8;
  const peScore = !peUnavailable ? scoreReasonableLower(pe, 18, 65, 5) : null;
  const psScore = scoreReasonableLower(ps, highMargin ? 5 : 2.5, highMargin ? 18 : 9, 0.35);
  const qualityAdjusted = average([
    peUnavailable ? psScore : peScore,
    peUnavailable ? null : psScore,
    scoreHigher(fcfYield, -0.01, 0.08),
    scoreHigher(netMargin, ...netBand),
    scoreGrowth(revenueGrowth),
  ]);
  const multiple = (id: string, name: string, value: number | null, normalized: number | null, weight: number, required: boolean, sourceField: string, sourceName: string, explanation: string, dated = true) =>
    build(g, {
      id, name, direction: 'lower-is-better', required, weight, raw: value, formatted: formatMultiple(value),
      asOfDate: dated ? asOfDate : null, normalized, sourceField, sourceName, explanation,
    });

  return [
    // P/E only takes part when earnings are positive; otherwise P/S takes over its weight below.
    ...(peUnavailable
      ? []
      : [multiple('pe', 'P/E', pe, peScore, 0.12, true, 'ratio.pe', 'Price and reported earnings', 'Price paid per dollar of earnings. A single-digit multiple is treated with suspicion, not rewarded outright.')]),
    multiple('forwardPe', 'Forward P/E', forwardPe, scoreReasonableLower(forwardPe, 16, 55, 5), 0.08, false, 'metrics.forwardPE', 'Analyst estimates', 'Price against next year’s expected earnings, when an estimate exists.', false),
    multiple('peg', 'PEG ratio', peg, scoreReasonableLower(peg, 1.2, 3.5, 0.25), 0.08, false, 'metrics.pegRatio or pe/epsGrowth', 'Price, EPS and EPS growth', 'P/E divided by the EPS growth rate: paying up is fine when growth justifies it.', false),
    multiple('priceToSales', 'Price / sales', ps, psScore, peUnavailable && ps !== null ? 0.22 : 0.1, true, 'ratio.ps', 'Market value and revenue',
      peUnavailable
        ? 'With no meaningful P/E, the sales multiple carries the main valuation weight.'
        : 'Sales multiple judged against margins: profitable companies can support more.'),
    multiple('priceToBook', 'Price / book', pb, scoreReasonableLower(pb, 2, 12, 0.25), 0.07, false, 'ratio.pb', 'Market value and equity', 'Most telling for asset-heavy businesses, so it carries a light weight.'),
    multiple('evEbitda', 'EV / EBITDA', evEbitda, scoreReasonableLower(evEbitda, 10, 35, 3), 0.1, false, 'ratio.evEbitda', 'Enterprise value and EBITDA', 'Whole-company value, debt included, against operating earnings.'),
    multiple('evSales', 'EV / sales', evSales, scoreReasonableLower(evSales, 3, 12, 0.35), 0.08, false, 'derived.enterpriseValue/revenue', 'Enterprise value and revenue', 'Enterprise value per dollar of sales.'),
    multiple('priceToFcf', 'Price / free cash flow', pfcf, scoreReasonableLower(pfcf, 16, 55, 4), 0.1, true, 'ratio.pfcf', 'Market value and free cash flow', 'What the market charges for each dollar of free cash flow; negative cash flow scores zero.'),
    build(g, {
      id: 'fcfYield', name: 'Free cash flow yield', direction: 'higher-is-better', required: true, weight: 0.1, raw: fcfYield, formatted: formatPercent(fcfYield), asOfDate,
      normalized: scoreHigher(fcfYield, -0.01, 0.08), sourceField: 'ratio.fcfYield', sourceName: 'Market value and free cash flow',
      explanation: 'Free cash flow as a percentage of market value, the cash return on buying the whole company.',
    }),
    build(g, {
      id: 'earningsYield', name: 'Earnings yield', direction: 'higher-is-better', weight: 0.08, raw: earningsYield, formatted: formatPercent(earningsYield), asOfDate,
      normalized: scoreHigher(earningsYield, -0.01, 0.07), sourceField: 'ratio.earningsYield', sourceName: 'Market value and earnings',
      explanation: 'Earnings as a percentage of price, the inverse of P/E.',
    }),
    build(g, {
      id: 'valuationAdjustedForQuality', name: 'Quality-adjusted valuation', direction: 'sector-relative', weight: 0.09, raw: qualityAdjusted, asOfDate,
      formatted: qualityAdjusted === null ? 'n/a' : `${Math.round(qualityAdjusted * 100)}/100`,
      normalized: qualityAdjusted, sourceField: 'derived.valuationQualityAdjustment', sourceName: 'Derived from multiples, margins and growth',
      explanation: 'Blends the main multiple with cash yield, margin and growth, so quality can offset a higher price.',
    }),
  ];
}

// ─── Market momentum ────────────────────────────────────────────────────────

function marketMomentum(input: ScoreInput): MetricResult[] {
  const g = 'marketMomentum' as const;
  const candles = input.candles;
  const perf1m = performanceOverDays(candles, 30);
  const perf3m = performanceOverDays(candles, 90);
  const perf6m = performanceOverDays(candles, 180);
  const perf12m = performanceOverDays(candles, 365);
  const sma50 = ratio(input, 'sma50') ?? metricNumber(input, ['50DayMovingAverage', 'sma50']);
  const sma200 = ratio(input, 'sma200') ?? metricNumber(input, ['200DayMovingAverage', 'sma200']);
  const price = input.quote?.currentPrice ?? null;
  const maScore = movingAverageScore(price, sma50, sma200);
  const priceVsHigh = ratio(input, 'priceVsHigh');
  const volume = volumeTrend(candles);
  const perf = (id: string, name: string, value: number | null, weak: number, strong: number, weight: number, days: number, explanation: string) =>
    build(g, {
      id, name, direction: 'higher-is-better', weight, raw: value, formatted: formatPercent(value, true),
      normalized: scoreHigher(value, weak, strong), sourceField: `candles.close.${days}d`, sourceName: 'Price history', explanation,
    });

  return [
    perf('performance1m', '1-month return', perf1m, -0.12, 0.14, 0.18, 30, 'Price change over the last month.'),
    perf('performance3m', '3-month return', perf3m, -0.18, 0.24, 0.16, 90, 'Price change over the last quarter, less noisy than one month.'),
    perf('performance6m', '6-month return', perf6m, -0.25, 0.35, 0.13, 180, 'Price change over six months, the medium-term trend.'),
    perf('performance12m', '12-month return', perf12m, -0.3, 0.5, 0.12, 365, 'Price change over a full year.'),
    build(g, {
      id: 'movingAverageTrend', name: 'Moving-average structure', direction: 'higher-is-better', weight: 0.17, raw: maScore,
      formatted: maScore === null ? 'n/a' : `${Math.round(maScore * 100)}/100`, normalized: maScore,
      sourceField: 'sma50+sma200', sourceName: 'Price history',
      explanation: 'Price above a rising 50-day average that sits above the 200-day is the strongest trend shape.',
    }),
    build(g, {
      id: 'distanceFrom52WeekHigh', name: 'Distance from 52-week high', direction: 'higher-is-better', weight: 0.16, raw: priceVsHigh,
      formatted: formatPercent(priceVsHigh, true), normalized: scoreHigher(priceVsHigh, -0.5, -0.05),
      sourceField: 'ratio.priceVsHigh', sourceName: 'Price history',
      explanation: 'How far the price sits below its 52-week high: deep drawdowns score low, near-highs score high.',
    }),
    build(g, {
      id: 'volumeTrend', name: 'Volume trend', direction: 'higher-is-better', weight: 0.08, raw: volume,
      formatted: volume === null ? 'n/a' : `${Math.round(volume * 100)}/100`, normalized: volume, asOfDate: input.latest.fiscalDate,
      sourceField: 'candles.volume', sourceName: 'Price history',
      explanation: 'Recent trading volume against the prior weeks: healthy participation without a panic spike.',
    }),
  ];
}

// ─── Risk & stability ───────────────────────────────────────────────────────

function riskStability(input: ScoreInput): MetricResult[] {
  const g = 'riskStability' as const;
  const asOfDate = input.latest.fiscalDate;
  const beta = ratio(input, 'volatility') ?? metricNumber(input, ['beta']);
  const volatility = annualizedVolatility(input.candles);
  const drawdown = maxDrawdown(input.candles);
  const downside = downsideVolatility(input.candles);
  const earningsCv = coefficientOfVariation(input.annual.map((period) => period.netIncome));
  const revenueCv = coefficientOfVariation(input.annual.map((period) => period.revenue));
  const bands = sectorBands(input);
  const debtRisk = average([
    scoreLower(ratio(input, 'debtEquity'), ...bands.debtEquity),
    scoreLower(ratio(input, 'netDebtEbitda'), ...bands.netDebtEbitda),
    scoreHigher(ratio(input, 'fcfYield'), -0.01, 0.08),
  ]);
  const altmanZ = metricNumber(input, ['altmanZScore', 'zScore']);

  return [
    build(g, {
      id: 'beta', name: 'Beta', direction: 'range-is-best', weight: 0.14, raw: beta, formatted: formatNumber(beta),
      normalized: scoreRange(beta, 0.55, 1.1, 0, 2.2), sourceField: 'metrics.beta', sourceName: 'Price history vs S&P 500',
      explanation: 'Sensitivity to market swings. Moderate beta is ideal; very high beta amplifies every selloff.',
    }),
    build(g, {
      id: 'annualizedVolatility', name: 'Annualized volatility', direction: 'lower-is-better', weight: 0.13, raw: volatility, formatted: formatPercent(volatility),
      normalized: scoreLower(volatility, 0.18, 0.7), sourceField: 'candles.close', sourceName: 'Price history',
      explanation: 'Typical yearly price swing implied by daily returns.',
    }),
    build(g, {
      id: 'maxDrawdown', name: 'Maximum drawdown', direction: 'lower-is-better', weight: 0.13, raw: drawdown, formatted: formatPercent(drawdown, true),
      normalized: drawdown === null ? null : scoreLower(Math.abs(drawdown), 0.12, 0.55), sourceField: 'candles.close', sourceName: 'Price history',
      explanation: 'Worst peak-to-trough fall in the loaded price history.',
    }),
    build(g, {
      id: 'downsideVolatility', name: 'Downside volatility', direction: 'lower-is-better', weight: 0.11, raw: downside, formatted: formatPercent(downside),
      normalized: scoreLower(downside, 0.12, 0.55), sourceField: 'candles.close.negativeReturns', sourceName: 'Price history',
      explanation: 'Volatility measured on down days only — the kind that hurts.',
    }),
    build(g, {
      id: 'earningsVolatility', name: 'Earnings volatility', direction: 'lower-is-better', weight: 0.12, raw: earningsCv, formatted: formatNumber(earningsCv), asOfDate,
      normalized: scoreStabilityCoefficient(earningsCv), sourceField: 'annual.netIncome', sourceName: 'Annual income statements',
      explanation: 'How much net income jumps around from year to year (coefficient of variation).',
    }),
    build(g, {
      id: 'revenueVolatility', name: 'Revenue volatility', direction: 'lower-is-better', weight: 0.1, raw: revenueCv, formatted: formatNumber(revenueCv), asOfDate,
      normalized: scoreStabilityCoefficient(revenueCv), sourceField: 'annual.revenue', sourceName: 'Annual income statements',
      explanation: 'How much sales swing from year to year, a proxy for cyclicality.',
    }),
    build(g, {
      id: 'debtRisk', name: 'Balance-sheet risk', direction: 'higher-is-better', weight: 0.16, raw: debtRisk, asOfDate,
      formatted: debtRisk === null ? 'n/a' : `${Math.round(debtRisk * 100)}/100`, normalized: debtRisk,
      sourceField: 'derived.debtRisk', sourceName: 'Reported financials',
      explanation: 'Combines leverage, net debt and cash yield into a single stress reading.',
    }),
    build(g, {
      id: 'altmanZScore', name: 'Altman Z-score', direction: 'higher-is-better', weight: 0.11, raw: altmanZ, formatted: formatNumber(altmanZ), asOfDate,
      normalized: scoreHigher(altmanZ, 1.8, 3.2), sourceField: 'metrics.altmanZScore', sourceName: 'Reported financials and market value',
      explanation: 'Classic bankruptcy-risk model: below 1.8 signals distress, above 3 a safe zone. Only used when every input exists.',
    }),
  ];
}

// ─── Earnings quality ───────────────────────────────────────────────────────

function earningsQuality(input: ScoreInput): MetricResult[] {
  const g = 'earningsQuality' as const;
  const latest = input.latest;
  const asOfDate = latest.fiscalDate;
  const fcfToIncome = divide(latest.freeCashFlow, latest.netIncome);
  const ocfToIncome = divide(latest.operatingCashFlow, latest.netIncome);
  const accruals = divide(subtract(latest.netIncome, latest.operatingCashFlow), latest.totalAssets);
  const dilution = trend(input.annual, (period) => period.sharesDiluted);
  const conversion = cashConversionConsistency(input.annual);

  return [
    build(g, {
      id: 'fcfNetIncome', name: 'FCF / net income', direction: 'range-is-best', required: true, weight: 0.24, raw: fcfToIncome, formatted: formatMultiple(fcfToIncome), asOfDate,
      normalized: scoreRange(fcfToIncome, 0.8, 1.6, -0.25, 3), sourceField: 'financials.freeCashFlow/netIncome', sourceName: 'Cash flow statement and income statement',
      explanation: 'Free cash flow per dollar of reported profit. Near or above one means earnings are real cash.',
    }),
    build(g, {
      id: 'ocfNetIncome', name: 'Operating cash flow / net income', direction: 'range-is-best', required: true, weight: 0.22, raw: ocfToIncome, formatted: formatMultiple(ocfToIncome), asOfDate,
      normalized: scoreRange(ocfToIncome, 0.9, 1.8, -0.2, 3.2), sourceField: 'financials.operatingCashFlow/netIncome', sourceName: 'Cash flow statement and income statement',
      explanation: 'Operating cash against profit, before capital spending.',
    }),
    build(g, {
      id: 'accrualRatio', name: 'Accrual ratio', direction: 'lower-is-better', weight: 0.18, raw: accruals, formatted: formatPercent(accruals), asOfDate,
      normalized: accruals === null ? null : scoreLower(Math.abs(accruals), 0.02, 0.18), sourceField: 'financials.(netIncome-operatingCashFlow)/totalAssets', sourceName: 'Reported financials',
      explanation: 'The gap between profit and operating cash, scaled by assets. Large gaps often precede disappointments.',
    }),
    build(g, {
      id: 'shareDilutionTrend', name: 'Share count trend', direction: 'lower-is-better', weight: 0.18, raw: dilution, formatted: formatPercent(dilution, true), asOfDate,
      normalized: dilution === null ? null : dilution <= -0.02 ? 1 : scoreLower(dilution, 0, 0.2), sourceField: 'annual.sharesDiluted', sourceName: 'Annual income statements',
      explanation: 'Change in diluted share count. Buybacks score well; steady dilution erodes each share’s claim.',
    }),
    build(g, {
      id: 'cashConversionConsistency', name: 'Cash conversion consistency', direction: 'higher-is-better', weight: 0.18, raw: conversion, asOfDate,
      formatted: conversion === null ? 'n/a' : `${Math.round(conversion * 100)}% of years`, normalized: conversion,
      sourceField: 'annual.operatingCashFlow+annual.netIncome', sourceName: 'Annual statements',
      explanation: 'Share of recent years in which operating cash flow kept pace with profit.',
    }),
  ];
}

// ─── Data quality & confidence ──────────────────────────────────────────────

function dataQualityConfidence(input: ScoreInput): MetricResult[] {
  const g = 'dataQualityConfidence' as const;
  const requiredCoverage = requiredFieldCoverage(input);
  const statementCoverage =
    [input.dataQuality.incomeStatement, input.dataQuality.balanceSheet, input.dataQuality.cashFlow].filter((status) => status === 'ok').length / 3;
  const freshness = marketFreshness(input);
  const periods = input.annual.length;
  const estimates = hasForwardEstimates(input) ? 1 : null;
  const peer = input.dataQuality.hasPeerData ? 1 : null;
  const completeness = average([
    input.dataQuality.hasBasic ? 1 : 0,
    input.dataQuality.hasMetrics ? 1 : 0,
    input.dataQuality.hasFinancials ? 1 : 0,
    input.quote ? 1 : 0,
    input.candles.length >= 20 ? 1 : 0,
  ]);
  const pct = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);

  return [
    build(g, {
      id: 'requiredMetricCoverage', name: 'Core field coverage', direction: 'higher-is-better', required: true, weight: 0.22, raw: requiredCoverage, formatted: pct(requiredCoverage),
      normalized: requiredCoverage, sourceField: 'score.requiredFields', sourceName: 'SilverNote score engine',
      explanation: 'Share of the core price, statement and ratio fields that were available.',
    }),
    build(g, {
      id: 'statementCoverage', name: 'Statement coverage', direction: 'higher-is-better', required: true, weight: 0.18, raw: statementCoverage, formatted: pct(statementCoverage),
      normalized: statementCoverage, sourceField: 'statements', sourceName: 'Standardized statements', asOfDate: input.latest.fiscalDate,
      explanation: 'Whether the income statement, balance sheet and cash flow statement were all usable.',
    }),
    build(g, {
      id: 'marketFreshness', name: 'Quote freshness', direction: 'higher-is-better', weight: 0.14, raw: freshness,
      formatted: freshness === null ? 'n/a' : `${Math.round(freshness * 100)}/100`, normalized: freshness,
      sourceField: 'quote.timestamp', sourceName: 'Market quote',
      explanation: 'How recent the price used for valuation is.',
    }),
    build(g, {
      id: 'historicalPeriods', name: 'Years of history', direction: 'higher-is-better', weight: 0.14, raw: periods, formatted: `${periods} years`,
      normalized: scoreHigher(periods, 1, 4), sourceField: 'annual.length', sourceName: 'Annual statements',
      explanation: 'More fiscal years make trend, stability and CAGR readings trustworthy.',
    }),
    build(g, {
      id: 'sectorPeerData', name: 'Sector context', direction: 'sector-relative', weight: 0.1, raw: peer, formatted: peer ? 'Available' : 'n/a',
      normalized: peer, sourceField: 'universe.sectorMedians', sourceName: 'SilverNote universe',
      explanation: 'Whether sector medians exist to put the numbers in context.',
    }),
    build(g, {
      id: 'analystEstimates', name: 'Analyst estimates', direction: 'higher-is-better', weight: 0.1, raw: estimates, formatted: estimates ? 'Available' : 'n/a',
      normalized: estimates, sourceField: 'metrics.forwardEstimates', sourceName: 'Analyst estimates',
      explanation: 'Forward estimates improve the growth and valuation read when they exist.',
    }),
    build(g, {
      id: 'sourceCompleteness', name: 'Source completeness', direction: 'higher-is-better', weight: 0.12, raw: completeness, formatted: pct(completeness),
      normalized: completeness, sourceField: 'profile+metrics+statements+quote+candles', sourceName: 'SilverNote data layer',
      explanation: 'Whether profile, metrics, statements, quote and price history all contributed.',
    }),
  ];
}

// ─── Market scale (competitive position) ────────────────────────────────────

/** Log-scaled market value between $1B and $250B: a proxy for durability, not proof of a moat. */
export function marketScaleMetric(input: ScoreInput): MetricResult {
  const marketCap = input.profile?.marketCap ?? input.quote?.marketCap ?? null;
  const value = toFiniteNumber(marketCap);
  const normalized =
    value === null || value <= 0 ? null : clamp((Math.log(value) - Math.log(1e9)) / (Math.log(250e9) - Math.log(1e9)));
  const isAvailable = value !== null && normalized !== null;
  return {
    metric: {
      id: 'marketScale',
      name: 'Market scale',
      group: 'marketScale',
      rawValue: value,
      formattedValue: isAvailable ? compactDollars(value) : 'n/a',
      score: isAvailable ? normalized : null,
      maxScore: 1,
      weight: 1,
      direction: 'higher-is-better',
      sourceField: 'profile.marketCap',
      sourceName: 'Market data',
      explanation: 'Size signals staying power and bargaining power. It supports, but never proves, a competitive edge.',
      isAvailable,
    },
    normalizedScore: isAvailable ? normalized : null,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function compactDollars(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

export function ratio(input: ScoreInput, id: string) {
  for (const category of input.ratios) {
    const item = category.ratios.find((entry) => entry.id === id);
    if (typeof item?.value === 'number' && Number.isFinite(item.value)) return item.value;
  }
  return null;
}

function metricNumber(input: ScoreInput, keys: string[]) {
  for (const key of keys) {
    const value = toFiniteNumber(input.metrics[key]);
    if (value !== null) return value;
  }
  return null;
}

function subtract(a: number | null | undefined, b: number | null | undefined) {
  if (a == null || b == null) return null;
  const value = a - b;
  return Number.isFinite(value) ? value : null;
}

/** Change from the oldest to the newest of up to five annual values (rows newest first). */
function trend(rows: StatementPeriod[], select: (period: StatementPeriod) => number | null | undefined) {
  const values = rows
    .slice(0, 5)
    .map(select)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length < 2) return null;
  return growth(values[0], values[values.length - 1]);
}

function returnOnInvestedCapital(latest: StatementPeriod) {
  const pretax = latest.pretaxIncome;
  const tax = latest.taxExpense;
  const taxRate = pretax && pretax > 0 && tax != null ? clamp(tax / pretax, 0, 0.4) : null;
  const nopat = latest.operatingIncome != null ? latest.operatingIncome * (1 - (taxRate ?? 0)) : null;
  const invested = subtract((latest.totalDebt ?? 0) + (latest.totalEquity ?? 0), latest.cash ?? 0);
  return divide(nopat, invested && invested > 0 ? invested : null);
}

export function enterpriseValue(input: ScoreInput) {
  const marketCap = input.profile?.marketCap ?? input.quote?.marketCap ?? null;
  if (marketCap === null) return null;
  return marketCap + (input.latest.totalDebt ?? 0) - (input.latest.cash ?? 0);
}

function positiveGrowthShare(rows: StatementPeriod[], select: (period: StatementPeriod) => number | null | undefined) {
  const values = rows
    .slice(0, 5)
    .map(select)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length < 3) return null;
  let comparable = 0;
  let positive = 0;
  for (let index = 0; index < values.length - 1; index += 1) {
    const change = growth(values[index], values[index + 1]);
    if (change !== null) {
      comparable += 1;
      if (change > 0) positive += 1;
    }
  }
  return comparable > 0 ? positive / comparable : null;
}

function positiveShare(rows: StatementPeriod[], select: (period: StatementPeriod) => number | null | undefined) {
  const values = rows
    .slice(0, 5)
    .map(select)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length < 3) return null;
  return values.filter((value) => value > 0).length / values.length;
}

export function isBank(input: ScoreInput) {
  const industryText = [input.profile?.industry, input.profile?.sector].filter(Boolean).join(' ');
  if (/\b(?:bank|banks|banking|thrift|thrifts|savings institutions)\b/i.test(industryText)) return true;
  if (input.profile?.industry) return false;
  return /\b(?:bank|bancorp|bancshares)\b/i.test([input.companyName, input.profile?.name].filter(Boolean).join(' '));
}

type SortedCandle = { close: number; seconds: number; volume?: number | null };

function sortedCandles(candles: ScoreInput['candles']): SortedCandle[] {
  return (candles ?? [])
    .map((candle) => ({ close: candle.close, seconds: toSeconds(candle.timestamp), volume: candle.volume }))
    .filter((candle) => Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.seconds))
    .sort((a, b) => a.seconds - b.seconds);
}

function toSeconds(timestamp: number) {
  return timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp;
}

export function performanceOverDays(candles: ScoreInput['candles'], dayCount: number) {
  const sorted = sortedCandles(candles);
  if (sorted.length < 2) return null;
  const latest = sorted[sorted.length - 1];
  const target = latest.seconds - dayCount * 86_400;
  const base = [...sorted].reverse().find((candle) => candle.seconds <= target) ?? sorted[0];
  if (latest.close <= 0 || base.close <= 0 || base.seconds === latest.seconds) return null;
  // Require at least ~45% of the window to be covered by real history.
  if ((latest.seconds - base.seconds) / 86_400 < dayCount * 0.45) return null;
  return (latest.close - base.close) / base.close;
}

function movingAverageScore(price: number | null, sma50: number | null, sma200: number | null) {
  if (price === null || sma50 === null || sma200 === null || price <= 0 || sma50 <= 0 || sma200 <= 0) return null;
  if (price > sma50 && sma50 > sma200) return 1;
  if (price > sma50 && price > sma200) return 0.78;
  if (price > sma50 || sma50 > sma200) return 0.58;
  if (price < sma50 && sma50 < sma200) return 0.18;
  return 0.35;
}

function volumeTrend(candles: ScoreInput['candles']) {
  const volumes = sortedCandles(candles)
    .map((candle) => candle.volume)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (volumes.length < 20) return null;
  const recent = average(volumes.slice(-10));
  const prior = average(volumes.slice(-30, -10));
  if (recent === null || prior === null || prior <= 0) return null;
  return scoreRange(recent / prior, 0.85, 1.35, 0.35, 2.75);
}

function logReturns(candles: ScoreInput['candles']) {
  const sorted = sortedCandles(candles);
  const returns: Array<{ value: number; seconds: number }> = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous.close > 0 && current.close > 0) {
      returns.push({ value: Math.log(current.close / previous.close), seconds: current.seconds });
    }
  }
  return returns;
}

function annualize(returns: Array<{ value: number; seconds: number }>) {
  const deviation = standardDeviation(returns.map((item) => item.value));
  if (deviation === null) return null;
  const years = Math.max((returns[returns.length - 1].seconds - returns[0].seconds) / (365 * 86_400), 1 / 252);
  return deviation * Math.sqrt(returns.length / years);
}

export function annualizedVolatility(candles: ScoreInput['candles']) {
  const returns = logReturns(candles);
  return returns.length < 8 ? null : annualize(returns);
}

function downsideVolatility(candles: ScoreInput['candles']) {
  const returns = logReturns(candles).filter((item) => item.value < 0);
  return returns.length < 4 ? null : annualize(returns);
}

export function maxDrawdown(candles: ScoreInput['candles']) {
  const sorted = sortedCandles(candles);
  if (sorted.length < 2) return null;
  let peak = sorted[0].close;
  let worst = 0;
  for (const candle of sorted) {
    if (candle.close > peak) peak = candle.close;
    if (peak > 0) worst = Math.min(worst, (candle.close - peak) / peak);
  }
  return worst;
}

function cashConversionConsistency(rows: StatementPeriod[]) {
  const count = Math.min(rows.length, 5);
  if (count < 2) return null;
  let usable = 0;
  let supportive = 0;
  for (let index = 0; index < count; index += 1) {
    const ocf = rows[index]?.operatingCashFlow;
    const netIncome = rows[index]?.netIncome;
    if (typeof ocf !== 'number' || typeof netIncome !== 'number' || !Number.isFinite(ocf) || !Number.isFinite(netIncome)) continue;
    usable += 1;
    if (netIncome <= 0 ? ocf > netIncome : ocf >= netIncome * 0.8) supportive += 1;
  }
  return usable > 0 ? supportive / usable : null;
}

function requiredFieldCoverage(input: ScoreInput) {
  const latest = input.latest;
  const fields = [
    input.profile?.marketCap ?? input.quote?.marketCap ?? null,
    input.quote?.currentPrice ?? null,
    latest.revenue,
    latest.netIncome,
    latest.freeCashFlow,
    latest.operatingCashFlow,
    latest.totalDebt,
    latest.totalEquity,
    latest.currentAssets,
    latest.currentLiabilities,
    ratio(input, 'pe'),
    ratio(input, 'ps'),
    ratio(input, 'grossMargin'),
    ratio(input, 'netMargin'),
    ratio(input, 'revenueGrowth'),
    ratio(input, 'debtEquity'),
    ratio(input, 'fcfYield'),
    metricNumber(input, ['beta']),
    input.candles.length >= 20 ? 1 : null,
  ];
  return fields.filter((value) => value !== null && value !== undefined).length / fields.length;
}

function marketFreshness(input: ScoreInput) {
  const quote = input.quote;
  const now = Date.parse(input.calculatedAt ?? new Date().toISOString());
  const timestamp =
    typeof quote?.timestamp === 'number' && Number.isFinite(quote.timestamp)
      ? toSeconds(quote.timestamp) * 1000
      : quote?.lastUpdated
        ? Date.parse(quote.lastUpdated)
        : null;
  if (!timestamp || !Number.isFinite(timestamp) || !Number.isFinite(now)) return null;
  const ageHours = Math.max(0, (now - timestamp) / 3_600_000);
  if (ageHours <= 24) return 1;
  if (ageHours <= 72) return 0.8;
  if (ageHours <= 240) return 0.55;
  return 0.25;
}

function hasForwardEstimates(input: ScoreInput) {
  return [
    'forwardRevenueGrowth', 'revenueGrowthForward', 'revenueEstimateGrowth', 'forwardEpsGrowth', 'epsGrowthForward',
    'epsEstimateGrowth', 'forwardPE', 'forwardPe', 'peForwardAnnual',
  ].some((key) => metricNumber(input, [key]) !== null);
}

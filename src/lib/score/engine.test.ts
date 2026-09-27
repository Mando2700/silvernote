import { describe, expect, it } from 'vitest';

import type { StatementPeriod } from '@/lib/finance/statement-types';

import { componentNormalizedScore } from './confidence';
import { METRIC_GROUP_BY_ID, MISSING_DATA_PRIOR, SUB_SCORES } from './constants';
import { applyRedFlags, calculateSilverNoteScore, overall } from './engine';
import { buildScoreInput } from './input';
import { buildMetricGroups, sectorBands } from './metrics';
import type { ScoreCandle, ScoreInput, ScoreRatio, ScoreRatioCategory } from './types';

function period(year: number, values: Partial<StatementPeriod>): StatementPeriod {
  return {
    key: `FY${year}`,
    period: 'FY',
    fiscalYear: year,
    fiscalQuarter: null,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    label: `FY${String(year).slice(-2)}`,
    currency: 'USD',
    filed: null,
    form: '10-K',
    fiscalDate: `${year}-12-31`,
    year,
    ...values,
  };
}

function candles(): ScoreCandle[] {
  const start = Date.parse('2025-05-29T16:00:00.000Z') / 1000;
  return Array.from({ length: 400 }, (_, index) => {
    const close = 100 + index * 0.13 + Math.sin(index / 17) * 2;
    return { timestamp: start + index * 86_400, open: close * 0.996, high: close * 1.012, low: close * 0.988, close, volume: 8_000_000 + (index % 21) * 90_000 };
  });
}

function ratio(category: ScoreRatio['category'], id: string, value: number | null, kind: ScoreRatio['kind'] = 'number'): ScoreRatio {
  return { category, id, name: id, kind, value };
}

const latestValues: Partial<StatementPeriod> = {
  cash: 42_000, capex: -8_500, costOfRevenue: 165_000, currentAssets: 138_000, currentLiabilities: 91_000,
  depreciationAmortization: 7_800, ebit: 83_000, ebitda: 90_800, epsDiluted: 8.4, freeCashFlow: 64_500,
  grossProfit: 155_000, inventory: 9_500, netIncome: 61_000, operatingCashFlow: 73_000, operatingIncome: 83_000,
  pretaxIncome: 78_000, revenue: 320_000, sharesDiluted: 7_200, taxExpense: 17_000, totalAssets: 410_000,
  totalDebt: 71_000, totalEquity: 155_000, totalLiabilities: 255_000,
};

function richInput(): ScoreInput {
  const latest = period(2025, latestValues);
  const annual = [
    latest,
    period(2024, { ...latestValues, epsDiluted: 7.4, netIncome: 54_000, revenue: 290_000, sharesDiluted: 7_400, currentAssets: 125_000, currentLiabilities: 90_000, totalDebt: 76_000, totalEquity: 143_000, freeCashFlow: 57_000, operatingCashFlow: 65_000 }),
    period(2023, { ...latestValues, epsDiluted: 6.6, netIncome: 49_000, revenue: 260_000, sharesDiluted: 7_650, currentAssets: 118_000, currentLiabilities: 88_000, totalDebt: 81_000, totalEquity: 132_000, freeCashFlow: 51_000, operatingCashFlow: 59_000 }),
    period(2022, { ...latestValues, epsDiluted: 5.8, netIncome: 43_000, revenue: 232_000, sharesDiluted: 7_900, currentAssets: 110_000, currentLiabilities: 84_000, totalDebt: 86_000, totalEquity: 124_000, freeCashFlow: 45_000, operatingCashFlow: 52_000 }),
  ];
  const ratios: ScoreRatioCategory[] = [
    { key: 'valuation', title: 'Valuation', ratios: [ratio('valuation', 'pe', 19.7), ratio('valuation', 'ps', 3.75), ratio('valuation', 'pb', 7.7), ratio('valuation', 'pfcf', 18.6), ratio('valuation', 'evEbitda', 13.5), ratio('valuation', 'fcfYield', 0.054), ratio('valuation', 'earningsYield', 0.051)] },
    { key: 'profitability', title: 'Profitability', ratios: [ratio('profitability', 'grossMargin', 0.484), ratio('profitability', 'operatingMargin', 0.259), ratio('profitability', 'ebitdaMargin', 0.284), ratio('profitability', 'netMargin', 0.191), ratio('profitability', 'roe', 0.394), ratio('profitability', 'roa', 0.149)] },
    { key: 'growth', title: 'Growth', ratios: [ratio('growth', 'revenueGrowth', 0.103), ratio('growth', 'revenueCagr3y', 0.113), ratio('growth', 'epsGrowth', 0.135), ratio('growth', 'fcfGrowth', 0.132)] },
    { key: 'financialHealth', title: 'Financial health', ratios: [ratio('financialHealth', 'debtEquity', 0.458), ratio('financialHealth', 'currentRatio', 1.516), ratio('financialHealth', 'netDebtEbitda', 0.319)] },
    { key: 'cashFlow', title: 'Cash flow', ratios: [ratio('cashFlow', 'fcfMargin', 0.202), ratio('cashFlow', 'fcfConversion', 1.057)] },
    { key: 'technicals', title: 'Technicals', ratios: [ratio('technicals', 'volatility', 1.05), ratio('technicals', 'sma50', 146), ratio('technicals', 'sma200', 129), ratio('technicals', 'priceVsHigh', -0.04)] },
  ];
  const quote = { currentPrice: 160, change: 1.2, changePercent: 0.8, marketCap: 1_200_000, timestamp: Date.parse('2026-07-03T11:45:00.000Z') / 1000, source: 'fixture' };
  return {
    symbol: 'TST',
    companyName: 'Test Compounder',
    calculatedAt: '2026-07-03T12:00:00.000Z',
    candles: candles(),
    quote,
    profile: { name: 'Test Compounder', industry: 'Technology', marketCap: 1_200_000, sharesOutstanding: 7_200 },
    metrics: { '50DayMovingAverage': 146, '200DayMovingAverage': 129, beta: 1.05, forwardPE: 24, interestCoverage: 14, pegRatio: 1.6 },
    latest,
    annual,
    quarterly: [],
    ratios,
    dataQuality: { hasBasic: true, hasMetrics: true, hasFinancials: true, incomeStatement: 'ok', balanceSheet: 'ok', cashFlow: 'ok' },
  };
}

function sparseInput(): ScoreInput {
  return {
    symbol: 'THIN',
    companyName: 'Thin Data Inc.',
    calculatedAt: '2026-07-03T12:00:00.000Z',
    candles: [],
    quote: null,
    profile: { name: 'Thin Data Inc.', marketCap: 100_000 },
    metrics: {},
    latest: period(2025, {}),
    annual: [],
    quarterly: [],
    ratios: [],
    dataQuality: { hasBasic: true, hasMetrics: false, hasFinancials: false, incomeStatement: 'unavailable', balanceSheet: 'unavailable', cashFlow: 'unavailable' },
  };
}

function bankInput(): ScoreInput {
  const input = richInput();
  const latest = period(2025, { cash: 620_000, netIncome: 58_000, totalAssets: 4_000_000, totalDebt: 850_000, totalEquity: 327_000, totalLiabilities: 3_673_000 });
  input.symbol = 'BANK';
  input.companyName = 'Example Diversified Bank';
  input.profile = { ...input.profile, name: 'Example Diversified Bank', industry: 'Banks - Diversified' };
  input.latest = latest;
  input.annual = [
    latest,
    period(2024, { totalAssets: 3_800_000, totalEquity: 305_000, netIncome: 51_000 }),
    period(2023, { totalAssets: 3_650_000, totalEquity: 292_000, netIncome: 48_000 }),
    period(2022, { totalAssets: 3_500_000, totalEquity: 280_000, netIncome: 42_000 }),
  ];
  for (const category of input.ratios) {
    for (const item of category.ratios) {
      if (item.id === 'debtEquity') item.value = 2.6;
      if (item.id === 'currentRatio') item.value = 0.2;
      if (item.id === 'netDebtEbitda') item.value = 8;
      if (item.id === 'roa') item.value = 0.0145;
      if (item.id === 'roe') item.value = 0.177;
    }
  }
  return input;
}

function setRatio(input: ScoreInput, id: string, value: number | null) {
  const item = input.ratios.flatMap((category) => category.ratios).find((entry) => entry.id === id);
  if (!item) throw new Error(`fixture is missing ${id}`);
  item.value = value;
}

describe('SilverNote Score engine', () => {
  const rich = calculateSilverNoteScore(richInput());

  it('produces ten components in a fixed order with weights summing to 100', () => {
    expect(rich.subScores.map((item) => item.key)).toEqual([
      'growth', 'profitability', 'valuation', 'financialHealth', 'momentum', 'earningsQuality', 'competitivePosition', 'efficiency', 'risk', 'futureOutlook',
    ]);
    expect(SUB_SCORES.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    expect(rich.maxScore).toBe(100);
  });

  it('computes the headline as the weighted mean of the components', () => {
    expect(rich.overallScore).toBe(overall(rich.subScores));
    const manual = rich.subScores.reduce((sum, item) => sum + item.score * item.weight, 0) / 100;
    expect(rich.overallScore).toBe(Math.round(manual));
  });

  it('rates a healthy compounder at least "Mixed" with usable confidence', () => {
    expect(rich.overallScore).toBeGreaterThanOrEqual(55);
    expect(['High', 'Medium']).toContain(rich.confidence);
    for (const item of rich.subScores) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(100);
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });

  it('keeps the summaries short and in prose', () => {
    expect(rich.shortSummary.length).toBeLessThanOrEqual(260);
    expect(rich.shortSummary).not.toMatch(/\b\d{1,3}\/100\b/);
    expect(rich.detailedDescription).not.toMatch(/\b\d{1,3}\/100\b/);
    expect(rich.detailedDescription.split('\n\n').length).toBeLessThanOrEqual(4);
  });

  it('penalizes thin data instead of rewarding it', () => {
    const sparse = calculateSilverNoteScore(sparseInput());
    expect(sparse.overallScore).toBeLessThan(rich.overallScore);
    expect(['Low', 'Insufficient']).toContain(sparse.confidence);
    expect(sparse.missingData.length).toBeGreaterThan(rich.missingData.length);
    expect(['Weak', 'Mixed']).toContain(sparse.label);
    expect(sparse.dataQualityScore).toBeLessThan(rich.dataQualityScore);
  });

  it('judges banks on capital and returns rather than industrial leverage tests', () => {
    const bank = calculateSilverNoteScore(bankInput());
    const health = bank.subScores.find((item) => item.key === 'financialHealth');
    expect(health?.score).toBeGreaterThanOrEqual(55);
    // No regulatory capital ratio is supplied, so confidence must stay honest.
    expect(health?.confidence).toBe('Medium');
  });

  it('drops P/E for loss-makers and values them on sales instead', () => {
    const input = richInput();
    setRatio(input, 'pe', -12);
    setRatio(input, 'ps', 12);
    const valuationMetrics = buildMetricGroups(input).valuation;
    const ps = valuationMetrics.find((item) => item.metric.id === 'priceToSales');
    expect(valuationMetrics.some((item) => item.metric.id === 'pe')).toBe(false);
    expect(ps?.metric.rawValue).toBe(12);
    expect(ps?.normalizedScore ?? 1).toBeLessThan(0.6);
    expect(calculateSilverNoteScore(input).subScores.find((item) => item.key === 'valuation')?.score).toBeGreaterThan(0);
  });

  it('promotes P/S to the main valuation weight when P/E is missing, and responds to it', () => {
    const cheap = richInput();
    setRatio(cheap, 'pe', null);
    setRatio(cheap, 'ps', 2);
    const expensive = richInput();
    setRatio(expensive, 'pe', null);
    setRatio(expensive, 'ps', 20);
    const psMetric = buildMetricGroups(cheap).valuation.find((item) => item.metric.id === 'priceToSales');
    expect(psMetric?.metric.weight).toBeCloseTo(METRIC_GROUP_BY_ID.valuation.weight * 0.22, 6);
    const cheapScore = calculateSilverNoteScore(cheap).subScores.find((item) => item.key === 'valuation')?.score ?? 0;
    const expensiveScore = calculateSilverNoteScore(expensive).subScores.find((item) => item.key === 'valuation')?.score ?? 0;
    expect(cheapScore).toBeGreaterThan(expensiveScore);
  });

  it('is deterministic', () => {
    expect(calculateSilverNoteScore(richInput()).overallScore).toBe(rich.overallScore);
  });
});

describe('buildScoreInput', () => {
  it('derives valuation and growth ratios from statements and price', () => {
    const annual = richInput().annual;
    const input = buildScoreInput({
      symbol: 'TST',
      profile: { name: 'Test', industry: 'Software', marketCap: 1_200_000 },
      quote: { currentPrice: 160, marketCap: 1_200_000 },
      annual,
      quarterly: [],
      currency: 'USD',
      candles: candles(),
      metrics: { beta: 1.1 },
    });
    const find = (id: string) => input.ratios.flatMap((category) => category.ratios).find((item) => item.id === id)?.value;
    expect(find('pe')).toBeCloseTo(160 / 8.4, 6);
    expect(find('ps')).toBeCloseTo(1_200_000 / 320_000, 6);
    expect(find('revenueGrowth')).toBeCloseTo(320_000 / 290_000 - 1, 6);
    expect(find('debtEquity')).toBeCloseTo(71_000 / 155_000, 6);
    expect(find('volatility')).toBe(1.1);
    expect(input.metrics.interestCoverage ?? null).toBeNull(); // no interest expense in the fixture
    expect(input.dataQuality.cashFlow).toBe('ok');
  });

  it('converts foreign-currency statements before comparing them with a USD market value', () => {
    const annual = richInput().annual.map((item) => ({ ...item, currency: 'TWD' }));
    const input = buildScoreInput({
      symbol: 'FX',
      profile: { name: 'FX Co', marketCap: 1_200_000 },
      quote: { currentPrice: 100, marketCap: 1_200_000 },
      annual,
      quarterly: [],
      currency: 'TWD',
      fxToUsd: 0.5,
      candles: [],
      metrics: {},
    });
    const ps = input.ratios.flatMap((category) => category.ratios).find((item) => item.id === 'ps')?.value;
    expect(ps).toBeCloseTo(1_200_000 / (320_000 * 0.5), 6);
    // EPS per ordinary share is not comparable to an ADR price, so P/E falls back to market cap / net income.
    const pe = input.ratios.flatMap((category) => category.ratios).find((item) => item.id === 'pe')?.value;
    expect(pe).toBeCloseTo(1_200_000 / (61_000 * 0.5), 6);
  });

  it('caps the headline when the balance sheet is distressed, but only on real evidence', () => {
    const base = [
      { key: 'financialHealth' as const, score: 18, confidence: 'High' as const },
      { key: 'earningsQuality' as const, score: 70, confidence: 'High' as const },
    ];
    expect(applyRedFlags(72, base)).toEqual({ score: 45, flags: [expect.stringContaining('balance sheet')] });
    expect(applyRedFlags(72, [{ ...base[0], confidence: 'Insufficient' as const }, base[1]]).score).toBe(72);
    expect(applyRedFlags(40, base).score).toBe(40);
  });

  it('judges margins on a sector-appropriate scale', () => {
    const grocer = richInput();
    grocer.profile = { ...grocer.profile, sector: 'Consumer Staples', industry: 'Food Retail' };
    const software = richInput();
    software.profile = { ...software.profile, sector: 'Information Technology', industry: 'Software' };
    setRatio(grocer, 'operatingMargin', 0.06);
    setRatio(software, 'operatingMargin', 0.06);
    const op = (input: ScoreInput) => buildMetricGroups(input).profitabilityEfficiency.find((item) => item.metric.id === 'operatingMargin')?.normalizedScore ?? 0;
    expect(sectorBands(grocer).operating[1]).toBeLessThan(sectorBands(software).operating[1]);
    expect(op(grocer)).toBeGreaterThan(op(software));
  });

  it('treats a component with no evidence as unknown, not as zero', () => {
    const input = richInput();
    input.candles = [];
    const metrics = buildMetricGroups(input).marketMomentum.filter((item) => item.metric.sourceField.startsWith('candles'));
    expect(metrics.every((item) => item.normalizedScore === null)).toBe(true);
    expect(componentNormalizedScore(metrics)).toBe(MISSING_DATA_PRIOR);
  });
});

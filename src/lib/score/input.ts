import type { StatementPeriod } from '@/lib/finance/statement-types';

import { cagr, divide, growth, normalizeProviderPercent, toFiniteNumber } from './normalization';
import type { ScoreCandle, ScoreInput, ScoreProfile, ScoreQuote, ScoreRatio, ScoreRatioCategory } from './types';

export type ScoreSourceData = {
  symbol: string;
  companyName?: string;
  profile: ScoreProfile | null;
  quote: ScoreQuote | null;
  annual: StatementPeriod[];
  quarterly: StatementPeriod[];
  /** Reporting currency of the statements. */
  currency: string;
  /** Multiply statement money values by this to express them in USD (1 when already USD). */
  fxToUsd?: number;
  /** Ascending daily candles (timestamp in seconds). */
  candles: ScoreCandle[];
  /** Market metrics (beta, forward P/E, estimates…). */
  metrics: Record<string, number | string | null>;
  hasPeerData?: boolean;
  calculatedAt?: string;
};

const NON_MONEY_KEYS = new Set([
  'sharesDiluted', 'grossMargin', 'operatingMargin', 'ebitdaMargin', 'netMargin', 'fcfMargin', 'fiscalYear', 'fiscalQuarter', 'year',
]);

function toUsd(period: StatementPeriod, fx: number): StatementPeriod {
  if (fx === 1) return period;
  const copy: Record<string, unknown> = { ...period, currency: 'USD' };
  for (const [key, value] of Object.entries(period)) {
    if (typeof value === 'number' && !NON_MONEY_KEYS.has(key)) copy[key] = value * fx;
  }
  return copy as StatementPeriod;
}

function first(...values: Array<number | null | undefined>) {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? null;
}

function metric(metrics: Record<string, number | string | null>, keys: string[]) {
  for (const key of keys) {
    const value = toFiniteNumber(metrics[key]);
    if (value !== null) return value;
  }
  return null;
}

function movingAverage(candles: ScoreCandle[], periods: number) {
  const closes = candles.map((candle) => candle.close).filter((value) => Number.isFinite(value) && value > 0).slice(-periods);
  if (closes.length < Math.min(periods, 20)) return null;
  return closes.reduce((sum, value) => sum + value, 0) / closes.length;
}

function lastYear(candles: ScoreCandle[]) {
  if (!candles.length) return candles;
  const cutoff = candles[candles.length - 1].timestamp - 365 * 86_400;
  return candles.filter((candle) => candle.timestamp >= cutoff);
}

/** Standard Altman Z for non-financial companies; null unless every input exists. */
export function altmanZ(latest: StatementPeriod, marketCap: number | null) {
  const { currentAssets, currentLiabilities, retainedEarnings, ebit, totalAssets, totalLiabilities, revenue } = latest;
  if ([currentAssets, currentLiabilities, retainedEarnings, ebit, totalAssets, totalLiabilities, revenue, marketCap].some((value) => value == null)) {
    return null;
  }
  if (!totalAssets || !totalLiabilities) return null;
  const z =
    1.2 * (((currentAssets as number) - (currentLiabilities as number)) / totalAssets) +
    1.4 * ((retainedEarnings as number) / totalAssets) +
    3.3 * ((ebit as number) / totalAssets) +
    0.6 * ((marketCap as number) / totalLiabilities) +
    1.0 * ((revenue as number) / totalAssets);
  return Number.isFinite(z) ? z : null;
}

export function buildScoreInput(source: ScoreSourceData): ScoreInput {
  const fx = source.fxToUsd ?? 1;
  const annual = source.annual.map((period) => toUsd(period, fx));
  const quarterly = source.quarterly.map((period) => toUsd(period, fx));
  const base = annual[0] ?? quarterly[0] ?? null;
  const price = source.quote?.currentPrice ?? null;
  const marketCap = first(
    source.profile?.marketCap,
    source.quote?.marketCap,
    price !== null && source.profile?.sharesOutstanding ? price * source.profile.sharesOutstanding : null,
  );

  const latest: StatementPeriod = base
    ? { ...base }
    : ({ key: 'none', period: 'Latest', fiscalYear: 0, fiscalQuarter: null, periodStart: null, periodEnd: '', label: '', currency: 'USD', filed: null, form: null, fiscalDate: '', year: 0 } as StatementPeriod);
  latest.freeCashFlow = first(
    latest.freeCashFlow,
    latest.operatingCashFlow != null && latest.capex != null ? latest.operatingCashFlow - Math.abs(latest.capex) : null,
  );
  latest.ebitda = first(latest.ebitda, latest.ebit != null && latest.depreciationAmortization != null ? latest.ebit + latest.depreciationAmortization : null);
  // Per-share figures only line up with the quoted price for US-dollar filers (ADRs bundle several shares).
  const perShareComparable = source.currency === 'USD';
  latest.epsDiluted = first(latest.epsDiluted, price !== null ? divide(price, metric(source.metrics, ['peTTM'])) : null);

  const metrics: Record<string, number | string | null> = { ...source.metrics };
  if (metric(metrics, ['interestCoverage']) === null && latest.ebit != null && latest.interestExpense && latest.interestExpense > 0) {
    metrics.interestCoverage = latest.ebit / latest.interestExpense;
  }
  const isFinancial = /\b(bank|banks|banking|insurance|thrift|savings)\b/i.test(`${source.profile?.industry ?? ''} ${source.profile?.sector ?? ''}`);
  if (metric(metrics, ['altmanZScore']) === null && !isFinancial) {
    const z = altmanZ(latest, marketCap);
    if (z !== null) metrics.altmanZScore = z;
  }

  const ratios = buildRatios({ annual, latest, marketCap, price, candles: source.candles, metrics, perShareComparable });
  const hasAny = (key: keyof StatementPeriod) => annual.some((period) => period[key] != null);

  return {
    symbol: source.symbol,
    companyName: source.companyName ?? source.profile?.name ?? source.symbol,
    calculatedAt: source.calculatedAt ?? new Date().toISOString(),
    candles: source.candles,
    quote: source.quote ? { ...source.quote, marketCap } : null,
    profile: source.profile ? { ...source.profile, marketCap } : { marketCap },
    metrics,
    latest,
    annual,
    quarterly,
    ratios,
    dataQuality: {
      hasBasic: Boolean(source.profile?.name) || price !== null,
      hasMetrics: Object.keys(metrics).length > 0,
      hasFinancials: annual.length > 0,
      incomeStatement: hasAny('revenue') || hasAny('netIncome') ? 'ok' : 'unavailable',
      balanceSheet: hasAny('totalAssets') ? 'ok' : 'unavailable',
      cashFlow: hasAny('operatingCashFlow') ? 'ok' : 'unavailable',
      hasPeerData: source.hasPeerData ?? false,
    },
  };
}

function buildRatios(input: {
  annual: StatementPeriod[];
  latest: StatementPeriod;
  marketCap: number | null;
  price: number | null;
  candles: ScoreCandle[];
  metrics: Record<string, number | string | null>;
  perShareComparable: boolean;
}): ScoreRatioCategory[] {
  const { latest, marketCap, price, metrics } = input;
  const previous = input.annual[1] ?? null;
  const revenue = latest.revenue ?? null;
  const netIncome = latest.netIncome ?? null;
  const equity = latest.totalEquity ?? null;
  const totalDebt = latest.totalDebt ?? null;
  const cash = latest.cash ?? null;
  const fcf = latest.freeCashFlow ?? null;
  const ebitda = latest.ebitda ?? null;
  const eps = input.perShareComparable ? latest.epsDiluted ?? null : null;
  const enterpriseValue = marketCap !== null ? marketCap + (totalDebt ?? 0) - (cash ?? 0) : null;
  const yearOfCandles = lastYear(input.candles);
  const high52 = first(metric(metrics, ['52WeekHigh']), yearOfCandles.length ? Math.max(...yearOfCandles.map((candle) => candle.high).filter((value) => value > 0)) : null);
  const low52 = first(metric(metrics, ['52WeekLow']), yearOfCandles.length ? Math.min(...yearOfCandles.map((candle) => candle.low).filter((value) => value > 0)) : null);
  const sma50 = first(metric(metrics, ['50DayMovingAverage', 'sma50']), movingAverage(input.candles, 50));
  const sma200 = first(metric(metrics, ['200DayMovingAverage', 'sma200']), movingAverage(input.candles, 200));
  const r = (category: ScoreRatio['category'], id: string, name: string, value: number | null, kind: ScoreRatio['kind']): ScoreRatio => ({
    category,
    id,
    name,
    kind,
    value: typeof value === 'number' && Number.isFinite(value) ? value : null,
  });
  const pct = (keys: string[]) => normalizeProviderPercent(metric(metrics, keys));

  return [
    {
      key: 'valuation',
      title: 'Valuation',
      ratios: [
        r('valuation', 'pe', 'P/E', first(metric(metrics, ['peTTM']), divide(price, eps), divide(marketCap, netIncome)), 'multiple'),
        r('valuation', 'ps', 'P/S', first(metric(metrics, ['psTTM']), divide(marketCap, revenue)), 'multiple'),
        r('valuation', 'pb', 'P/B', first(metric(metrics, ['pbAnnual']), divide(marketCap, equity)), 'multiple'),
        r('valuation', 'pfcf', 'P/FCF', divide(marketCap, fcf), 'multiple'),
        r('valuation', 'evEbitda', 'EV/EBITDA', first(metric(metrics, ['evToEbitda']), divide(enterpriseValue, ebitda)), 'multiple'),
        r('valuation', 'fcfYield', 'FCF yield', divide(fcf, marketCap), 'percent'),
        r('valuation', 'earningsYield', 'Earnings yield', first(divide(eps, price), divide(netIncome, marketCap)), 'percent'),
      ],
    },
    {
      key: 'profitability',
      title: 'Profitability',
      ratios: [
        r('profitability', 'grossMargin', 'Gross margin', first(pct(['grossMarginTTM']), divide(latest.grossProfit, revenue)), 'percent'),
        r('profitability', 'operatingMargin', 'Operating margin', first(pct(['operatingMarginTTM']), divide(latest.operatingIncome, revenue)), 'percent'),
        r('profitability', 'ebitdaMargin', 'EBITDA margin', divide(ebitda, revenue), 'percent'),
        r('profitability', 'netMargin', 'Net margin', first(pct(['netProfitMarginTTM']), divide(netIncome, revenue)), 'percent'),
        r('profitability', 'roe', 'ROE', first(pct(['roeTTM']), divide(netIncome, equity)), 'percent'),
        r('profitability', 'roa', 'ROA', first(pct(['roaTTM']), divide(netIncome, latest.totalAssets)), 'percent'),
      ],
    },
    {
      key: 'growth',
      title: 'Growth',
      ratios: [
        r('growth', 'revenueGrowth', 'Revenue growth', first(pct(['revenueGrowthTTMYoy']), growth(revenue, previous?.revenue)), 'percent'),
        r('growth', 'epsGrowth', 'EPS growth', first(pct(['epsGrowthTTMYoy']), growth(latest.epsDiluted, previous?.epsDiluted)), 'percent'),
        r('growth', 'fcfGrowth', 'FCF growth', growth(fcf, previous?.freeCashFlow), 'percent'),
        r('growth', 'revenueCagr3y', 'Revenue CAGR 3Y', cagr(input.annual.map((period) => period.revenue), 3), 'percent'),
      ],
    },
    {
      key: 'financialHealth',
      title: 'Financial health',
      ratios: [
        r('financialHealth', 'debtEquity', 'Debt / equity', divide(totalDebt, equity), 'multiple'),
        r('financialHealth', 'currentRatio', 'Current ratio', first(metric(metrics, ['currentRatioAnnual']), divide(latest.currentAssets, latest.currentLiabilities)), 'multiple'),
        r('financialHealth', 'netDebtEbitda', 'Net debt / EBITDA', divide(totalDebt !== null && cash !== null ? totalDebt - cash : null, ebitda), 'multiple'),
      ],
    },
    {
      key: 'cashFlow',
      title: 'Cash flow',
      ratios: [
        r('cashFlow', 'fcfMargin', 'FCF margin', divide(fcf, revenue), 'percent'),
        r('cashFlow', 'fcfConversion', 'FCF conversion', divide(fcf, netIncome), 'percent'),
      ],
    },
    {
      key: 'technicals',
      title: 'Technicals',
      ratios: [
        r('technicals', 'sma50', 'SMA 50', sma50, 'currency'),
        r('technicals', 'sma200', 'SMA 200', sma200, 'currency'),
        r('technicals', 'priceVsHigh', 'Price vs 52W high', high52 && price !== null ? (price - high52) / high52 : null, 'percent'),
        r('technicals', 'priceVsLow', 'Price vs 52W low', low52 && price !== null ? (price - low52) / low52 : null, 'percent'),
        r('technicals', 'volatility', 'Beta', metric(metrics, ['beta']), 'number'),
      ],
    },
  ];
}

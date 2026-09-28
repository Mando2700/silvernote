import 'server-only';

import { normalizeSymbol } from '@/lib/data/eligibility';
import { fetchJson, limiters, memo, ProviderError, takeDailyBudget } from '@/lib/data/http';
import type { Candle, NewsItem } from '@/lib/data/types';
import { env } from '@/lib/env';
import { finalizePeriod } from '@/lib/finance/sec-standardize';
import type { StatementPeriod } from '@/lib/finance/statement-types';

/**
 * Financial Modeling Prep, stable API. Free plan: 250 calls/day, US equities, 5 years annual,
 * 8 quarters. Calls are budgeted per day and premium-only endpoints are remembered so they
 * are not retried.
 */

const BASE = 'https://financialmodelingprep.com/stable';
const DAILY_BUDGET = 240;
const blocked = new Map<string, number>();

export function fmpEnabled() {
  return Boolean(env.fmpKey);
}

async function get<T>(path: string, params: Record<string, string>) {
  if (!env.fmpKey) throw new ProviderError('fmp', 0, 'FMP_API_KEY is not set');
  const blockedUntil = blocked.get(path);
  if (blockedUntil && blockedUntil > Date.now()) throw new ProviderError('fmp', 402, `${path} is not included in this plan`);
  if (!(await takeDailyBudget('fmp', DAILY_BUDGET))) throw new ProviderError('fmp', 429, 'daily call budget used up');
  const query = new URLSearchParams({ ...params, apikey: env.fmpKey }).toString();
  try {
    return await fetchJson<T>(`${BASE}${path}?${query}`, { provider: 'fmp', limiter: limiters.fmp, retries: 1 });
  } catch (error) {
    if (error instanceof ProviderError && (error.status === 402 || error.status === 403)) {
      blocked.set(path, Date.now() + 12 * 3_600_000);
    }
    throw error;
  }
}

type FmpProfile = {
  symbol: string;
  companyName: string;
  marketCap?: number;
  beta?: number;
  currency?: string;
  cik?: string;
  exchange?: string;
  industry?: string;
  sector?: string;
  website?: string;
  description?: string;
  ceo?: string;
  country?: string;
  fullTimeEmployees?: string | number;
  ipoDate?: string;
  image?: string;
};

export async function fetchProfile(symbol: string) {
  const rows = await get<FmpProfile[]>('/profile', { symbol: symbol.replace('.', '-') });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

type Row = Record<string, number | string | null>;

function n(row: Row | undefined, key: string): number | null {
  const value = row?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const negative = (value: number | null) => (value === null ? null : -Math.abs(value));

function mapPeriod(income: Row | undefined, balance: Row | undefined, cash: Row | undefined): StatementPeriod | null {
  const anchor = income ?? balance ?? cash;
  if (!anchor) return null;
  const end = String(anchor.date ?? '');
  const fiscalYear = Number(anchor.fiscalYear ?? end.slice(0, 4));
  const periodName = String(anchor.period ?? 'FY');
  const quarter = /^Q[1-4]$/.test(periodName) ? Number(periodName.slice(1)) : null;
  const period: StatementPeriod = {
    key: quarter ? `FY${fiscalYear}-Q${quarter}` : `FY${fiscalYear}`,
    period: quarter ? `Q${quarter}` : 'FY',
    fiscalYear,
    fiscalQuarter: quarter,
    periodStart: null,
    periodEnd: end,
    label: quarter ? `Q${quarter} FY${String(fiscalYear).slice(-2)}` : `FY${String(fiscalYear).slice(-2)}`,
    currency: String(anchor.reportedCurrency ?? 'USD'),
    filed: anchor.filingDate ? String(anchor.filingDate) : null,
    form: quarter ? '10-Q' : '10-K',
    fiscalDate: end,
    year: fiscalYear,
    revenue: n(income, 'revenue'),
    costOfRevenue: n(income, 'costOfRevenue'),
    grossProfit: n(income, 'grossProfit'),
    researchAndDevelopment: n(income, 'researchAndDevelopmentExpenses'),
    sellingGeneralAdministrative: n(income, 'sellingGeneralAndAdministrativeExpenses'),
    totalOperatingExpenses: n(income, 'operatingExpenses'),
    operatingIncome: n(income, 'operatingIncome'),
    interestExpense: n(income, 'interestExpense'),
    pretaxIncome: n(income, 'incomeBeforeTax'),
    taxExpense: n(income, 'incomeTaxExpense'),
    netIncome: n(income, 'netIncome'),
    epsBasic: n(income, 'eps'),
    epsDiluted: n(income, 'epsDiluted'),
    sharesDiluted: n(income, 'weightedAverageShsOutDil'),
    cash: n(balance, 'cashAndCashEquivalents'),
    shortTermInvestments: n(balance, 'shortTermInvestments'),
    receivables: n(balance, 'netReceivables'),
    inventory: n(balance, 'inventory'),
    otherCurrentAssets: n(balance, 'otherCurrentAssets'),
    currentAssets: n(balance, 'totalCurrentAssets'),
    propertyPlantEquipment: n(balance, 'propertyPlantEquipmentNet'),
    goodwill: n(balance, 'goodwill'),
    intangibleAssets: n(balance, 'intangibleAssets'),
    longTermInvestments: n(balance, 'longTermInvestments'),
    otherNonCurrentAssets: n(balance, 'otherNonCurrentAssets'),
    totalAssets: n(balance, 'totalAssets'),
    accountsPayable: n(balance, 'accountPayables'),
    accruedLiabilities: n(balance, 'accruedExpenses'),
    deferredRevenue: n(balance, 'deferredRevenue'),
    shortTermDebt: n(balance, 'shortTermDebt'),
    currentLiabilities: n(balance, 'totalCurrentLiabilities'),
    longTermDebt: n(balance, 'longTermDebt'),
    totalLiabilities: n(balance, 'totalLiabilities'),
    retainedEarnings: n(balance, 'retainedEarnings'),
    treasuryStock: n(balance, 'treasuryStock'),
    accumulatedOci: n(balance, 'accumulatedOtherComprehensiveIncomeLoss'),
    totalEquity: n(balance, 'totalStockholdersEquity'),
    minorityInterest: n(balance, 'minorityInterest'),
    preferredStock: n(balance, 'preferredStock'),
    leaseLiabilities: n(balance, 'capitalLeaseObligations'),
    totalDebt: n(balance, 'totalDebt'),
    depreciationAmortization: n(cash, 'depreciationAndAmortization'),
    stockBasedCompensation: n(cash, 'stockBasedCompensation'),
    deferredTaxes: n(cash, 'deferredIncomeTax'),
    changeInReceivables: n(cash, 'accountsReceivables'),
    changeInInventory: n(cash, 'inventory'),
    changeInPayables: n(cash, 'accountsPayables'),
    operatingCashFlow: n(cash, 'netCashProvidedByOperatingActivities'),
    capex: negative(n(cash, 'capitalExpenditure')),
    acquisitions: n(cash, 'acquisitionsNet'),
    purchasesOfInvestments: n(cash, 'purchasesOfInvestments'),
    salesOfInvestments: n(cash, 'salesMaturitiesOfInvestments'),
    investingCashFlow: n(cash, 'netCashProvidedByInvestingActivities'),
    dividendsPaid: n(cash, 'commonDividendsPaid') ?? n(cash, 'netDividendsPaid'),
    buybacks: n(cash, 'commonStockRepurchased'),
    stockIssued: n(cash, 'commonStockIssuance'),
    financingCashFlow: n(cash, 'netCashProvidedByFinancingActivities'),
    fxEffect: n(cash, 'effectOfForexChangesOnCash'),
    netChangeInCash: n(cash, 'netChangeInCash'),
    interestPaid: n(cash, 'interestPaid'),
    taxesPaid: n(cash, 'incomeTaxesPaid'),
  };
  return finalizePeriod(period);
}

async function statementSet(symbol: string, period: 'annual' | 'quarter', limit: number) {
  const params = { symbol: symbol.replace('.', '-'), period, limit: String(limit) };
  const [income, balance, cash] = await Promise.all([
    get<Row[]>('/income-statement', params),
    get<Row[]>('/balance-sheet-statement', params),
    get<Row[]>('/cash-flow-statement', params),
  ]);
  const byDate = (rows: Row[]) => new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.date), row]));
  const balanceByDate = byDate(balance);
  const cashByDate = byDate(cash);
  return (Array.isArray(income) ? income : [])
    .map((row) => mapPeriod(row, balanceByDate.get(String(row.date)), cashByDate.get(String(row.date))))
    .filter((row): row is StatementPeriod => Boolean(row))
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

export async function fetchStatements(symbol: string) {
  const annual = await statementSet(symbol, 'annual', 5);
  const quarterly = await statementSet(symbol, 'quarter', 8).catch(() => []);
  return { annual, quarterly, currency: annual[0]?.currency ?? 'USD' };
}

export async function fetchDailyHistory(symbol: string, from: string): Promise<Candle[]> {
  const rows = await get<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>(
    '/historical-price-eod/full',
    { symbol: symbol.replace('.', '-'), from },
  );
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ t: Math.floor(Date.parse(`${row.date}T00:00:00Z`) / 1000), o: row.open, h: row.high, l: row.low, c: row.close, v: row.volume ?? null }))
    .filter((candle) => Number.isFinite(candle.t) && candle.c > 0)
    .sort((a, b) => a.t - b.t);
}

export async function fetchNews(symbols: string[]): Promise<NewsItem[]> {
  return memo(`fmp:news:${symbols.join(',')}`, 10 * 60_000, async () => {
    const rows = await get<Array<{ symbol: string; publishedDate: string; publisher: string; title: string; image: string; site: string; text: string; url: string }>>(
      '/news/stock',
      { symbols: symbols.map((symbol) => symbol.replace('.', '-')).join(','), limit: '50' },
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: `fmp:${row.url}`,
      title: row.title,
      url: row.url,
      source: row.publisher || row.site || 'FMP',
      publishedAt: new Date(Date.parse(`${row.publishedDate.replace(' ', 'T')}Z`) || Date.now()).toISOString(),
      summary: row.text?.slice(0, 500),
      symbols: row.symbol ? [normalizeSymbol(row.symbol)] : [],
      image: row.image || null,
      provider: 'fmp' as const,
    }));
  });
}

type FmpEstimate = { date: string; revenueAvg?: number; revenueLow?: number; revenueHigh?: number; ebitAvg?: number; ebitdaAvg?: number; netIncomeAvg?: number; epsAvg?: number; numAnalystsRevenue?: number };

/** Annual consensus revenue, EBIT and EPS estimates by fiscal year end, oldest first. */
export async function fetchAnalystEstimates(symbol: string) {
  const rows = await get<FmpEstimate[]>('/analyst-estimates', { symbol: symbol.replace('.', '-'), period: 'annual', page: '0', limit: '10' });
  // Past fiscal years are kept: a year that has ended but isn't filed yet is still a forecast. Callers drop reported years.
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.date === 'string' && row.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      fiscalEnd: row.date,
      revenue: row.revenueAvg ?? null,
      revenueLow: row.revenueLow ?? null,
      revenueHigh: row.revenueHigh ?? null,
      ebit: row.ebitAvg ?? null,
      ebitda: row.ebitdaAvg ?? null,
      netIncome: row.netIncomeAvg ?? null,
      eps: row.epsAvg ?? null,
      analysts: row.numAnalystsRevenue ?? null,
    }));
}

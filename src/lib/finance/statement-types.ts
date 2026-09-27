/** Standardized line items shared by every statement source (SEC XBRL, FMP, frames). */
export const INCOME_ITEMS = [
  'revenue',
  'costOfRevenue',
  'grossProfit',
  'researchAndDevelopment',
  'sellingGeneralAdministrative',
  'totalOperatingExpenses',
  'operatingIncome',
  'interestExpense',
  'pretaxIncome',
  'taxExpense',
  'netIncome',
  'epsBasic',
  'epsDiluted',
  'sharesDiluted',
  'ebit',
  'ebitda',
  // banks
  'totalInterestIncome',
  'netInterestIncome',
  'nonInterestIncome',
  'provisionForCreditLosses',
  'nonInterestExpense',
] as const;

export const BALANCE_ITEMS = [
  'cash',
  'shortTermInvestments',
  'receivables',
  'inventory',
  'otherCurrentAssets',
  'currentAssets',
  'propertyPlantEquipment',
  'goodwill',
  'intangibleAssets',
  'longTermInvestments',
  'otherNonCurrentAssets',
  'nonCurrentAssets',
  'totalAssets',
  'accountsPayable',
  'accruedLiabilities',
  'deferredRevenue',
  'shortTermDebt',
  'currentLiabilities',
  'longTermDebt',
  'nonCurrentLiabilities',
  'totalLiabilities',
  'commonStockAndApic',
  'retainedEarnings',
  'treasuryStock',
  'accumulatedOci',
  'totalEquity',
  'minorityInterest',
  'preferredStock',
  'leaseLiabilities',
  'totalDebt',
  'netDebt',
  // banks
  'loans',
  'deposits',
] as const;

export const CASH_FLOW_ITEMS = [
  'depreciationAmortization',
  'stockBasedCompensation',
  'deferredTaxes',
  'changeInReceivables',
  'changeInInventory',
  'changeInPayables',
  'operatingCashFlow',
  'capex',
  'acquisitions',
  'purchasesOfInvestments',
  'salesOfInvestments',
  'investingCashFlow',
  'dividendsPaid',
  'buybacks',
  'stockIssued',
  'debtIssued',
  'debtRepaid',
  'financingCashFlow',
  'fxEffect',
  'netChangeInCash',
  'freeCashFlow',
  'interestPaid',
  'taxesPaid',
] as const;

export const RATIO_ITEMS = ['grossMargin', 'operatingMargin', 'ebitdaMargin', 'netMargin', 'fcfMargin'] as const;

export type IncomeItem = (typeof INCOME_ITEMS)[number];
export type BalanceItem = (typeof BALANCE_ITEMS)[number];
export type CashFlowItem = (typeof CASH_FLOW_ITEMS)[number];
export type RatioItem = (typeof RATIO_ITEMS)[number];
export type LineItemKey = IncomeItem | BalanceItem | CashFlowItem | RatioItem;

export type StatementKind = 'income' | 'balance' | 'cashflow';
export type Frequency = 'annual' | 'quarterly';

export type StatementPeriod = {
  /** Stable key, e.g. "FY2025" or "FY2026-Q2". */
  key: string;
  /** "FY" | "Q1" | "Q2" | "Q3" | "Q4" | "TTM" */
  period: string;
  fiscalYear: number;
  fiscalQuarter: number | null;
  periodStart: string | null;
  periodEnd: string;
  /** Short display label: "FY25", "Q2 FY26". */
  label: string;
  currency: string;
  filed: string | null;
  form: string | null;
  /** Items derived by subtraction (e.g. Q4 = FY − 9M) rather than reported directly. */
  derived?: string[];
  // Aliases the score engine reads.
  fiscalDate: string;
  year: number;
} & Partial<Record<LineItemKey, number | null>>;

export type StandardizedStatements = {
  symbol: string;
  entityName: string;
  cik: string | null;
  source: 'sec' | 'fmp' | 'sec-frames';
  currency: string;
  taxonomy: 'us-gaap' | 'ifrs-full' | 'fmp';
  fiscalYearEndMonth: number | null;
  annual: StatementPeriod[];
  quarterly: StatementPeriod[];
  ttm: StatementPeriod | null;
  sharesOutstanding: { value: number; asOf: string } | null;
  fetchedAt: string;
};

export function periodValue(period: StatementPeriod | null | undefined, key: LineItemKey): number | null {
  const value = period?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

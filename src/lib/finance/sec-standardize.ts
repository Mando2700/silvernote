import type { LineItemKey, StandardizedStatements, StatementPeriod } from './statement-types';

/**
 * Turns SEC XBRL "companyfacts" into standardized annual, quarterly and TTM statements.
 *
 * - Each line item tries a priority list of XBRL tags per period (companies switch tags over time).
 * - Restated values win: for the same period the most recently filed fact is used.
 * - 10-Qs often report cash flows year-to-date only, and Q4 is never filed on its own, so missing
 *   quarters are derived (Q2 = 6M − Q1, Q3 = 9M − 6M, Q4 = FY − 9M) and flagged in `derived`.
 */

export type XbrlFact = {
  start?: string;
  end: string;
  val: number;
  accn?: string;
  fy?: number | null;
  fp?: string | null;
  form?: string;
  filed?: string;
  frame?: string;
};

export type CompanyFactsPayload = {
  cik: number | string;
  entityName: string;
  facts: Record<string, Record<string, { label?: string; units: Record<string, XbrlFact[]> }>>;
};

type UnitKind = 'money' | 'perShare' | 'shares';
type HelperKey = `_${string}`;
type SpecKey = LineItemKey | HelperKey;
type Spec = { key: SpecKey; kind: 'duration' | 'instant'; unit?: UnitKind; tags: string[]; sign?: 1 | -1 };

const d = (key: SpecKey, tags: string[], sign: 1 | -1 = 1, unit: UnitKind = 'money'): Spec => ({
  key,
  kind: 'duration',
  unit,
  tags,
  sign,
});
const i = (key: SpecKey, tags: string[], unit: UnitKind = 'money'): Spec => ({ key, kind: 'instant', unit, tags });
const gaap = (...tags: string[]) => tags.map((tag) => `us-gaap:${tag}`);
const ifrs = (...tags: string[]) => tags.map((tag) => `ifrs-full:${tag}`);

const GAAP_SPECS: Spec[] = [
  // Income statement
  d('revenue', gaap(
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
    'RevenuesNetOfInterestExpense',
    'SalesRevenueGoodsNet',
    'SalesRevenueServicesNet',
    'RegulatedAndUnregulatedOperatingRevenue',
    'TotalRevenuesAndOtherIncome',
    'OperatingLeasesIncomeStatementLeaseRevenue',
  )),
  d('costOfRevenue', gaap(
    'CostOfRevenue',
    'CostOfGoodsAndServicesSold',
    'CostOfGoodsSold',
    'CostOfServices',
    'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization',
  )),
  d('grossProfit', gaap('GrossProfit')),
  d('researchAndDevelopment', gaap('ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost')),
  d('sellingGeneralAdministrative', gaap('SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense')),
  d('totalOperatingExpenses', gaap('OperatingExpenses')),
  d('operatingIncome', gaap('OperatingIncomeLoss')),
  d('interestExpense', gaap('InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'InterestAndDebtExpense')),
  d('pretaxIncome', gaap(
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic',
  )),
  d('taxExpense', gaap('IncomeTaxExpenseBenefit')),
  d('netIncome', gaap('NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss')),
  d('epsBasic', gaap('EarningsPerShareBasic', 'EarningsPerShareBasicAndDiluted'), 1, 'perShare'),
  d('epsDiluted', gaap('EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'), 1, 'perShare'),
  d('sharesDiluted', gaap('WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'), 1, 'shares'),
  // Banks
  d('totalInterestIncome', gaap('InterestAndDividendIncomeOperating', 'InterestIncomeOperating')),
  d('netInterestIncome', gaap('InterestIncomeExpenseNet', 'InterestIncomeExpenseOperatingNet')),
  d('nonInterestIncome', gaap('NoninterestIncome')),
  d('provisionForCreditLosses', gaap('ProvisionForLoanLeaseAndOtherLosses', 'ProvisionForLoanAndLeaseLosses', 'ProvisionForCreditLossesNet')),
  d('nonInterestExpense', gaap('NoninterestExpense')),
  // Balance sheet
  i('cash', gaap('CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash', 'CashAndDueFromBanks')),
  i('shortTermInvestments', gaap('ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent')),
  i('receivables', gaap('AccountsReceivableNetCurrent', 'ReceivablesNetCurrent')),
  i('inventory', gaap('InventoryNet')),
  i('otherCurrentAssets', gaap('OtherAssetsCurrent', 'PrepaidExpenseAndOtherAssetsCurrent')),
  i('currentAssets', gaap('AssetsCurrent')),
  i('propertyPlantEquipment', gaap(
    'PropertyPlantAndEquipmentNet',
    'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization',
  )),
  i('goodwill', gaap('Goodwill')),
  i('intangibleAssets', gaap('IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet')),
  i('longTermInvestments', gaap('LongTermInvestments', 'MarketableSecuritiesNoncurrent', 'AvailableForSaleSecuritiesDebtSecuritiesNoncurrent')),
  i('otherNonCurrentAssets', gaap('OtherAssetsNoncurrent')),
  i('totalAssets', gaap('Assets')),
  i('accountsPayable', gaap('AccountsPayableCurrent', 'AccountsPayableAndAccruedLiabilitiesCurrent')),
  i('accruedLiabilities', gaap('AccruedLiabilitiesCurrent')),
  i('deferredRevenue', gaap('ContractWithCustomerLiabilityCurrent', 'DeferredRevenueCurrent')),
  i('_debtCurrent', gaap('DebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent')),
  i('_ltdCurrent', gaap('LongTermDebtCurrent')),
  i('_shortBorrowings', gaap('ShortTermBorrowings')),
  i('_commercialPaper', gaap('CommercialPaper')),
  i('currentLiabilities', gaap('LiabilitiesCurrent')),
  i('longTermDebt', gaap('LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations')),
  i('_longTermDebtTotal', gaap('LongTermDebt', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities', 'DebtAndCapitalLeaseObligations')),
  i('totalLiabilities', gaap('Liabilities')),
  i('_liabilitiesAndEquity', gaap('LiabilitiesAndStockholdersEquity')),
  i('commonStockAndApic', gaap('CommonStocksIncludingAdditionalPaidInCapital')),
  i('_commonStock', gaap('CommonStockValue')),
  i('_apic', gaap('AdditionalPaidInCapital', 'AdditionalPaidInCapitalCommonStock')),
  i('retainedEarnings', gaap('RetainedEarningsAccumulatedDeficit')),
  i('treasuryStock', gaap('TreasuryStockValue', 'TreasuryStockCommonValue')),
  i('accumulatedOci', gaap('AccumulatedOtherComprehensiveIncomeLossNetOfTax')),
  i('totalEquity', gaap('StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest')),
  i('_equityInclNci', gaap('StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest')),
  i('minorityInterest', gaap('MinorityInterest')),
  i('preferredStock', gaap('PreferredStockValue', 'PreferredStockValueOutstanding', 'PreferredStockIncludingAdditionalPaidInCapital')),
  i('_redeemablePreferred', gaap('TemporaryEquityCarryingAmountAttributableToParent', 'RedeemablePreferredStockCarryingAmount')),
  i('_operatingLeaseTotal', gaap('OperatingLeaseLiability')),
  i('_operatingLeaseCurrent', gaap('OperatingLeaseLiabilityCurrent')),
  i('_operatingLeaseNoncurrent', gaap('OperatingLeaseLiabilityNoncurrent')),
  i('_financeLeaseTotal', gaap('FinanceLeaseLiability')),
  i('_financeLeaseCurrent', gaap('FinanceLeaseLiabilityCurrent')),
  i('_financeLeaseNoncurrent', gaap('FinanceLeaseLiabilityNoncurrent')),
  i('loans', gaap('LoansAndLeasesReceivableNetReportedAmount', 'FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss')),
  i('deposits', gaap('Deposits')),
  // Cash flow statement (outflows stored as negative numbers)
  d('depreciationAmortization', gaap(
    'DepreciationDepletionAndAmortization',
    'DepreciationAndAmortization',
    'DepreciationAmortizationAndAccretionNet',
    'Depreciation',
  )),
  d('stockBasedCompensation', gaap('ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense')),
  d('deferredTaxes', gaap('DeferredIncomeTaxExpenseBenefit')),
  d('changeInReceivables', gaap('IncreaseDecreaseInAccountsReceivable', 'IncreaseDecreaseInReceivables'), -1),
  d('changeInInventory', gaap('IncreaseDecreaseInInventories'), -1),
  d('changeInPayables', gaap('IncreaseDecreaseInAccountsPayable', 'IncreaseDecreaseInAccountsPayableAndAccruedLiabilities')),
  d('operatingCashFlow', gaap('NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations')),
  d('capex', gaap('PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements', 'PaymentsToAcquireOtherPropertyPlantAndEquipment', 'PaymentsToAcquireOtherProductiveAssets'), -1),
  d('acquisitions', gaap('PaymentsToAcquireBusinessesNetOfCashAcquired'), -1),
  d('purchasesOfInvestments', gaap('PaymentsToAcquireInvestments', 'PaymentsToAcquireAvailableForSaleSecuritiesDebt', 'PaymentsToAcquireMarketableSecurities'), -1),
  d('salesOfInvestments', gaap(
    'ProceedsFromSaleMaturityAndCollectionsOfInvestments',
    'ProceedsFromMaturitiesPrepaymentsAndCallsOfAvailableForSaleSecurities',
    'ProceedsFromSaleOfAvailableForSaleSecuritiesDebt',
  )),
  d('investingCashFlow', gaap('NetCashProvidedByUsedInInvestingActivities', 'NetCashProvidedByUsedInInvestingActivitiesContinuingOperations')),
  d('dividendsPaid', gaap('PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'), -1),
  d('buybacks', gaap('PaymentsForRepurchaseOfCommonStock'), -1),
  d('stockIssued', gaap('ProceedsFromIssuanceOfCommonStock', 'ProceedsFromStockOptionsExercised')),
  d('debtIssued', gaap('ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromIssuanceOfDebt', 'ProceedsFromIssuanceOfSeniorLongTermDebt')),
  d('debtRepaid', gaap('RepaymentsOfLongTermDebt', 'RepaymentsOfDebt', 'RepaymentsOfSeniorDebt'), -1),
  d('financingCashFlow', gaap('NetCashProvidedByUsedInFinancingActivities', 'NetCashProvidedByUsedInFinancingActivitiesContinuingOperations')),
  d('fxEffect', gaap(
    'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    'EffectOfExchangeRateOnCashAndCashEquivalents',
  )),
  d('netChangeInCash', gaap(
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
    'CashAndCashEquivalentsPeriodIncreaseDecrease',
  )),
  d('interestPaid', gaap('InterestPaidNet', 'InterestPaid')),
  d('taxesPaid', gaap('IncomeTaxesPaidNet', 'IncomeTaxesPaid')),
];

const IFRS_SPECS: Spec[] = [
  d('revenue', ifrs('Revenue', 'RevenueFromContractsWithCustomers')),
  d('costOfRevenue', ifrs('CostOfSales')),
  d('grossProfit', ifrs('GrossProfit')),
  d('researchAndDevelopment', ifrs('ResearchAndDevelopmentExpense')),
  d('sellingGeneralAdministrative', ifrs('SellingGeneralAndAdministrativeExpense', 'AdministrativeExpense')),
  d('operatingIncome', ifrs('ProfitLossFromOperatingActivities')),
  d('interestExpense', ifrs('FinanceCosts', 'InterestExpense')),
  d('pretaxIncome', ifrs('ProfitLossBeforeTax')),
  d('taxExpense', ifrs('IncomeTaxExpenseContinuingOperations')),
  d('netIncome', ifrs('ProfitLossAttributableToOwnersOfParent', 'ProfitLoss')),
  d('epsBasic', ifrs('BasicEarningsLossPerShare'), 1, 'perShare'),
  d('epsDiluted', ifrs('DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare'), 1, 'perShare'),
  d('sharesDiluted', ifrs('AdjustedWeightedAverageShares', 'WeightedAverageShares'), 1, 'shares'),
  i('cash', ifrs('CashAndCashEquivalents', 'Cash')),
  i('shortTermInvestments', ifrs('CurrentFinancialAssetsAtFairValueThroughProfitOrLoss', 'OtherCurrentFinancialAssets')),
  i('receivables', ifrs('TradeAndOtherCurrentReceivables', 'CurrentTradeReceivables')),
  i('inventory', ifrs('Inventories')),
  i('currentAssets', ifrs('CurrentAssets')),
  i('propertyPlantEquipment', ifrs('PropertyPlantAndEquipment')),
  i('goodwill', ifrs('Goodwill')),
  i('intangibleAssets', ifrs('IntangibleAssetsOtherThanGoodwill')),
  i('totalAssets', ifrs('Assets')),
  i('accountsPayable', ifrs('TradeAndOtherCurrentPayables', 'TradeAndOtherCurrentPayablesToTradeSuppliers')),
  i('_debtCurrent', ifrs('CurrentBorrowings', 'ShorttermBorrowings')),
  i('_ltdCurrent', ifrs('CurrentPortionOfLongtermBorrowings')),
  i('currentLiabilities', ifrs('CurrentLiabilities')),
  i('longTermDebt', ifrs('NoncurrentPortionOfNoncurrentBorrowings', 'LongtermBorrowings', 'NoncurrentBorrowings', 'BondsIssued')),
  i('totalLiabilities', ifrs('Liabilities')),
  i('retainedEarnings', ifrs('RetainedEarnings')),
  i('totalEquity', ifrs('EquityAttributableToOwnersOfParent', 'Equity')),
  i('minorityInterest', ifrs('NoncontrollingInterests')),
  i('leaseLiabilities', ifrs('LeaseLiabilities')),
  i('_operatingLeaseCurrent', ifrs('CurrentLeaseLiabilities')),
  i('_operatingLeaseNoncurrent', ifrs('NoncurrentLeaseLiabilities')),
  d('depreciationAmortization', ifrs('DepreciationAndAmortisationExpense', 'DepreciationExpense', 'DepreciationPropertyPlantAndEquipment')),
  d('stockBasedCompensation', ifrs('AdjustmentsForSharebasedPayments')),
  d('operatingCashFlow', ifrs('CashFlowsFromUsedInOperatingActivities')),
  // Many IFRS filers only tag a combined "PP&E and intangibles" line (Nokia, SAP) or "other long-term assets" (Shell).
  d(
    'capex',
    ifrs(
      'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
      'PurchaseOfPropertyPlantAndEquipment',
      'PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets',
      'PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsOtherThanGoodwill',
      'PurchaseOfOtherLongtermAssetsClassifiedAsInvestingActivities',
    ),
    -1,
  ),
  d('acquisitions', ifrs('CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities'), -1),
  d('investingCashFlow', ifrs('CashFlowsFromUsedInInvestingActivities')),
  d('dividendsPaid', ifrs('DividendsPaidClassifiedAsFinancingActivities', 'DividendsPaid'), -1),
  d('buybacks', ifrs('PaymentsToAcquireOrRedeemEntitysShares'), -1),
  d('financingCashFlow', ifrs('CashFlowsFromUsedInFinancingActivities')),
  d('fxEffect', ifrs('EffectOfExchangeRateChangesOnCashAndCashEquivalents')),
  d('netChangeInCash', ifrs('IncreaseDecreaseInCashAndCashEquivalents')),
];

const ALLOWED_FORMS = /^(10-K|10-Q|20-F|40-F|10-KT|6-K)/;
const DAY = 86_400_000;

type Slot = { start: string | null; end: string; val: number; filed: string; form: string; rank: number; days: number };
type Window = { start: string; end: string };

function days(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY);
}

function shiftDate(date: string, deltaDays: number) {
  return new Date(Date.parse(date) + deltaDays * DAY).toISOString().slice(0, 10);
}

function near(a: string | null, b: string | null, tolerance: number) {
  if (!a || !b) return false;
  return Math.abs(Date.parse(a) - Date.parse(b)) <= tolerance * DAY;
}

function classify(duration: number): 'FY' | 'Q' | 'H' | '9M' | null {
  if (duration >= 340 && duration <= 400) return 'FY';
  if (duration >= 75 && duration <= 105) return 'Q';
  if (duration >= 165 && duration <= 200) return 'H';
  if (duration >= 250 && duration <= 290) return '9M';
  return null;
}

function pickReportingCurrency(payload: CompanyFactsPayload, taxonomy: string): string {
  const counts = new Map<string, number>();
  const taxonomyFacts = payload.facts[taxonomy] ?? {};
  for (const tag of ['Revenues', 'Revenue', 'NetIncomeLoss', 'ProfitLoss', 'Assets', 'RevenueFromContractWithCustomerExcludingAssessedTax']) {
    const units = taxonomyFacts[tag]?.units ?? {};
    for (const [unit, facts] of Object.entries(units)) {
      if (/^[A-Z]{3}$/.test(unit)) counts.set(unit, (counts.get(unit) ?? 0) + facts.length);
    }
  }
  let best = 'USD';
  let bestCount = -1;
  for (const [unit, count] of counts) {
    if (count > bestCount || (count === bestCount && unit === 'USD')) {
      best = unit;
      bestCount = count;
    }
  }
  return best;
}

function pickUnit(units: Record<string, XbrlFact[]>, kind: UnitKind, currency: string): string | null {
  if (kind === 'shares') return units.shares ? 'shares' : null;
  if (kind === 'perShare') {
    if (units[`${currency}/shares`]) return `${currency}/shares`;
    if (units['USD/shares']) return 'USD/shares';
    return Object.keys(units).find((unit) => unit.endsWith('/shares')) ?? null;
  }
  if (units[currency]) return currency;
  if (units.USD) return 'USD';
  return null;
}

class SpecSeries {
  readonly slots: Slot[] = [];

  constructor(
    readonly spec: Spec,
    payload: CompanyFactsPayload,
    currency: string,
  ) {
    const byKey = new Map<string, Slot>();
    spec.tags.forEach((qualified, rank) => {
      const [taxonomy, tag] = qualified.split(':');
      const units = payload.facts[taxonomy]?.[tag]?.units;
      if (!units) return;
      const unit = pickUnit(units, spec.unit ?? 'money', currency);
      if (!unit) return;
      for (const fact of units[unit]) {
        if (typeof fact.val !== 'number' || !Number.isFinite(fact.val)) continue;
        if (!ALLOWED_FORMS.test(fact.form ?? '')) continue;
        const isDuration = Boolean(fact.start);
        if ((spec.kind === 'duration') !== isDuration) continue;
        const key = isDuration ? `${fact.start}|${fact.end}` : fact.end;
        const existing = byKey.get(key);
        const filed = fact.filed ?? '';
        if (existing && (existing.rank < rank || (existing.rank === rank && existing.filed >= filed))) continue;
        byKey.set(key, {
          start: fact.start ?? null,
          end: fact.end,
          val: fact.val * (spec.sign ?? 1),
          filed,
          form: fact.form ?? '',
          rank,
          days: fact.start ? days(fact.start, fact.end) : 0,
        });
      }
    });
    this.slots.push(...byKey.values());
  }

  /** Duration value whose start and end both fall within a few days of the window. */
  window(start: string, end: string, tolerance = 4): Slot | null {
    let best: Slot | null = null;
    for (const slot of this.slots) {
      if (!near(slot.end, end, tolerance) || !near(slot.start, start, tolerance)) continue;
      if (!best || slot.rank < best.rank || (slot.rank === best.rank && slot.filed > best.filed)) best = slot;
    }
    return best;
  }

  /** Instant value at (or within a week of) a date. */
  at(end: string, tolerance = 7): Slot | null {
    let best: Slot | null = null;
    let bestDistance = Infinity;
    for (const slot of this.slots) {
      const distance = Math.abs(Date.parse(slot.end) - Date.parse(end));
      if (distance > tolerance * DAY) continue;
      if (
        !best ||
        distance < bestDistance ||
        (distance === bestDistance && (slot.rank < best.rank || (slot.rank === best.rank && slot.filed > best.filed)))
      ) {
        best = slot;
        bestDistance = distance;
      }
    }
    return best;
  }
}

function fiscalYearFromEnd(end: string) {
  const date = new Date(`${end}T00:00:00Z`);
  const year = date.getUTCFullYear();
  // 52/53-week years that spill a few days into January belong to the prior year.
  return date.getUTCMonth() === 0 && date.getUTCDate() <= 10 ? year - 1 : year;
}

function emptyPeriod(input: {
  key: string;
  period: string;
  fiscalYear: number;
  fiscalQuarter: number | null;
  start: string | null;
  end: string;
  currency: string;
  label: string;
}): StatementPeriod {
  return {
    key: input.key,
    period: input.period,
    fiscalYear: input.fiscalYear,
    fiscalQuarter: input.fiscalQuarter,
    periodStart: input.start,
    periodEnd: input.end,
    label: input.label,
    currency: input.currency,
    filed: null,
    form: null,
    derived: [],
    fiscalDate: input.end,
    year: input.fiscalYear,
  };
}

function setValue(period: StatementPeriod, key: SpecKey, value: number | null, helpers: Map<string, number | null>) {
  if (key.startsWith('_')) {
    helpers.set(key, value);
    return;
  }
  (period as Record<string, unknown>)[key] = value;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumPresent(...values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

function ratio(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

/** Fill subtotals and derived measures that filers often omit. */
export function finalizePeriod(period: StatementPeriod, helpers: Map<string, number | null> = new Map()) {
  const p = period as Record<string, unknown>;
  const get = (key: string) => num(p[key]);
  const setIfMissing = (key: string, value: number | null) => {
    if (get(key) === null && value !== null && Number.isFinite(value)) p[key] = value;
  };

  // Banks rarely tag a single "revenue" figure.
  setIfMissing('revenue', sumPresent(get('netInterestIncome'), get('nonInterestIncome')) ?? null);
  if (get('revenue') !== null && get('costOfRevenue') !== null) {
    setIfMissing('grossProfit', (get('revenue') as number) - (get('costOfRevenue') as number));
  }
  if (get('grossProfit') !== null && get('operatingIncome') !== null) {
    setIfMissing('totalOperatingExpenses', (get('grossProfit') as number) - (get('operatingIncome') as number));
  }
  p.ebit = get('operatingIncome');
  p.ebitda =
    get('operatingIncome') !== null && get('depreciationAmortization') !== null
      ? (get('operatingIncome') as number) + (get('depreciationAmortization') as number)
      : null;

  // Debt: prefer a reported current-debt total, otherwise add up its parts.
  const debtCurrent = helpers.get('_debtCurrent') ?? null;
  const ltdCurrent = helpers.get('_ltdCurrent') ?? null;
  setIfMissing(
    'shortTermDebt',
    debtCurrent ?? sumPresent(ltdCurrent, helpers.get('_shortBorrowings'), helpers.get('_commercialPaper')),
  );
  const longTermTotal = helpers.get('_longTermDebtTotal') ?? null;
  if (longTermTotal !== null) setIfMissing('longTermDebt', longTermTotal - (ltdCurrent ?? 0));
  if (get('shortTermDebt') !== null || get('longTermDebt') !== null) {
    setIfMissing('totalDebt', (get('shortTermDebt') ?? 0) + (get('longTermDebt') ?? 0));
  }
  if (get('totalDebt') !== null) p.netDebt = (get('totalDebt') as number) - (get('cash') ?? 0);

  // Leases: operating plus finance lease liabilities, current and long-term.
  const operatingLeases = helpers.get('_operatingLeaseTotal') ?? sumPresent(helpers.get('_operatingLeaseCurrent'), helpers.get('_operatingLeaseNoncurrent'));
  const financeLeases = helpers.get('_financeLeaseTotal') ?? sumPresent(helpers.get('_financeLeaseCurrent'), helpers.get('_financeLeaseNoncurrent'));
  setIfMissing('leaseLiabilities', sumPresent(operatingLeases, financeLeases));
  if (helpers.get('_redeemablePreferred') != null) {
    setIfMissing('preferredStock', helpers.get('_redeemablePreferred') ?? null);
  }

  // Liabilities are frequently not tagged as a total.
  const liabilitiesAndEquity = helpers.get('_liabilitiesAndEquity') ?? get('totalAssets');
  const equityInclNci = helpers.get('_equityInclNci') ?? (get('totalEquity') !== null ? (get('totalEquity') as number) + (get('minorityInterest') ?? 0) : null);
  if (liabilitiesAndEquity !== null && equityInclNci !== null) {
    setIfMissing('totalLiabilities', liabilitiesAndEquity - equityInclNci);
  }
  setIfMissing('commonStockAndApic', sumPresent(helpers.get('_commonStock'), helpers.get('_apic')));
  if (get('totalAssets') !== null && get('currentAssets') !== null) {
    p.nonCurrentAssets = (get('totalAssets') as number) - (get('currentAssets') as number);
  }
  if (get('totalLiabilities') !== null && get('currentLiabilities') !== null) {
    p.nonCurrentLiabilities = (get('totalLiabilities') as number) - (get('currentLiabilities') as number);
  }

  if (get('operatingCashFlow') !== null && get('capex') !== null) {
    p.freeCashFlow = (get('operatingCashFlow') as number) - Math.abs(get('capex') as number);
  } else if (get('operatingCashFlow') !== null && get('capex') === null && get('freeCashFlow') === null) {
    p.freeCashFlow = null;
  }

  const revenue = get('revenue');
  p.grossMargin = ratio(get('grossProfit'), revenue);
  p.operatingMargin = ratio(get('operatingIncome'), revenue);
  p.ebitdaMargin = ratio(get('ebitda'), revenue);
  p.netMargin = ratio(get('netIncome'), revenue);
  p.fcfMargin = ratio(get('freeCashFlow'), revenue);
  if (period.derived && period.derived.length === 0) delete period.derived;
  return period;
}

/** Latest period end reported in a taxonomy, or '' when it has none. */
function latestEnd(facts: Record<string, { units: Record<string, XbrlFact[]> }> | undefined) {
  let latest = '';
  for (const concept of Object.values(facts ?? {})) {
    for (const rows of Object.values(concept.units)) for (const row of rows) if (row.end > latest) latest = row.end;
  }
  return latest;
}

/**
 * The taxonomy a company reports in today. A filer that switched (Toyota moved from US GAAP to IFRS in 2021)
 * keeps years of the old taxonomy with more concepts, so recency decides once both are substantial.
 */
function pickTaxonomy(payload: CompanyFactsPayload): 'us-gaap' | 'ifrs-full' {
  const gaap = payload.facts['us-gaap'];
  const ifrs = payload.facts['ifrs-full'];
  const gaapCount = Object.keys(gaap ?? {}).length;
  const ifrsCount = Object.keys(ifrs ?? {}).length;
  if (gaapCount >= 20 && ifrsCount >= 20) {
    const gaapEnd = latestEnd(gaap);
    const ifrsEnd = latestEnd(ifrs);
    if (gaapEnd !== ifrsEnd) return ifrsEnd > gaapEnd ? 'ifrs-full' : 'us-gaap';
  }
  return ifrsCount > gaapCount ? 'ifrs-full' : 'us-gaap';
}

const ANCHOR_KEYS: SpecKey[] = ['revenue', 'netIncome', 'operatingCashFlow', 'totalInterestIncome', 'operatingIncome'];

export function standardizeCompanyFacts(
  payload: CompanyFactsPayload,
  options: { symbol: string; maxAnnual?: number; maxQuarterly?: number },
): StandardizedStatements {
  const taxonomy = pickTaxonomy(payload);
  const specs = taxonomy === 'ifrs-full' ? IFRS_SPECS : GAAP_SPECS;
  const currency = pickReportingCurrency(payload, taxonomy);
  const series = specs.map((spec) => new SpecSeries(spec, payload, currency));
  const seriesByKey = new Map(series.map((item) => [item.spec.key, item]));

  // ── Fiscal years, anchored on the main income and cash-flow lines ─────────
  const fiscalYears = new Map<string, Window & { filed: string; form: string }>();
  for (const key of ANCHOR_KEYS) {
    for (const slot of seriesByKey.get(key)?.slots ?? []) {
      if (!slot.start || classify(slot.days) !== 'FY') continue;
      const existing = fiscalYears.get(slot.end);
      if (!existing || Math.abs(slot.days - 365) < Math.abs(days(existing.start, existing.end) - 365)) {
        fiscalYears.set(slot.end, { start: slot.start, end: slot.end, filed: slot.filed, form: slot.form });
      } else if (slot.filed > existing.filed) {
        existing.filed = slot.filed;
        existing.form = slot.form;
      }
    }
  }
  const years = [...fiscalYears.values()]
    .sort((a, b) => b.end.localeCompare(a.end))
    .filter((year, index, all) => index === 0 || !near(year.end, all[index - 1].end, 20));

  const fiscalYearEndMonth = years[0] ? new Date(`${years[0].end}T00:00:00Z`).getUTCMonth() + 1 : null;

  const fillPeriod = (period: StatementPeriod, window: Window, mode: 'annual' | 'quarter', quarterContext?: QuarterContext) => {
    const helpers = new Map<string, number | null>();
    const derived: string[] = [];
    for (const item of series) {
      const { spec } = item;
      let value: number | null = null;
      if (spec.kind === 'instant') {
        value = item.at(window.end)?.val ?? null;
      } else if (mode === 'annual') {
        value = item.window(window.start, window.end)?.val ?? null;
      } else if (quarterContext) {
        const direct = item.window(window.start, window.end);
        if (direct && classify(direct.days) === 'Q') {
          value = direct.val;
        } else if (spec.unit === 'perShare') {
          value = null; // computed below from net income / shares
        } else if (spec.unit === 'shares') {
          value = item.window(quarterContext.fyStart, window.end)?.val ?? null;
          if (value !== null) derived.push(spec.key);
        } else {
          value = deriveQuarter(item, quarterContext, window);
          if (value !== null) derived.push(spec.key);
        }
      }
      setValue(period, spec.key, value, helpers);
    }
    if (mode === 'quarter') {
      const net = num(period.netIncome);
      const shares = num(period.sharesDiluted);
      if (period.epsDiluted == null && net !== null && shares) {
        period.epsDiluted = net / shares;
        derived.push('epsDiluted');
      }
    }
    period.derived = derived;
    return finalizePeriod(period, helpers);
  };

  // ── Annual periods ─────────────────────────────────────────────────────────
  const annual = years.slice(0, options.maxAnnual ?? 12).map((year) => {
    const fiscalYear = fiscalYearFromEnd(year.end);
    const period = emptyPeriod({
      key: `FY${fiscalYear}`,
      period: 'FY',
      fiscalYear,
      fiscalQuarter: null,
      start: year.start,
      end: year.end,
      currency,
      label: `FY${String(fiscalYear).slice(-2)}`,
    });
    period.filed = year.filed || null;
    period.form = year.form || null;
    return fillPeriod(period, year, 'annual');
  });

  // ── Quarterly periods ──────────────────────────────────────────────────────
  const quarterWindows = buildQuarterWindows(years, series);
  const quarterly = quarterWindows.slice(0, options.maxQuarterly ?? 16).map((quarter) => {
    const period = emptyPeriod({
      key: `FY${quarter.fiscalYear}-Q${quarter.quarter}`,
      period: `Q${quarter.quarter}`,
      fiscalYear: quarter.fiscalYear,
      fiscalQuarter: quarter.quarter,
      start: quarter.start,
      end: quarter.end,
      currency,
      label: `Q${quarter.quarter} FY${String(quarter.fiscalYear).slice(-2)}`,
    });
    return fillPeriod(period, quarter, 'quarter', quarter.context);
  });

  // Drop quarters that carry no income or cash-flow data at all.
  const usefulQuarterly = quarterly.filter(
    (period) => period.revenue != null || period.netIncome != null || period.operatingCashFlow != null,
  );

  return {
    symbol: options.symbol,
    entityName: payload.entityName,
    cik: String(payload.cik).padStart(10, '0'),
    source: 'sec',
    currency,
    taxonomy,
    fiscalYearEndMonth,
    annual,
    quarterly: usefulQuarterly,
    ttm: buildTtm(usefulQuarterly, currency),
    sharesOutstanding: readSharesOutstanding(payload),
    fetchedAt: new Date().toISOString(),
  };
}

type QuarterContext = {
  fyStart: string;
  fyEnd: string | null;
  /** Ends of the quarters in this fiscal year that precede the current one, oldest first. */
  previousEnds: string[];
};

type QuarterWindow = Window & { fiscalYear: number; quarter: number; context: QuarterContext };

function deriveQuarter(item: SpecSeries, context: QuarterContext, window: Window): number | null {
  const previousEnd = context.previousEnds.at(-1);
  // Year-to-date through this quarter minus year-to-date through the previous quarter.
  const ytd = item.window(context.fyStart, window.end);
  if (ytd) {
    if (!previousEnd) return classify(ytd.days) === 'Q' ? ytd.val : null;
    const ytdPrevious = item.window(context.fyStart, previousEnd);
    if (ytdPrevious) return ytd.val - ytdPrevious.val;
    // Fall back to adding up the individually reported earlier quarters.
    let earlier = 0;
    let quarterStart = context.fyStart;
    for (const end of context.previousEnds) {
      const slot = item.window(quarterStart, end);
      if (!slot || classify(slot.days) !== 'Q') return null;
      earlier += slot.val;
      quarterStart = shiftDate(end, 1);
    }
    return ytd.val - earlier;
  }
  return null;
}

function buildQuarterWindows(years: Array<Window>, series: SpecSeries[]): QuarterWindow[] {
  const anchorSeries = series.filter((item) => ANCHOR_KEYS.includes(item.spec.key));
  const quarterEnds = new Set<string>();
  for (const item of anchorSeries) {
    for (const slot of item.slots) {
      if (!slot.start) continue;
      const kind = classify(slot.days);
      if (kind === 'Q' || kind === 'H' || kind === '9M') quarterEnds.add(slot.end);
    }
  }

  // Fiscal years oldest → newest, plus the year currently in progress.
  const ordered = [...years].sort((a, b) => a.end.localeCompare(b.end));
  const latest = ordered.at(-1);
  const spans: Array<{ start: string; end: string | null }> = ordered.map((year) => ({ start: year.start, end: year.end }));
  if (latest) spans.push({ start: shiftDate(latest.end, 1), end: null });

  const windows: QuarterWindow[] = [];
  for (const span of spans) {
    const limit = span.end ?? shiftDate(span.start, 372);
    const ends = [...quarterEnds]
      .filter((end) => end > span.start && end <= limit && days(span.start, end) >= 75)
      .sort();
    if (span.end) ends.push(span.end);
    const uniqueEnds = ends.filter((end, index, all) => index === 0 || !near(end, all[index - 1], 20));
    const fiscalYear = span.end ? fiscalYearFromEnd(span.end) : fiscalYearFromEnd(shiftDate(span.start, 364));
    const previousEnds: string[] = [];
    let quarterStart = span.start;
    for (const end of uniqueEnds) {
      const quarter = Math.min(4, Math.max(1, Math.round(days(span.start, end) / 91.3)));
      // Half-year filers (20-F/6-K) and gaps would produce 6-month "quarters": skip those windows.
      if (days(quarterStart, end) <= 105) {
        windows.push({
          start: quarterStart,
          end,
          fiscalYear,
          quarter,
          context: { fyStart: span.start, fyEnd: span.end, previousEnds: [...previousEnds] },
        });
      }
      previousEnds.push(end);
      quarterStart = shiftDate(end, 1);
    }
  }
  return windows
    .filter((window, index, all) => all.findIndex((other) => other.fiscalYear === window.fiscalYear && other.quarter === window.quarter) === index)
    .sort((a, b) => b.end.localeCompare(a.end));
}

const TTM_SUM_KEYS: LineItemKey[] = [
  'revenue', 'costOfRevenue', 'grossProfit', 'researchAndDevelopment', 'sellingGeneralAdministrative',
  'totalOperatingExpenses', 'operatingIncome', 'interestExpense', 'pretaxIncome', 'taxExpense', 'netIncome',
  'totalInterestIncome', 'netInterestIncome', 'nonInterestIncome', 'provisionForCreditLosses', 'nonInterestExpense',
  'depreciationAmortization', 'stockBasedCompensation', 'deferredTaxes', 'changeInReceivables', 'changeInInventory',
  'changeInPayables', 'operatingCashFlow', 'capex', 'acquisitions', 'purchasesOfInvestments', 'salesOfInvestments',
  'investingCashFlow', 'dividendsPaid', 'buybacks', 'stockIssued', 'debtIssued', 'debtRepaid', 'financingCashFlow',
  'fxEffect', 'netChangeInCash', 'interestPaid', 'taxesPaid',
];

export function buildTtm(quarterly: StatementPeriod[], currency: string): StatementPeriod | null {
  const lastFour = quarterly.slice(0, 4);
  if (lastFour.length < 4) return null;
  // Require four consecutive quarters (~one year between the oldest start and the newest end).
  const span = lastFour[3].periodStart ? days(lastFour[3].periodStart, lastFour[0].periodEnd) : 0;
  if (span < 340 || span > 400) return null;
  const latest = lastFour[0];
  const ttm = emptyPeriod({
    key: 'TTM',
    period: 'TTM',
    fiscalYear: latest.fiscalYear,
    fiscalQuarter: latest.fiscalQuarter,
    start: lastFour[3].periodStart,
    end: latest.periodEnd,
    currency,
    label: 'TTM',
  });
  const record = ttm as Record<string, unknown>;
  for (const key of TTM_SUM_KEYS) {
    const values = lastFour.map((period) => num(period[key]));
    record[key] = values.every((value) => value !== null) ? (values as number[]).reduce((a, b) => a + b, 0) : null;
  }
  // Balance sheet items are point-in-time: take the latest quarter.
  for (const [key, value] of Object.entries(latest)) {
    if (record[key] === undefined && typeof value === 'number') record[key] = value;
  }
  const epsValues = lastFour.map((period) => num(period.epsDiluted));
  record.epsDiluted = epsValues.every((value) => value !== null)
    ? (epsValues as number[]).reduce((a, b) => a + b, 0)
    : ratio(num(record.netIncome), num(latest.sharesDiluted));
  record.sharesDiluted = num(latest.sharesDiluted);
  ttm.filed = latest.filed;
  delete record.freeCashFlow;
  return finalizePeriod(ttm);
}

function readSharesOutstanding(payload: CompanyFactsPayload): { value: number; asOf: string } | null {
  const facts = payload.facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
  if (!facts.length) return null;
  const latestEnd = facts.reduce((max, fact) => (fact.end > max ? fact.end : max), '');
  const latestFiled = facts.filter((fact) => fact.end === latestEnd).reduce((max, fact) => ((fact.filed ?? '') > max ? fact.filed ?? '' : max), '');
  // Multi-class companies report one figure per class on the same cover page.
  const sameFiling = facts.filter((fact) => fact.end === latestEnd && (fact.filed ?? '') === latestFiled);
  const value = sameFiling.reduce((total, fact) => total + fact.val, 0);
  return value > 0 ? { value, asOf: latestEnd } : null;
}

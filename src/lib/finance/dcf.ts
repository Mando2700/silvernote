/**
 * Discounted cash flow (free cash flow to the firm) with a Gordon-growth terminal value.
 * Pure math shared by the DCF tab and its tests; all money values are in the statements' currency.
 */

export type DcfAssumptions = {
  baseRevenue: number;
  /** Revenue growth for each explicit forecast year (0.08 = 8%). */
  growth: number[];
  /** EBIT margin for each forecast year. */
  ebitMargin: number[];
  taxRate: number;
  daPctRevenue: number;
  capexPctRevenue: number;
  /** Net working capital as a share of revenue: growth ties up this much of each new dollar of revenue. */
  nwcPctRevenue: number;
  /** Stock-based compensation as a share of revenue, deducted as a real cost when `deductSbc` is on. */
  sbcPctRevenue: number;
  deductSbc: boolean;
  wacc: number;
  terminalGrowth: number;
  midYear: boolean;
  // Bridge from enterprise value to equity value
  cash: number;
  debt: number;
  leases: number;
  includeLeases: boolean;
  minorityInterest: number;
  preferredStock: number;
  shares: number;
};

export type DcfYear = {
  year: number;
  revenue: number;
  growth: number;
  ebit: number;
  nopat: number;
  da: number;
  capex: number;
  changeNwc: number;
  sbc: number;
  fcf: number;
  discountFactor: number;
  presentValue: number;
};

export type DcfResult = {
  years: DcfYear[];
  pvForecast: number;
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  perShare: number | null;
  terminalShare: number;
  impliedExitMultiple: number | null;
  error: string | null;
};

/** Linear fade from `start` to `end` over `years` steps (the last step lands on `end`). */
export function fade(start: number, end: number, years: number) {
  if (years <= 1) return [end];
  return Array.from({ length: years }, (_, index) => start + ((end - start) * index) / (years - 1));
}

export function runDcf(a: DcfAssumptions): DcfResult {
  const empty = { years: [], pvForecast: 0, terminalValue: 0, pvTerminal: 0, enterpriseValue: 0, equityValue: 0, perShare: null, terminalShare: 0, impliedExitMultiple: null };
  if (!(a.baseRevenue > 0)) return { ...empty, error: 'Needs a positive base revenue.' };
  if (a.wacc <= a.terminalGrowth) return { ...empty, error: 'The discount rate must be higher than terminal growth.' };

  const years: DcfYear[] = [];
  let revenue = a.baseRevenue;
  for (let index = 0; index < a.growth.length; index += 1) {
    const growth = a.growth[index];
    const previous = revenue;
    revenue = previous * (1 + growth);
    const ebit = revenue * (a.ebitMargin[index] ?? a.ebitMargin.at(-1) ?? 0);
    const nopat = ebit > 0 ? ebit * (1 - a.taxRate) : ebit;
    const da = revenue * a.daPctRevenue;
    const capex = revenue * a.capexPctRevenue;
    const changeNwc = (revenue - previous) * a.nwcPctRevenue;
    const sbc = a.deductSbc ? revenue * a.sbcPctRevenue : 0;
    const fcf = nopat + da - capex - changeNwc - sbc;
    const period = a.midYear ? index + 0.5 : index + 1;
    const discountFactor = 1 / (1 + a.wacc) ** period;
    years.push({ year: index + 1, revenue, growth, ebit, nopat, da, capex, changeNwc, sbc, fcf, discountFactor, presentValue: fcf * discountFactor });
  }

  const last = years.at(-1);
  const pvForecast = years.reduce((total, year) => total + year.presentValue, 0);
  const terminalFcf = last ? last.fcf * (1 + a.terminalGrowth) : 0;
  const terminalValue = terminalFcf / (a.wacc - a.terminalGrowth);
  const terminalPeriod = a.midYear ? years.length - 0.5 : years.length;
  const pvTerminal = terminalValue / (1 + a.wacc) ** terminalPeriod;
  const enterpriseValue = pvForecast + pvTerminal;
  const equityValue =
    enterpriseValue + a.cash - a.debt - (a.includeLeases ? a.leases : 0) - a.minorityInterest - a.preferredStock;
  const lastEbitda = last ? last.ebit + last.da : 0;
  return {
    years,
    pvForecast,
    terminalValue,
    pvTerminal,
    enterpriseValue,
    equityValue,
    perShare: a.shares > 0 ? equityValue / a.shares : null,
    terminalShare: enterpriseValue !== 0 ? pvTerminal / enterpriseValue : 0,
    impliedExitMultiple: lastEbitda > 0 ? terminalValue / lastEbitda : null,
    error: null,
  };
}

/** Per-share value across a grid of discount rates (rows) and terminal growth rates (columns). */
export function sensitivity(a: DcfAssumptions, waccs: number[], growths: number[]) {
  return waccs.map((wacc) => growths.map((terminalGrowth) => runDcf({ ...a, wacc, terminalGrowth }).perShare));
}

/** Cost of equity via CAPM, and the weighted average cost of capital on market-value weights. */
export function waccFromInputs(input: {
  riskFree: number;
  beta: number;
  equityRiskPremium: number;
  preTaxCostOfDebt: number;
  taxRate: number;
  marketCap: number;
  debt: number;
}) {
  const costOfEquity = input.riskFree + input.beta * input.equityRiskPremium;
  const afterTaxDebt = input.preTaxCostOfDebt * (1 - input.taxRate);
  const capital = Math.max(input.marketCap, 0) + Math.max(input.debt, 0);
  const debtWeight = capital > 0 ? Math.max(input.debt, 0) / capital : 0;
  return { costOfEquity, afterTaxDebt, debtWeight, wacc: costOfEquity * (1 - debtWeight) + afterTaxDebt * debtWeight };
}

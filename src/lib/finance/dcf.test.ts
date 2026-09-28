import { describe, expect, it } from 'vitest';

import { applyLever, fade, runDcf, sensitivity, solveForPerShare, waccFromInputs, type DcfAssumptions } from './dcf';

const base: DcfAssumptions = {
  baseRevenue: 1000,
  growth: [0.1, 0.1, 0.1, 0.1, 0.1],
  ebitMargin: [0.2, 0.2, 0.2, 0.2, 0.2],
  taxRate: 0.25,
  daPctRevenue: 0.05,
  capexPctRevenue: 0.05,
  nwcPctRevenue: 0,
  sbcPctRevenue: 0.02,
  deductSbc: false,
  wacc: 0.1,
  terminalGrowth: 0.02,
  midYear: false,
  cash: 100,
  debt: 300,
  leases: 50,
  includeLeases: true,
  minorityInterest: 20,
  preferredStock: 30,
  shares: 10,
};

describe('dcf', () => {
  it('discounts free cash flow and bridges to equity', () => {
    const result = runDcf(base);
    // Year 1: revenue 1100, EBIT 220, NOPAT 165, D&A = capex, no working capital, SBC 22 added back → FCF 187.
    expect(result.years[0].fcf).toBeCloseTo(187);
    expect(result.years[0].presentValue).toBeCloseTo(170);
    const last = result.years[4];
    expect(result.terminalValue).toBeCloseTo((last.fcf * 1.02) / 0.08);
    expect(result.equityValue).toBeCloseTo(result.enterpriseValue + 100 - 300 - 50 - 20 - 30);
    expect(result.perShare).toBeCloseTo(result.equityValue / 10);
  });

  it('keeps SBC as a cost (already inside EBIT) and deducts working capital', () => {
    const result = runDcf({ ...base, deductSbc: true, nwcPctRevenue: 0.1 });
    expect(result.years[0].fcf).toBeCloseTo(165 - 10);
  });

  it('withholds a value when the final year burns cash', () => {
    const result = runDcf({ ...base, ebitMargin: [-0.3, -0.3, -0.3, -0.3, -0.3] });
    expect(result.years).toHaveLength(5);
    expect(result.perShare).toBeNull();
    expect(result.impliedExitMultiple).toBeNull();
    expect(result.error).toMatch(/negative/);
  });

  it('refuses a discount rate at or below terminal growth', () => {
    expect(runDcf({ ...base, wacc: 0.02 }).error).toMatch(/higher/);
  });

  it('builds a sensitivity grid that falls as the discount rate rises', () => {
    const grid = sensitivity(base, [0.08, 0.1, 0.12], [0.02]);
    expect(grid[0][0]! > grid[1][0]! && grid[1][0]! > grid[2][0]!).toBe(true);
  });

  it('fades and weights the cost of capital', () => {
    expect(fade(0.1, 0.02, 5)).toEqual([0.1, 0.08, 0.06, 0.04, 0.02].map((value) => expect.closeTo(value)));
    const { wacc, costOfEquity } = waccFromInputs({ riskFree: 0.04, beta: 1.2, equityRiskPremium: 0.05, preTaxCostOfDebt: 0.06, taxRate: 0.25, marketCap: 800, debt: 200 });
    expect(costOfEquity).toBeCloseTo(0.1);
    expect(wacc).toBeCloseTo(0.1 * 0.8 + 0.045 * 0.2);
  });

  it('solves for the margin or growth that justifies a price', () => {
    const target = runDcf(base).perShare! * 1.5;
    const margin = solveForPerShare(base, target, 'margin')!;
    expect(margin).toBeGreaterThan(0.2);
    expect(runDcf(applyLever(base, 'margin', margin)).perShare).toBeCloseTo(target, 4);
    const growth = solveForPerShare(base, target, 'growth')!;
    expect(growth).toBeGreaterThan(0);
    expect(runDcf(applyLever(base, 'growth', growth)).perShare).toBeCloseTo(target, 4);
  });

  it('returns null when no lever value reaches the price', () => {
    expect(solveForPerShare(base, 1e9, 'margin')).toBeNull();
  });
});

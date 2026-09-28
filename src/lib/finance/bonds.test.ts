import { describe, expect, it } from 'vitest';

import { accruedInterest, cashFlows, cleanPrice, dirtyPrice, interpolateCurve, riskMeasures, yieldFromPrice, type BondTerms } from './bonds';

const tenYear: BondTerms = { coupon: 0.05, frequency: 2, maturity: '2035-06-15', dayCount: '30/360' };

describe('bond pricing', () => {
  it('prices at par when yield equals coupon on a coupon date', () => {
    expect(cleanPrice(tenYear, 0.05, '2025-06-15')).toBeCloseTo(100, 6);
    expect(accruedInterest(tenYear, '2025-06-15')).toBe(0);
  });

  it('accrues interest between coupons and keeps the clean price near par', () => {
    expect(accruedInterest(tenYear, '2025-09-15')).toBeCloseTo(1.25, 6);
    expect(cleanPrice(tenYear, 0.05, '2025-09-15')).toBeCloseTo(100, 1);
    expect(dirtyPrice(tenYear, 0.05, '2025-09-15')).toBeGreaterThan(101);
  });

  it('prices a premium and a discount the right way round', () => {
    expect(cleanPrice(tenYear, 0.04, '2025-06-15')).toBeCloseTo(108.18, 1);
    expect(cleanPrice(tenYear, 0.06, '2025-06-15')).toBeCloseTo(92.56, 1);
  });

  it('inverts price to yield', () => {
    const price = cleanPrice(tenYear, 0.0437, '2025-11-03');
    expect(yieldFromPrice(tenYear, price, '2025-11-03')).toBeCloseTo(0.0437, 7);
  });

  it('handles zero-coupon bonds with semiannual compounding', () => {
    const bill: BondTerms = { coupon: 0, frequency: 0, maturity: '2027-06-15', dayCount: 'act/act' };
    expect(cashFlows(bill, '2025-06-15')).toEqual([{ date: '2027-06-15', coupon: 0, principal: 100 }]);
    const price = cleanPrice(bill, 0.04, '2025-06-15');
    expect(price).toBeCloseTo(100 / 1.02 ** 4, 1);
    expect(riskMeasures(bill, 0.04, '2025-06-15').macaulay).toBeCloseTo(2, 2);
  });

  it('lists the remaining coupons and the principal', () => {
    const flows = cashFlows({ coupon: 0.04, frequency: 2, maturity: '2026-12-31', dayCount: '30/360' }, '2025-09-27');
    expect(flows.map((flow) => flow.date)).toEqual(['2025-12-31', '2026-06-30', '2026-12-31']);
    expect(flows.at(-1)).toEqual({ date: '2026-12-31', coupon: 2, principal: 100 });
  });
});

describe('risk measures', () => {
  it('matches textbook duration and convexity for a 10-year 5% par bond', () => {
    const risk = riskMeasures(tenYear, 0.05, '2025-06-15');
    expect(risk.macaulay).toBeCloseTo(7.99, 1);
    expect(risk.modified).toBeCloseTo(7.79, 1);
    expect(risk.convexity).toBeCloseTo(73.63, 1);
    expect(risk.dv01).toBeCloseTo(0.0779, 3);
  });

  it('predicts small price moves with duration', () => {
    const base = dirtyPrice(tenYear, 0.05, '2025-06-15');
    const moved = dirtyPrice(tenYear, 0.0501, '2025-06-15');
    expect(base - moved).toBeCloseTo(riskMeasures(tenYear, 0.05, '2025-06-15').dv01, 4);
  });
});

describe('curve interpolation', () => {
  const curve = [
    { years: 1, rate: 0.04 },
    { years: 5, rate: 0.036 },
    { years: 10, rate: 0.041 },
  ];
  it('interpolates linearly and extrapolates flat', () => {
    expect(interpolateCurve(curve, 3)).toBeCloseTo(0.038);
    expect(interpolateCurve(curve, 7.5)).toBeCloseTo(0.0385);
    expect(interpolateCurve(curve, 0.25)).toBe(0.04);
    expect(interpolateCurve(curve, 30)).toBe(0.041);
    expect(interpolateCurve([], 3)).toBeNull();
  });
});

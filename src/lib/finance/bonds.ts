/**
 * Fixed-rate bond math: coupon schedule, price ↔ yield, accrued interest, duration, convexity,
 * and yield-curve interpolation. Prices are per 100 of face value; yields and coupons are fractions.
 * Pure functions: no I/O. Dates are ISO `YYYY-MM-DD` strings.
 */

export type DayCount = '30/360' | 'act/act';

export type BondTerms = {
  /** Annual coupon rate as a fraction (0.0425 = 4.25%). 0 for zero-coupon bills and strips. */
  coupon: number;
  /** Coupons per year: 1, 2, 4 or 12; 0 means zero-coupon. */
  frequency: number;
  maturity: string;
  dayCount: DayCount;
};

export type CashFlow = { date: string; coupon: number; principal: number };

const DAY_MS = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return iso(target.getTime());
}

function days30360(from: string, to: string) {
  const [y1, m1, d1raw] = from.split('-').map(Number);
  const [y2, m2, d2raw] = to.split('-').map(Number);
  const d1 = Math.min(d1raw, 30);
  const d2 = d2raw === 31 && d1 >= 30 ? 30 : d2raw;
  return 360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1);
}

function dayDiff(from: string, to: string, dayCount: DayCount) {
  return dayCount === '30/360' ? days30360(from, to) : Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

export function yearsBetween(from: string, to: string) {
  return (toTime(to) - toTime(from)) / (365.25 * DAY_MS);
}

/** Coupon dates stepping back from maturity: the last one on/before settlement and every later one. */
function couponDates(terms: BondTerms, settlement: string) {
  const step = 12 / terms.frequency;
  const dates: string[] = [terms.maturity];
  let count = 1;
  while (dates[0] > settlement) {
    dates.unshift(addMonths(terms.maturity, -step * count));
    count += 1;
    if (count > 1200) break;
  }
  return { previous: dates[0], upcoming: dates.slice(1) };
}

/** Remaining cash flows per 100 face after settlement. */
export function cashFlows(terms: BondTerms, settlement: string): CashFlow[] {
  if (settlement >= terms.maturity) return [];
  if (!terms.frequency || !terms.coupon) return [{ date: terms.maturity, coupon: 0, principal: 100 }];
  const { upcoming } = couponDates(terms, settlement);
  const coupon = (terms.coupon * 100) / terms.frequency;
  return upcoming.map((date, index) => ({ date, coupon, principal: index === upcoming.length - 1 ? 100 : 0 }));
}

/** Fraction of the current coupon period already elapsed (0–1). */
function elapsedFraction(terms: BondTerms, settlement: string) {
  const { previous, upcoming } = couponDates(terms, settlement);
  const next = upcoming[0];
  if (!next) return 0;
  const period = dayDiff(previous, next, terms.dayCount);
  return period > 0 ? Math.min(1, Math.max(0, dayDiff(previous, settlement, terms.dayCount) / period)) : 0;
}

export function accruedInterest(terms: BondTerms, settlement: string) {
  if (!terms.frequency || !terms.coupon || settlement >= terms.maturity) return 0;
  return ((terms.coupon * 100) / terms.frequency) * elapsedFraction(terms, settlement);
}

type Discounted = { t: number; amount: number; pv: number };

/** Each flow discounted at yield `y` with the street convention (compounded at the coupon frequency). */
function discount(terms: BondTerms, y: number, settlement: string): { flows: Discounted[]; periodsPerYear: number } {
  if (!terms.frequency || !terms.coupon) {
    // Zero-coupon: semiannual compounding by convention.
    const t = Math.max(0, yearsBetween(settlement, terms.maturity));
    return { flows: [{ t, amount: 100, pv: 100 / (1 + y / 2) ** (2 * t) }], periodsPerYear: 2 };
  }
  const f = terms.frequency;
  const w = 1 - elapsedFraction(terms, settlement);
  const flows = cashFlows(terms, settlement).map((flow, index) => {
    const periods = index + w;
    const amount = flow.coupon + flow.principal;
    return { t: periods / f, amount, pv: amount / (1 + y / f) ** periods };
  });
  return { flows, periodsPerYear: f };
}

/** Full (dirty) price per 100 face. */
export function dirtyPrice(terms: BondTerms, y: number, settlement: string) {
  return discount(terms, y, settlement).flows.reduce((sum, flow) => sum + flow.pv, 0);
}

/** Quoted (clean) price per 100 face. */
export function cleanPrice(terms: BondTerms, y: number, settlement: string) {
  return dirtyPrice(terms, y, settlement) - accruedInterest(terms, settlement);
}

/** Yield to maturity from a clean price (bisection; robust for any sane price). */
export function yieldFromPrice(terms: BondTerms, clean: number, settlement: string) {
  if (settlement >= terms.maturity || !(clean > 0)) return null;
  const target = clean + accruedInterest(terms, settlement);
  let low = -0.05;
  let high = 2;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (dirtyPrice(terms, mid, settlement) > target) low = mid;
    else high = mid;
    if (high - low < 1e-10) break;
  }
  return (low + high) / 2;
}

export type RiskMeasures = {
  macaulay: number;
  modified: number;
  convexity: number;
  /** Price change per 100 face for a 1 bp fall in yield. */
  dv01: number;
};

export function riskMeasures(terms: BondTerms, y: number, settlement: string): RiskMeasures {
  const { flows, periodsPerYear: f } = discount(terms, y, settlement);
  const price = flows.reduce((sum, flow) => sum + flow.pv, 0);
  if (!price) return { macaulay: 0, modified: 0, convexity: 0, dv01: 0 };
  const macaulay = flows.reduce((sum, flow) => sum + flow.t * flow.pv, 0) / price;
  const modified = macaulay / (1 + y / f);
  const convexity = flows.reduce((sum, flow) => sum + flow.t * (flow.t + 1 / f) * flow.pv, 0) / (price * (1 + y / f) ** 2);
  return { macaulay, modified, convexity, dv01: modified * price * 0.0001 };
}

export type CurvePoint = { years: number; rate: number };

/** Linear interpolation on a yield curve, flat beyond the ends. */
export function interpolateCurve(curve: CurvePoint[], years: number) {
  if (!curve.length) return null;
  const sorted = [...curve].sort((a, b) => a.years - b.years);
  if (years <= sorted[0].years) return sorted[0].rate;
  for (let i = 1; i < sorted.length; i += 1) {
    if (years <= sorted[i].years) {
      const left = sorted[i - 1];
      const right = sorted[i];
      return left.rate + ((right.rate - left.rate) * (years - left.years)) / (right.years - left.years);
    }
  }
  return sorted[sorted.length - 1].rate;
}

/** Clean price after an instantaneous parallel yield shift (full revaluation, not the duration approximation). */
export function shockedPrice(terms: BondTerms, y: number, settlement: string, shiftBps: number) {
  return cleanPrice(terms, y + shiftBps / 10_000, settlement);
}

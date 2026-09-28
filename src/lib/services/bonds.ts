import 'server-only';

import { q } from '@/lib/db';
import { todayInNewYork } from '@/lib/dates';
import { memo } from '@/lib/data/http';
import { fetchFredSeries } from '@/lib/data/providers/fred';
import {
  accruedInterest,
  cashFlows,
  cleanPrice,
  type BondTerms,
  type CurvePoint,
  type DayCount,
  interpolateCurve,
  riskMeasures,
  shockedPrice,
  yearsBetween,
  yieldFromPrice,
} from '@/lib/finance/bonds';

export type BondKind = 'treasury' | 'agency' | 'corporate' | 'municipal' | 'cd' | 'other';

export type BondRow = {
  id: string;
  portfolio_id: string;
  name: string;
  cusip: string | null;
  kind: BondKind;
  face: number;
  coupon: number;
  frequency: number;
  maturity: string;
  purchase_date: string;
  purchase_price: number;
  market_price: number | null;
  spread_bps: number | null;
  day_count: DayCount;
  rating: string | null;
  note: string | null;
};

/** Constant-maturity Treasury yields on FRED (percent), keyed by tenor in years. */
const CURVE_SERIES: Array<{ id: string; years: number }> = [
  { id: 'DGS1MO', years: 1 / 12 },
  { id: 'DGS3MO', years: 0.25 },
  { id: 'DGS6MO', years: 0.5 },
  { id: 'DGS1', years: 1 },
  { id: 'DGS2', years: 2 },
  { id: 'DGS3', years: 3 },
  { id: 'DGS5', years: 5 },
  { id: 'DGS7', years: 7 },
  { id: 'DGS10', years: 10 },
  { id: 'DGS20', years: 20 },
  { id: 'DGS30', years: 30 },
];

export const SHOCKS_BPS = [-200, -100, -50, 50, 100, 200];

const today = () => todayInNewYork();

type CurveHistory = {
  latestDate: string | null;
  latest: CurvePoint[];
  /** Curve as of a date (last observation on or before it for each tenor). */
  at: (date: string) => CurvePoint[];
};

/** Treasury curve history from `start` to today (one FRED download per tenor, cached for 6 hours). */
export async function getTreasuryCurve(start: string): Promise<CurveHistory> {
  // Round the start down to the month so nearby requests share a cache entry.
  const from = `${start.slice(0, 7)}-01`;
  // A failed tenor fails the whole download, so a partial or empty curve is never cached (the caller falls back).
  const series = await memo(`fred:curve:${from}`, 6 * 3_600_000, async () =>
    Promise.all(
      CURVE_SERIES.map(async (tenor) => {
        const points = await fetchFredSeries(tenor.id, new Date(Date.parse(`${from}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10));
        if (!points.length) throw new Error(`FRED returned no data for ${tenor.id}`);
        return { years: tenor.years, points };
      }),
    ),
  );
  const at = (date: string) => {
    const curve: CurvePoint[] = [];
    for (const tenor of series) {
      let value: number | null = null;
      // Points are ascending; binary search for the last one on or before `date`.
      let low = 0;
      let high = tenor.points.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (tenor.points[mid].date <= date) {
          value = tenor.points[mid].value;
          low = mid + 1;
        } else high = mid - 1;
      }
      if (value !== null) curve.push({ years: tenor.years, rate: value / 100 });
    }
    return curve;
  };
  const latestDate = series.map((tenor) => tenor.points.at(-1)?.date ?? '').sort().at(-1) || null;
  return { latestDate, latest: at(today()), at };
}

export type BondValuation = {
  id: string;
  name: string;
  cusip: string | null;
  kind: BondKind;
  rating: string | null;
  note: string | null;
  face: number;
  coupon: number;
  frequency: number;
  maturity: string;
  purchaseDate: string;
  purchasePrice: number;
  marketPriceOverride: number | null;
  spreadOverride: number | null;
  dayCount: DayCount;
  matured: boolean;
  yearsToMaturity: number;
  cleanPrice: number;
  accrued: number;
  priceSource: 'quote' | 'curve' | 'purchase-yield';
  ytm: number | null;
  purchaseYield: number | null;
  treasuryYield: number | null;
  spreadBps: number | null;
  currentYield: number | null;
  marketValue: number;
  costBasis: number;
  unrealized: number;
  annualIncome: number;
  taxTreatment: 'taxable' | 'federal-exempt' | 'state-exempt';
  nextPayment: { date: string; amount: number } | null;
  macaulay: number;
  modifiedDuration: number;
  convexity: number;
  dv01: number;
  shocks: Array<{ bps: number; change: number }>;
};

function taxTreatment(kind: BondKind): BondValuation['taxTreatment'] {
  if (kind === 'municipal') return 'federal-exempt';
  if (kind === 'treasury') return 'state-exempt';
  return 'taxable';
}

/**
 * Values bonds without a price feed: the yield is today's Treasury curve at the bond's remaining
 * term plus the spread it was bought at (the purchase yield minus the curve on the purchase date).
 * A quoted price or a spread entered by hand takes precedence.
 */
export function valueBond(row: BondRow, curve: CurveHistory | null, settlement = today()): BondValuation {
  const terms: BondTerms = { coupon: row.coupon / 100, frequency: row.frequency, maturity: row.maturity, dayCount: row.day_count };
  const matured = row.maturity <= settlement;
  const purchaseYield = yieldFromPrice(terms, row.purchase_price, row.purchase_date);
  const purchaseCurve = curve ? interpolateCurve(curve.at(row.purchase_date), yearsBetween(row.purchase_date, row.maturity)) : null;
  const impliedSpread = purchaseYield !== null && purchaseCurve !== null ? (purchaseYield - purchaseCurve) * 10_000 : null;
  const spreadBps = row.spread_bps ?? impliedSpread;
  const yearsToMaturity = Math.max(0, yearsBetween(settlement, row.maturity));
  const treasuryYield = curve?.latest.length ? interpolateCurve(curve.latest, yearsToMaturity) : null;

  let ytm: number | null;
  let price: number;
  let priceSource: BondValuation['priceSource'];
  if (matured) {
    ytm = null;
    price = 100;
    priceSource = 'purchase-yield';
  } else if (row.market_price) {
    price = row.market_price;
    ytm = yieldFromPrice(terms, price, settlement);
    priceSource = 'quote';
  } else if (treasuryYield !== null) {
    ytm = treasuryYield + (spreadBps ?? 0) / 10_000;
    price = cleanPrice(terms, ytm, settlement);
    priceSource = 'curve';
  } else {
    ytm = purchaseYield ?? row.coupon / 100;
    price = cleanPrice(terms, ytm, settlement);
    priceSource = 'purchase-yield';
  }

  const scale = row.face / 100;
  const accrued = matured ? 0 : accruedInterest(terms, settlement);
  const risk = !matured && ytm !== null ? riskMeasures(terms, ytm, settlement) : { macaulay: 0, modified: 0, convexity: 0, dv01: 0 };
  const next = matured ? null : cashFlows(terms, settlement)[0];
  return {
    id: row.id,
    name: row.name,
    cusip: row.cusip,
    kind: row.kind,
    rating: row.rating,
    note: row.note,
    face: row.face,
    coupon: row.coupon,
    frequency: row.frequency,
    maturity: row.maturity,
    purchaseDate: row.purchase_date,
    purchasePrice: row.purchase_price,
    marketPriceOverride: row.market_price,
    spreadOverride: row.spread_bps,
    dayCount: row.day_count,
    matured,
    yearsToMaturity,
    cleanPrice: price,
    accrued: accrued * scale,
    priceSource,
    ytm,
    purchaseYield,
    treasuryYield,
    spreadBps: ytm !== null && treasuryYield !== null ? (ytm - treasuryYield) * 10_000 : spreadBps,
    currentYield: price > 0 && row.coupon ? row.coupon / price : null,
    // Matured bonds have paid out; they carry no value until removed.
    // A matured bond has repaid its face value. Until the redemption is recorded (as cash) and the bond
    // removed, count that principal so the portfolio total doesn't drop on maturity day.
    marketValue: matured ? scale * 100 : (price + accrued) * scale,
    costBasis: row.purchase_price * scale,
    unrealized: (price - row.purchase_price) * scale,
    annualIncome: matured ? 0 : (row.coupon / 100) * row.face,
    taxTreatment: taxTreatment(row.kind),
    nextPayment: next ? { date: next.date, amount: (next.coupon + next.principal) * scale } : null,
    macaulay: risk.macaulay,
    modifiedDuration: risk.modified,
    convexity: risk.convexity,
    dv01: risk.dv01 * scale,
    shocks: SHOCKS_BPS.map((bps) => ({ bps, change: matured || ytm === null ? 0 : (shockedPrice(terms, ytm, settlement, bps) - price) * scale })),
  };
}

export async function listBondRows(portfolioId: string) {
  return q<BondRow>(
    `select id, portfolio_id, name, cusip, kind, face, coupon, frequency, maturity::text as maturity, purchase_date::text as purchase_date,
       purchase_price, market_price, spread_bps, day_count, rating, note
     from public.bond_holdings where portfolio_id = $1 order by maturity`,
    [portfolioId],
  );
}

async function curveFor(rows: BondRow[]) {
  if (!rows.length) return null;
  const earliest = rows.map((row) => row.purchase_date).sort()[0];
  try {
    const curve = await getTreasuryCurve(earliest);
    return curve.latest.length ? curve : null;
  } catch {
    return null;
  }
}

/** Bond holdings valued, for the portfolio summary (market value including accrued interest). */
export async function getBondValues(portfolioId: string) {
  const rows = await listBondRows(portfolioId);
  const curve = await curveFor(rows);
  return rows.map((row) => valueBond(row, curve));
}

export async function getBondPortfolio(portfolioId: string) {
  const rows = await listBondRows(portfolioId);
  const curve = await curveFor(rows);
  const settlement = today();
  const bonds = rows.map((row) => valueBond(row, curve, settlement));
  const live = bonds.filter((bond) => !bond.matured);
  const marketValue = live.reduce((sum, bond) => sum + bond.marketValue, 0);
  const weighted = (pick: (bond: BondValuation) => number | null) =>
    marketValue > 0 ? live.reduce((sum, bond) => sum + (pick(bond) ?? 0) * bond.marketValue, 0) / marketValue : null;

  // Coupon and principal received each calendar year.
  const byYear = new Map<number, { coupon: number; principal: number }>();
  for (const row of rows) {
    const terms: BondTerms = { coupon: row.coupon / 100, frequency: row.frequency, maturity: row.maturity, dayCount: row.day_count };
    for (const flow of cashFlows(terms, settlement)) {
      const year = Number(flow.date.slice(0, 4));
      const entry = byYear.get(year) ?? { coupon: 0, principal: 0 };
      entry.coupon += (flow.coupon * row.face) / 100;
      entry.principal += (flow.principal * row.face) / 100;
      byYear.set(year, entry);
    }
  }

  const buckets = [
    { label: '< 1y', max: 1 },
    { label: '1–3y', max: 3 },
    { label: '3–5y', max: 5 },
    { label: '5–10y', max: 10 },
    { label: '10–20y', max: 20 },
    { label: '20y +', max: Infinity },
  ].map((bucket, index, all) => {
    const min = index ? all[index - 1].max : 0;
    const value = live.filter((bond) => bond.yearsToMaturity >= min && bond.yearsToMaturity < bucket.max).reduce((sum, bond) => sum + bond.marketValue, 0);
    return { label: bucket.label, value, weight: marketValue > 0 ? value / marketValue : 0 };
  });

  return {
    bonds,
    curve: curve ? { date: curve.latestDate, points: curve.latest } : null,
    summary: {
      marketValue,
      face: live.reduce((sum, bond) => sum + bond.face, 0),
      costBasis: live.reduce((sum, bond) => sum + bond.costBasis, 0),
      unrealized: live.reduce((sum, bond) => sum + bond.unrealized, 0),
      accrued: live.reduce((sum, bond) => sum + bond.accrued, 0),
      annualIncome: live.reduce((sum, bond) => sum + bond.annualIncome, 0),
      taxExemptIncome: live.filter((bond) => bond.taxTreatment === 'federal-exempt').reduce((sum, bond) => sum + bond.annualIncome, 0),
      ytm: weighted((bond) => bond.ytm),
      modifiedDuration: weighted((bond) => bond.modifiedDuration),
      convexity: weighted((bond) => bond.convexity),
      yearsToMaturity: weighted((bond) => bond.yearsToMaturity),
      dv01: live.reduce((sum, bond) => sum + bond.dv01, 0),
      shocks: SHOCKS_BPS.map((bps) => ({ bps, change: live.reduce((sum, bond) => sum + (bond.shocks.find((shock) => shock.bps === bps)?.change ?? 0), 0) })),
      matured: bonds.length - live.length,
    },
    cashFlows: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, flow]) => ({ year, ...flow })),
    ladder: buckets,
  };
}

import 'server-only';

import { cached } from '@/lib/data/http';
import { fetchAnalystEstimates, fmpEnabled } from '@/lib/data/providers/fmp';
import { fetchFredSeries } from '@/lib/data/providers/fred';
import { usdPerUnit } from '@/lib/data/providers/fx';
import { fetchYearlyEpsForecast } from '@/lib/data/providers/nasdaq';
import { betaFromCloses } from '@/lib/finance/stats';
import { periodValue, type StatementPeriod } from '@/lib/finance/statement-types';
import { getLiveQuote } from '@/lib/services/market';
import { getCandles } from '@/lib/services/prices';
import { benchmarkCandles } from '@/lib/services/scores';
import { getCompanyStatements } from '@/lib/services/statements';
import { getSecurity } from '@/lib/services/universe';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function ratio(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator !== null && denominator !== 0 ? numerator / denominator : null;
}

/** Average of a ratio across the latest annual periods, skipping years where it is missing. */
function averageRatio(periods: StatementPeriod[], pick: (period: StatementPeriod) => number | null) {
  const values = periods.map(pick).filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

async function riskFreeRate() {
  return cached('dcf:dgs10', 12 * 3600, async () => {
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const points = await fetchFredSeries('DGS10', start);
    const last = points.at(-1);
    return last ? { rate: last.value / 100, asOf: last.date } : null;
  }).catch(() => null);
}

/** Everything the DCF tab needs: history, balance-sheet bridge, market inputs, analyst forecasts and suggested defaults. */
export async function getDcfInputs(symbol: string) {
  const upper = symbol.toUpperCase();
  const [statements, security, quote, candles, spy, riskFree, epsForecast, estimates] = await Promise.all([
    getCompanyStatements(upper),
    getSecurity(upper),
    getLiveQuote(upper).catch(() => null),
    getCandles(upper, 2).catch(() => []),
    benchmarkCandles().catch(() => []),
    riskFreeRate(),
    cached(`dcf:eps-forecast:${upper}`, 12 * 3600, () => fetchYearlyEpsForecast(upper)).catch(() => []),
    fmpEnabled() ? cached(`dcf:estimates:${upper}`, 24 * 3600, () => fetchAnalystEstimates(upper)).catch(() => []) : Promise.resolve([]),
  ]);

  const annual = (statements?.annual ?? []).filter((period) => periodValue(period, 'revenue') !== null).slice(0, 5);
  const latest = annual[0] ?? null;
  const ttm = statements?.ttm && periodValue(statements.ttm, 'revenue') !== null ? statements.ttm : null;
  const base = ttm ?? latest;
  const currency = statements?.currency ?? 'USD';
  const fxToUsd = (await usdPerUnit(currency)) ?? 1;
  // Balance sheet items are point-in-time: take them from the latest quarter when there is one.
  const balance = statements?.quarterly?.[0] ?? latest;
  // Some items (leases especially) are only tagged in the annual report's notes: fall back to the latest annual.
  const point = (key: 'leaseLiabilities' | 'minorityInterest' | 'preferredStock') => periodValue(balance, key) ?? periodValue(latest, key);

  const history = [...annual].reverse().map((period) => ({
    label: period.label,
    revenue: periodValue(period, 'revenue'),
    ebit: periodValue(period, 'operatingIncome'),
    ebitMargin: periodValue(period, 'operatingMargin'),
    da: periodValue(period, 'depreciationAmortization'),
    capex: periodValue(period, 'capex') === null ? null : Math.abs(periodValue(period, 'capex') as number),
    sbc: periodValue(period, 'stockBasedCompensation'),
    freeCashFlow: periodValue(period, 'freeCashFlow'),
    taxRate: ratio(periodValue(period, 'taxExpense'), periodValue(period, 'pretaxIncome')),
  }));

  // Historical ratios → suggested defaults.
  const revenueOf = (period: StatementPeriod) => periodValue(period, 'revenue');
  const taxRate = clamp(averageRatio(annual.slice(0, 3), (p) => ratio(periodValue(p, 'taxExpense'), periodValue(p, 'pretaxIncome'))) ?? 0.21, 0, 0.35);
  const daPct = clamp(averageRatio(annual.slice(0, 3), (p) => ratio(periodValue(p, 'depreciationAmortization'), revenueOf(p))) ?? 0.04, 0, 0.5);
  const capexPct = clamp(averageRatio(annual.slice(0, 3), (p) => ratio(Math.abs(periodValue(p, 'capex') ?? NaN), revenueOf(p))) ?? daPct, 0, 0.6);
  const sbcPct = clamp(averageRatio(annual.slice(0, 3), (p) => ratio(periodValue(p, 'stockBasedCompensation'), revenueOf(p))) ?? 0, 0, 0.5);
  const ebitMargin = clamp(
    (base ? ratio(periodValue(base, 'operatingIncome'), periodValue(base, 'revenue')) : null) ?? averageRatio(annual.slice(0, 3), (p) => periodValue(p, 'operatingMargin')) ?? 0.1,
    -0.5,
    0.7,
  );
  const nwc = balance
    ? (periodValue(balance, 'receivables') ?? 0) + (periodValue(balance, 'inventory') ?? 0) - (periodValue(balance, 'accountsPayable') ?? 0)
    : null;
  const nwcPct = clamp(ratio(nwc, base ? periodValue(base, 'revenue') : null) ?? 0.05, -0.3, 0.5);
  const cagr3 = annual.length >= 4 && revenueOf(annual[0]) && revenueOf(annual[3]) && (revenueOf(annual[3]) as number) > 0
    ? ((revenueOf(annual[0]) as number) / (revenueOf(annual[3]) as number)) ** (1 / 3) - 1
    : null;

  // Analyst forecasts: FMP revenue estimates when available, Nasdaq consensus EPS otherwise.
  const baseRevenue = base ? periodValue(base, 'revenue') : null;
  const analystRevenue = estimates.filter((row) => row.revenue !== null).slice(0, 5);
  const analystGrowth: number[] = [];
  let previousRevenue = latest ? revenueOf(latest) : null;
  for (const row of analystRevenue) {
    if (previousRevenue && row.revenue) analystGrowth.push(row.revenue / previousRevenue - 1);
    previousRevenue = row.revenue;
  }
  const trailingEps = base ? periodValue(base, 'epsDiluted') : null;
  const epsGrowth = epsForecast.length && trailingEps && trailingEps > 0 && epsForecast[0].eps ? (epsForecast[0].eps as number) / trailingEps - 1 : null;
  const firstYearGrowth = clamp(analystGrowth[0] ?? cagr3 ?? epsGrowth ?? 0.05, -0.3, 0.6);

  // Discount rate inputs.
  const rawBeta = candles.length && spy.length ? betaFromCloses(candles, spy, 504) : null;
  const beta = rawBeta !== null && Number.isFinite(rawBeta) ? clamp(rawBeta, 0.3, 3) : 1;
  const debt = balance ? periodValue(balance, 'totalDebt') ?? 0 : 0;
  const interest = base ? periodValue(base, 'interestExpense') : null;
  const rf = riskFree?.rate ?? 0.043;
  const costOfDebt = clamp(interest !== null && debt > 0 ? Math.abs(interest) / debt : rf + 0.015, rf, 0.15);
  const shares = statements?.sharesOutstanding?.value ?? (base ? periodValue(base, 'sharesDiluted') : null) ?? null;
  const price = quote?.price ?? security?.price ?? null;

  return {
    symbol: upper,
    name: security?.name ?? statements?.entityName ?? upper,
    currency,
    fxToUsd,
    price,
    marketCap: security?.market_cap ?? (price !== null && shares ? price * shares * fxToUsd : null),
    baseLabel: base?.label ?? null,
    baseRevenue,
    history,
    bridge: {
      asOf: balance?.label ?? null,
      cash: (periodValue(balance, 'cash') ?? 0) + (periodValue(balance, 'shortTermInvestments') ?? 0),
      debt,
      leases: point('leaseLiabilities'),
      minorityInterest: point('minorityInterest'),
      preferredStock: point('preferredStock'),
      shares,
      sharesAsOf: statements?.sharesOutstanding?.asOf ?? null,
    },
    market: {
      riskFree: rf,
      riskFreeAsOf: riskFree?.asOf ?? null,
      beta,
      rawBeta,
      equityRiskPremium: 0.05,
      costOfDebt,
    },
    forecasts: {
      revenue: analystRevenue.map((row, index) => ({ ...row, growth: analystGrowth[index] ?? null })),
      eps: epsForecast,
      trailingEps,
      source: analystRevenue.length ? 'FMP consensus' : epsForecast.length ? 'Nasdaq consensus EPS' : null,
      growthSeed: analystGrowth.length ? 'analyst revenue estimates' : cagr3 !== null ? '3-year revenue CAGR' : epsGrowth !== null ? 'consensus EPS growth' : 'a 5% placeholder',
      fmpEnabled: fmpEnabled(),
    },
    defaults: {
      firstYearGrowth,
      analystGrowth: analystGrowth.map((value) => clamp(value, -0.3, 0.6)),
      cagr3,
      ebitMargin,
      taxRate,
      daPct,
      capexPct,
      nwcPct,
      sbcPct,
      terminalGrowth: 0.025,
    },
  };
}

export type DcfInputs = Awaited<ReturnType<typeof getDcfInputs>>;

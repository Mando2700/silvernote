import 'server-only';

import { cached } from '@/lib/data/http';
import { fetchFrenchDaily } from '@/lib/data/providers/french';
import { brinson, ols, rebalance } from '@/lib/finance/analytics';
import { q } from '@/lib/db';
import { getCompanyProfile, getQuotes } from '@/lib/services/market';
import { buildRiskModel, getHoldings, portfolioReturns, type PortfolioRow } from '@/lib/services/portfolio';
import { getCandles, getCandlesForMany } from '@/lib/services/prices';
import { getUniverse } from '@/lib/services/screener';

/** Daily candles are stamped at midnight UTC of their trading date. */
const candleDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

// ─── Targets & rebalancing ──────────────────────────────────────────────────

export async function getTargets(portfolioId: string) {
  const [row] = await q<{ targets: Record<string, number> }>('select targets from public.portfolios where id = $1', [portfolioId]);
  return row?.targets ?? {};
}

export async function setTargets(userId: string, portfolioId: string, targets: Record<string, number>) {
  const clean = Object.fromEntries(Object.entries(targets).filter(([, weight]) => weight > 0).map(([symbol, weight]) => [symbol.toUpperCase(), Math.min(1, weight)]));
  await q('update public.portfolios set targets = $3::jsonb where id = $1 and user_id = $2', [portfolioId, userId, JSON.stringify(clean)]);
  return clean;
}

export async function rebalancePlan(portfolio: PortfolioRow, options: { addCash?: number; fractional?: boolean; minTrade?: number; sellUntargeted?: boolean; targets?: Record<string, number> }) {
  const [{ holdings, summary }, stored] = await Promise.all([getHoldings(portfolio), getTargets(portfolio.id)]);
  const targets = options.targets ?? stored;
  const missing = Object.keys(targets).filter((symbol) => !holdings.some((holding) => holding.symbol === symbol));
  const quotes = missing.length ? await getQuotes(missing) : {};
  const plan = rebalance(
    holdings.map((holding) => ({ symbol: holding.symbol, price: holding.price, marketValue: holding.marketValue })),
    targets,
    { cash: summary.cash, addCash: options.addCash, fractional: options.fractional, minTrade: options.minTrade, sellUntargeted: options.sellUntargeted, prices: Object.fromEntries(missing.map((symbol) => [symbol, quotes[symbol]?.price ?? null])) },
  );
  return { ...plan, targets };
}

// ─── Factor exposure (Fama-French 5 + momentum) ─────────────────────────────

const FACTORS = [
  { key: 'mktRf', label: 'Market', explain: 'Sensitivity to the US stock market (1 = moves with it).' },
  { key: 'smb', label: 'Size (SMB)', explain: 'Positive = tilted to small caps.' },
  { key: 'hml', label: 'Value (HML)', explain: 'Positive = cheap, high book-to-market stocks; negative = growth.' },
  { key: 'rmw', label: 'Profitability (RMW)', explain: 'Positive = robust operating profitability.' },
  { key: 'cma', label: 'Investment (CMA)', explain: 'Positive = conservative asset growth.' },
  { key: 'mom', label: 'Momentum', explain: 'Positive = recent winners.' },
] as const;

export async function factorExposure(portfolio: PortfolioRow, lookbackDays = 504) {
  const [{ holdings }, factors] = await Promise.all([getHoldings(portfolio), cached('french:daily:v1', 7 * 86_400, fetchFrenchDaily)]);
  const model = await buildRiskModel(holdings, portfolio.benchmark, lookbackDays);
  const byDate = new Map(factors.map((row) => [row.date, row]));
  const regress = (series: number[]) => {
    const y: number[] = [];
    const xs: number[][] = [];
    model.dates.forEach((t, index) => {
      const factor = byDate.get(candleDate(t));
      if (!factor) return;
      y.push(series[index] - factor.rf);
      xs.push(FACTORS.map((item) => factor[item.key]));
    });
    const fit = ols(y, xs);
    return fit ? { fit, days: y.length } : null;
  };
  const whole = regress(portfolioReturns(model));
  const perHolding = model.symbols.map((symbol, index) => {
    const result = regress(model.returns[index]);
    return { symbol, weight: model.weights[index], loadings: result ? Object.fromEntries(FACTORS.map((item, i) => [item.key, result.fit.coefficients[i + 1]])) : null, r2: result?.fit.r2 ?? null };
  });
  const covered = factors.at(-1)?.date ?? null;
  return {
    factors: FACTORS,
    portfolio: whole
      ? {
          // Daily alpha, annualized.
          alpha: whole.fit.coefficients[0] * 252,
          alphaT: whole.fit.tStats[0],
          loadings: FACTORS.map((item, i) => ({ ...item, beta: whole.fit.coefficients[i + 1], t: whole.fit.tStats[i + 1] })),
          r2: whole.fit.r2,
          days: whole.days,
        }
      : null,
    holdings: perHolding,
    dataThrough: covered,
    excluded: model.excluded,
    source: 'Kenneth R. French Data Library (Fama-French 5 factors + momentum, daily)',
  };
}

// ─── Brinson attribution vs the S&P 500 by sector ───────────────────────────

const SECTOR_ETFS: Record<string, string> = {
  'Information Technology': 'XLK',
  Financials: 'XLF',
  'Health Care': 'XLV',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP',
  Energy: 'XLE',
  Industrials: 'XLI',
  Materials: 'XLB',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
  'Communication Services': 'XLC',
};

function returnSince(candles: Array<{ t: number; c: number }>, since: number) {
  const start = candles.find((candle) => candle.t >= since);
  const end = candles.at(-1);
  return start && end && start.c > 0 ? { value: end.c / start.c - 1, startPrice: start.c } : null;
}

/**
 * Holdings-based Brinson-Fachler: today's positions held over the period against the S&P 500 split
 * into its sectors (weights from the 500 largest US companies, returns from the sector SPDR funds).
 */
export async function attribution(portfolio: PortfolioRow, days = 365) {
  const since = Math.floor(Date.now() / 1000) - days * 86_400;
  const [{ holdings }, universe] = await Promise.all([getHoldings(portfolio), getUniverse()]);
  const largest = universe.filter((entry) => entry.marketCap && entry.sector && entry.country === 'United States').sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, 500);
  const capTotal = largest.reduce((sum, entry) => sum + (entry.marketCap ?? 0), 0);
  const benchmarkWeights = new Map<string, number>();
  for (const entry of largest) benchmarkWeights.set(entry.sector as string, (benchmarkWeights.get(entry.sector as string) ?? 0) + (entry.marketCap ?? 0) / capTotal);

  const years = days / 365 + 0.1;
  const [etfCandles, holdingCandles, spy] = await Promise.all([
    getCandlesForMany(Object.values(SECTOR_ETFS), years),
    getCandlesForMany(holdings.map((holding) => holding.symbol), years),
    getCandles('SPY', years),
  ]);
  // Start-of-period value of each current position (its shares at the period's first price).
  const positions = holdings
    .map((holding) => {
      const result = returnSince(holdingCandles.get(holding.symbol) ?? [], since);
      return result ? { sector: holding.sector ?? 'Other', startValue: result.startPrice * holding.shares, ret: result.value } : null;
    })
    .filter((row): row is { sector: string; startValue: number; ret: number } => row !== null);
  const startTotal = positions.reduce((sum, row) => sum + row.startValue, 0);
  const sectors = new Set([...benchmarkWeights.keys(), ...positions.map((row) => row.sector)]);
  const segments = [...sectors].map((sector) => {
    const mine = positions.filter((row) => row.sector === sector);
    const weight = mine.reduce((sum, row) => sum + row.startValue, 0) / (startTotal || 1);
    const ret = weight > 0 ? mine.reduce((sum, row) => sum + row.startValue * row.ret, 0) / mine.reduce((sum, row) => sum + row.startValue, 0) : 0;
    const etf = SECTOR_ETFS[sector];
    const benchmarkReturn = etf ? (returnSince(etfCandles.get(etf) ?? [], since)?.value ?? 0) : 0;
    return { segment: sector, portfolioWeight: weight, portfolioReturn: weight > 0 ? ret : benchmarkReturn, benchmarkWeight: benchmarkWeights.get(sector) ?? 0, benchmarkReturn };
  });
  const result = brinson(segments.filter((row) => row.portfolioWeight > 0 || row.benchmarkWeight > 0));
  return {
    ...result,
    rows: result.rows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
    spyReturn: returnSince(spy, since)?.value ?? null,
    days,
    method: 'Holdings-based Brinson-Fachler: current positions held through the period vs S&P 500 sector weights and sector SPDR returns.',
  };
}

// ─── Dividend income forecast ───────────────────────────────────────────────

export async function dividendForecast(portfolio: PortfolioRow) {
  const { holdings } = await getHoldings(portfolio);
  const rows = await Promise.all(
    holdings.map(async (holding) => {
      const profile = await getCompanyProfile(holding.symbol).catch(() => null);
      const perShare = profile?.annualDividend ?? null;
      const annual = perShare ? perShare * holding.shares : 0;
      return {
        symbol: holding.symbol,
        name: holding.name,
        shares: holding.shares,
        annualPerShare: perShare,
        annualIncome: annual,
        yield: perShare && holding.price ? perShare / holding.price : null,
        yieldOnCost: perShare && holding.avgCost ? perShare / holding.avgCost : null,
        exDividendDate: profile?.exDividendDate ?? null,
      };
    }),
  );
  // Assume quarterly payments continuing the last ex-date's cycle (most US payers); shown as an estimate.
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + index);
    return { month: date.toISOString().slice(0, 7), income: 0, symbols: [] as string[] };
  });
  for (const row of rows) {
    if (!row.annualIncome) continue;
    const ex = row.exDividendDate ? new Date(row.exDividendDate) : null;
    const anchor = ex && Number.isFinite(ex.getTime()) ? ex.getUTCMonth() : 2;
    for (const month of months) {
      const monthIndex = Number(month.month.slice(5, 7)) - 1;
      if ((monthIndex - anchor + 12) % 3 === 0) {
        month.income += row.annualIncome / 4;
        month.symbols.push(row.symbol);
      }
    }
  }
  const total = rows.reduce((sum, row) => sum + row.annualIncome, 0);
  const value = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  return { rows: rows.sort((a, b) => b.annualIncome - a.annualIncome), months, annualIncome: total, portfolioYield: value > 0 ? total / value : null };
}

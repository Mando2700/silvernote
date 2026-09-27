/// <reference lib="webworker" />

/**
 * Monte Carlo projection of a constant-weight (monthly rebalanced) portfolio.
 *
 * - "bootstrap": resamples overlapping 21-trading-day blocks of the portfolio's own historical daily
 *   returns, so fat tails, skew and volatility clustering inside a month are preserved.
 * - "normal": lognormal (geometric Brownian motion) with the historical daily mean and volatility
 *   of the weighted portfolio (asset correlations are already inside that volatility).
 */

export type MonteCarloInput = {
  weights: number[];
  returns: number[][];
  startValue: number;
  monthlyContribution: number;
  years: number;
  simulations: number;
  method: 'bootstrap' | 'normal';
  target?: number | null;
  /** Re-centre the expected annual return (keeps historical volatility and shape); null = historical. */
  annualReturn?: number | null;
  seed?: number;
};

export type MonteCarloResult = {
  months: number;
  percentiles: Record<'p5' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'p95', number[]>;
  contributions: number[];
  finalValues: number[];
  probabilityOfLoss: number;
  probabilityOfTarget: number | null;
  medianCagr: number;
  medianMaxDrawdown: number;
  worstMaxDrawdown: number;
  historicalMonthlyMean: number;
  historicalMonthlyVol: number;
  elapsedMs: number;
};

const BLOCK = 21;

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sorted: Float64Array, p: number) {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function simulate(input: MonteCarloInput): MonteCarloResult {
  const started = performance.now();
  const days = input.returns[0]?.length ?? 0;
  const portfolio = new Float64Array(days);
  input.weights.forEach((weight, asset) => {
    const series = input.returns[asset];
    for (let day = 0; day < days; day += 1) portfolio[day] += weight * series[day];
  });

  // Overlapping monthly blocks of compounded daily returns.
  const blocks: number[] = [];
  for (let start = 0; start + BLOCK <= days; start += 1) {
    let growth = 1;
    for (let day = start; day < start + BLOCK; day += 1) growth *= 1 + portfolio[day];
    blocks.push(growth - 1);
  }
  let dailyMean = 0;
  for (let day = 0; day < days; day += 1) dailyMean += portfolio[day];
  dailyMean /= Math.max(1, days);
  let dailyVariance = 0;
  for (let day = 0; day < days; day += 1) dailyVariance += (portfolio[day] - dailyMean) ** 2;
  dailyVariance /= Math.max(1, days - 1);
  let monthlyDrift = (dailyMean - dailyVariance / 2) * BLOCK;
  const monthlyVol = Math.sqrt(dailyVariance * BLOCK);
  if (typeof input.annualReturn === 'number' && Number.isFinite(input.annualReturn)) {
    const targetMonthly = (1 + input.annualReturn) ** (1 / 12) - 1;
    const blockMean = blocks.length ? blocks.reduce((sum, value) => sum + value, 0) / blocks.length : 0;
    for (let index = 0; index < blocks.length; index += 1) blocks[index] = blocks[index] - blockMean + targetMonthly;
    monthlyDrift = Math.log(1 + targetMonthly) - (monthlyVol * monthlyVol) / 2;
  }

  const months = Math.round(input.years * 12);
  const sims = input.simulations;
  const random = mulberry32(input.seed ?? 1234567);
  const values = new Float64Array(sims * (months + 1));
  const finals = new Float64Array(sims);
  const drawdowns = new Float64Array(sims);

  for (let sim = 0; sim < sims; sim += 1) {
    let value = input.startValue;
    let peak = value;
    let worst = 0;
    values[sim * (months + 1)] = value;
    for (let month = 1; month <= months; month += 1) {
      const monthlyReturn =
        input.method === 'bootstrap' && blocks.length
          ? blocks[Math.floor(random() * blocks.length)]
          : Math.exp(monthlyDrift + monthlyVol * normal(random)) - 1;
      value = Math.max(0, value * (1 + monthlyReturn) + input.monthlyContribution);
      values[sim * (months + 1) + month] = value;
      if (value > peak) peak = value;
      if (peak > 0) worst = Math.min(worst, value / peak - 1);
    }
    finals[sim] = value;
    drawdowns[sim] = worst;
  }

  const levels = { p5: 0.05, p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9, p95: 0.95 } as const;
  const percentiles = { p5: [], p10: [], p25: [], p50: [], p75: [], p90: [], p95: [] } as MonteCarloResult['percentiles'];
  const column = new Float64Array(sims);
  for (let month = 0; month <= months; month += 1) {
    for (let sim = 0; sim < sims; sim += 1) column[sim] = values[sim * (months + 1) + month];
    column.sort();
    for (const [key, p] of Object.entries(levels) as Array<[keyof typeof levels, number]>) percentiles[key].push(quantile(column, p));
  }
  const contributions = Array.from({ length: months + 1 }, (_, month) => input.startValue + input.monthlyContribution * month);
  const invested = contributions[months];
  const sortedFinals = Float64Array.from(finals).sort();
  const sortedDrawdowns = Float64Array.from(drawdowns).sort();
  let losses = 0;
  let hits = 0;
  for (let sim = 0; sim < sims; sim += 1) {
    if (finals[sim] < invested) losses += 1;
    if (input.target && finals[sim] >= input.target) hits += 1;
  }
  const medianFinal = quantile(sortedFinals, 0.5);
  // Money-weighted growth is ambiguous with contributions; report the start-to-median CAGR only without them.
  const medianCagr = input.monthlyContribution === 0 && input.startValue > 0 ? (medianFinal / input.startValue) ** (1 / input.years) - 1 : NaN;

  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(sims / 2000));
  for (let sim = 0; sim < sims; sim += stride) sample.push(finals[sim]);

  return {
    months,
    percentiles,
    contributions,
    finalValues: sample,
    probabilityOfLoss: losses / sims,
    probabilityOfTarget: input.target ? hits / sims : null,
    medianCagr,
    medianMaxDrawdown: quantile(sortedDrawdowns, 0.5),
    worstMaxDrawdown: quantile(sortedDrawdowns, 0.05),
    historicalMonthlyMean: Math.exp(monthlyDrift) - 1,
    historicalMonthlyVol: monthlyVol,
    elapsedMs: performance.now() - started,
  };
}

// Only wire up messaging inside a real worker (the module is also imported by unit tests).
if (typeof self !== 'undefined' && typeof (self as { postMessage?: unknown }).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<MonteCarloInput>) => {
    try {
      self.postMessage({ ok: true, result: simulate(event.data) });
    } catch (error) {
      self.postMessage({ ok: false, error: (error as Error).message });
    }
  };
}

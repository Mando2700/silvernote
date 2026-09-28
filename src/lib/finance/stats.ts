/** Pure statistics used by portfolio analytics, the score data layer and simulations. */

export const TRADING_DAYS = 252;

export function mean(values: number[]) {
  if (!values.length) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

export function variance(values: number[], sample = true) {
  if (values.length < 2) return 0;
  const m = mean(values);
  let total = 0;
  for (const value of values) total += (value - m) ** 2;
  return total / (values.length - (sample ? 1 : 0));
}

export function stdev(values: number[]) {
  return Math.sqrt(variance(values));
}

export function covariance(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let total = 0;
  for (let index = 0; index < n; index += 1) total += (a[index] - ma) * (b[index] - mb);
  return total / (n - 1);
}

export function correlation(a: number[], b: number[]) {
  const sa = stdev(a);
  const sb = stdev(b);
  if (!sa || !sb) return 0;
  return covariance(a, b) / (sa * sb);
}

export function quantile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export type DatedClose = { t: number; c: number };

/** Simple daily returns keyed by the day of the later close. */
export function dailyReturns(series: DatedClose[]) {
  const map = new Map<number, number>();
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1].c;
    const current = series[index].c;
    if (previous > 0 && current > 0) map.set(series[index].t, current / previous - 1);
  }
  return map;
}

/** Align several return maps on the dates they all share. */
export function alignReturns(maps: Array<Map<number, number>>) {
  if (!maps.length) return { dates: [] as number[], matrix: [] as number[][] };
  const dates = [...maps[0].keys()].filter((date) => maps.every((map) => map.has(date))).sort((a, b) => a - b);
  return { dates, matrix: maps.map((map) => dates.map((date) => map.get(date) as number)) };
}

/**
 * Align return maps on the benchmark's dates, filling days an asset has no price (e.g. before it
 * listed) with beta × benchmark plus the asset's own demeaned residuals, so one young holding does
 * not truncate everyone's history. Residuals are demeaned so a short hot run is not extended as alpha.
 */
export function backfillReturns(maps: Array<Map<number, number>>, benchmark: Map<number, number>) {
  const dates = [...benchmark.keys()].sort((a, b) => a - b);
  const market = dates.map((date) => benchmark.get(date) as number);
  const firstReal: number[] = [];
  const matrix = maps.map((map) => {
    const own: number[] = [];
    const ref: number[] = [];
    dates.forEach((date, index) => {
      if (!map.has(date)) return;
      own.push(map.get(date) as number);
      ref.push(market[index]);
    });
    const raw = beta(own, ref);
    const b = raw !== null && Number.isFinite(raw) ? Math.max(0, Math.min(3, raw)) : 1;
    const residuals = own.map((value, index) => value - b * ref[index]);
    const residualMean = mean(residuals);
    let cursor = 0;
    firstReal.push(Math.max(0, dates.findIndex((date) => map.has(date))));
    return dates.map((date, index) => {
      if (map.has(date)) return map.get(date) as number;
      const noise = residuals.length ? residuals[cursor++ % residuals.length] - residualMean : 0;
      return Math.max(-0.95, b * market[index] + noise);
    });
  });
  return { dates, matrix, market, firstReal };
}

export function beta(asset: number[], market: number[]) {
  const varMarket = variance(market);
  if (!varMarket) return null;
  return covariance(asset, market) / varMarket;
}

export function annualizedReturn(returns: number[]) {
  if (!returns.length) return 0;
  let growth = 1;
  for (const value of returns) growth *= 1 + value;
  return growth ** (TRADING_DAYS / returns.length) - 1;
}

export function annualizedVolatility(returns: number[]) {
  return stdev(returns) * Math.sqrt(TRADING_DAYS);
}

export function downsideDeviation(returns: number[], dailyTarget = 0) {
  if (!returns.length) return 0;
  let total = 0;
  for (const value of returns) {
    const shortfall = Math.min(0, value - dailyTarget);
    total += shortfall * shortfall;
  }
  return Math.sqrt(total / returns.length) * Math.sqrt(TRADING_DAYS);
}

export function sharpe(returns: number[], riskFree: number) {
  const vol = annualizedVolatility(returns);
  if (!vol) return null;
  return (annualizedReturn(returns) - riskFree) / vol;
}

export function sortino(returns: number[], riskFree: number) {
  const downside = downsideDeviation(returns, riskFree / TRADING_DAYS);
  if (!downside) return null;
  return (annualizedReturn(returns) - riskFree) / downside;
}

/** Cumulative value path from returns (starting at 1). */
export function equityCurve(returns: number[]) {
  const curve = [1];
  for (const value of returns) curve.push(curve[curve.length - 1] * (1 + value));
  return curve;
}

export function maxDrawdown(curve: number[]) {
  let peak = curve[0] ?? 1;
  let worst = 0;
  let peakIndex = 0;
  let troughIndex = 0;
  let bestPeakIndex = 0;
  for (let index = 0; index < curve.length; index += 1) {
    if (curve[index] > peak) {
      peak = curve[index];
      peakIndex = index;
    }
    const drawdown = peak > 0 ? curve[index] / peak - 1 : 0;
    if (drawdown < worst) {
      worst = drawdown;
      troughIndex = index;
      bestPeakIndex = peakIndex;
    }
  }
  return { value: worst, peakIndex: bestPeakIndex, troughIndex };
}

/** Historical and parametric (normal) value-at-risk as positive loss fractions. */
export function valueAtRisk(returns: number[], confidence = 0.95, horizonDays = 1) {
  if (returns.length < 20) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = quantile(sorted, 1 - confidence);
  const tail = sorted.filter((value) => value <= cutoff);
  const z = confidence >= 0.99 ? 2.3263 : confidence >= 0.975 ? 1.96 : 1.6449;
  const scale = Math.sqrt(horizonDays);
  return {
    historical: -cutoff * scale,
    expectedShortfall: -(tail.length ? mean(tail) : cutoff) * scale,
    // Volatility grows with √horizon, the expected return with the horizon itself.
    parametric: z * stdev(returns) * scale - mean(returns) * horizonDays,
  };
}

/** Herfindahl–Hirschman index of weights and the equivalent number of equal positions. */
export function concentration(weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (!total) return { hhi: 0, effectiveN: 0, top1: 0, top5: 0 };
  const normalized = weights.map((weight) => Math.max(0, weight) / total).sort((a, b) => b - a);
  const hhi = normalized.reduce((sum, weight) => sum + weight * weight, 0);
  return {
    hhi,
    effectiveN: hhi ? 1 / hhi : 0,
    top1: normalized[0] ?? 0,
    top5: normalized.slice(0, 5).reduce((sum, weight) => sum + weight, 0),
  };
}

/** Lower-triangular Cholesky factor; tiny negative pivots are floored so near-singular matrices still work. */
export function cholesky(matrix: number[][]) {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      let sum = matrix[row][col];
      for (let k = 0; k < col; k += 1) sum -= lower[row][k] * lower[col][k];
      if (row === col) lower[row][col] = Math.sqrt(Math.max(sum, 1e-12));
      else lower[row][col] = sum / lower[col][col];
    }
  }
  return lower;
}

/** Beta of an asset's closes against a benchmark's closes over their common dates (last N days). */
export function betaFromCloses(asset: DatedClose[], benchmark: DatedClose[], lookbackDays = 252) {
  const { matrix } = alignReturns([dailyReturns(asset), dailyReturns(benchmark)]);
  const [a, b] = matrix;
  if (!a || a.length < 60) return null;
  return beta(a.slice(-lookbackDays), b.slice(-lookbackDays));
}

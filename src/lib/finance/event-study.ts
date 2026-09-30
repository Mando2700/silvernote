import { ols } from '@/lib/finance/analytics';

export type Closes = Array<{ t: number; c: number }>;

export type EventResult = {
  date: string;
  /** Trading date the event was aligned to (the first session on or after `date`). */
  aligned: string | null;
  alpha: number;
  beta: number;
  sigma: number;
  /** Abnormal return per relative day from `window[0]` to `window[1]`. */
  abnormal: Array<{ day: number; ar: number; car: number }>;
  car: number;
  t: number;
  error?: string;
};

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

function returnsByDate(closes: Closes) {
  const map = new Map<string, number>();
  for (let index = 1; index < closes.length; index += 1) map.set(iso(closes[index].t), closes[index].c / closes[index - 1].c - 1);
  return map;
}

/**
 * Market-model event study (MacKinlay 1997): estimate r = α + β·rm over the estimation window before
 * each event, then abnormal returns AR = r − (α + β·rm) over the event window, CAR = ΣAR and
 * t = CAR / (σ·√L). Across events: CAAR with a cross-sectional t-statistic.
 */
export function eventStudy(
  stock: Closes,
  market: Closes,
  events: string[],
  options: { window?: [number, number]; estimation?: [number, number] } = {},
) {
  const [before, after] = options.window ?? [-5, 5];
  const [estStart, estEnd] = options.estimation ?? [-250, -30];
  const stockReturns = returnsByDate(stock);
  const marketReturns = returnsByDate(market);
  const dates = [...stockReturns.keys()].filter((date) => marketReturns.has(date)).sort();
  const results: EventResult[] = events.map((date) => {
    const zero = dates.findIndex((day) => day >= date);
    const empty = { date, aligned: null, alpha: 0, beta: 0, sigma: 0, abnormal: [], car: 0, t: 0 };
    if (zero === -1 || zero + estStart < 0 || zero + after >= dates.length) return { ...empty, error: 'Not enough price history around this date.' };
    const estimation = dates.slice(zero + estStart, zero + estEnd + 1);
    const fit = ols(estimation.map((day) => stockReturns.get(day) as number), estimation.map((day) => [marketReturns.get(day) as number]));
    if (!fit) return { ...empty, error: 'Estimation failed.' };
    const [alpha, beta] = fit.coefficients;
    let car = 0;
    const abnormal = [];
    for (let day = before; day <= after; day += 1) {
      const key = dates[zero + day];
      const ar = (stockReturns.get(key) as number) - (alpha + beta * (marketReturns.get(key) as number));
      car += ar;
      abnormal.push({ day, ar, car });
    }
    const length = after - before + 1;
    return { date, aligned: dates[zero], alpha, beta, sigma: fit.residualStdev, abnormal, car, t: fit.residualStdev > 0 ? car / (fit.residualStdev * Math.sqrt(length)) : 0 };
  });
  const valid = results.filter((row) => !row.error);
  const days = Array.from({ length: after - before + 1 }, (_, index) => before + index);
  const caar = days.map((day, index) => {
    const values = valid.map((row) => row.abnormal[index].car);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return { day, caar: mean, aar: valid.length ? valid.reduce((sum, row) => sum + row.abnormal[index].ar, 0) / valid.length : 0 };
  });
  const finals = valid.map((row) => row.car);
  const mean = finals.length ? finals.reduce((sum, value) => sum + value, 0) / finals.length : 0;
  const sd = finals.length > 1 ? Math.sqrt(finals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finals.length - 1)) : 0;
  return {
    events: results,
    caar,
    summary: {
      n: valid.length,
      meanCar: mean,
      /** Cross-sectional t of the mean CAR (needs 2+ events). */
      t: sd > 0 ? mean / (sd / Math.sqrt(finals.length)) : null,
      positive: finals.filter((value) => value > 0).length,
    },
    window: [before, after] as [number, number],
    estimation: [estStart, estEnd] as [number, number],
  };
}

/** Technical indicators over closes. Each returns points aligned to the input times (warm-up bars omitted). */

export type Point = { t: number; value: number };
type Bar = { t: number; c: number };

export function sma(bars: Bar[], period: number): Point[] {
  const out: Point[] = [];
  let sum = 0;
  bars.forEach((bar, index) => {
    sum += bar.c;
    if (index >= period) sum -= bars[index - period].c;
    if (index >= period - 1) out.push({ t: bar.t, value: sum / period });
  });
  return out;
}

export function emaValues(values: number[], period: number) {
  const k = 2 / (period + 1);
  const out: Array<number | null> = [];
  let prev: number | null = null;
  let seed = 0;
  values.forEach((value, index) => {
    if (index < period - 1) {
      seed += value;
      out.push(null);
      return;
    }
    if (prev === null) {
      prev = (seed + value) / period;
    } else prev = value * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

export function ema(bars: Bar[], period: number): Point[] {
  const values = emaValues(bars.map((bar) => bar.c), period);
  return bars.flatMap((bar, index) => (values[index] === null ? [] : [{ t: bar.t, value: values[index] as number }]));
}

export function bollinger(bars: Bar[], period = 20, width = 2) {
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let index = period - 1; index < bars.length; index += 1) {
    const window = bars.slice(index - period + 1, index + 1).map((bar) => bar.c);
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const sd = Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
    upper.push({ t: bars[index].t, value: mean + width * sd });
    lower.push({ t: bars[index].t, value: mean - width * sd });
  }
  return { upper, middle: sma(bars, period), lower };
}

/** Wilder's RSI. */
export function rsi(bars: Bar[], period = 14): Point[] {
  const out: Point[] = [];
  let gain = 0;
  let loss = 0;
  for (let index = 1; index < bars.length; index += 1) {
    const change = bars[index].c - bars[index - 1].c;
    const up = Math.max(0, change);
    const down = Math.max(0, -change);
    if (index <= period) {
      gain += up;
      loss += down;
      if (index === period) {
        gain /= period;
        loss /= period;
        out.push({ t: bars[index].t, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
      }
      continue;
    }
    gain = (gain * (period - 1) + up) / period;
    loss = (loss * (period - 1) + down) / period;
    out.push({ t: bars[index].t, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
  }
  return out;
}

export function macd(bars: Bar[], fast = 12, slow = 26, signal = 9) {
  const closes = bars.map((bar) => bar.c);
  const fastE = emaValues(closes, fast);
  const slowE = emaValues(closes, slow);
  const line = bars.map((bar, index) => (fastE[index] !== null && slowE[index] !== null ? { t: bar.t, value: (fastE[index] as number) - (slowE[index] as number) } : null)).filter((point): point is Point => point !== null);
  const signalValues = emaValues(line.map((point) => point.value), signal);
  const signalLine = line.flatMap((point, index) => (signalValues[index] === null ? [] : [{ t: point.t, value: signalValues[index] as number }]));
  const bySignal = new Map(signalLine.map((point) => [point.t, point.value]));
  const histogram = line.flatMap((point) => (bySignal.has(point.t) ? [{ t: point.t, value: point.value - (bySignal.get(point.t) as number) }] : []));
  return { line, signal: signalLine, histogram };
}

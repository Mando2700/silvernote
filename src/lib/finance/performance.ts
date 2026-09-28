/**
 * Return measures over a daily value series with deposits and withdrawals. Pure: no I/O.
 *
 * Each point is an end-of-day value plus the cumulative net amount invested so far; the day's flow
 * is the change in `invested`, treated as arriving at the start of that day (after the previous close).
 */

export type FlowPoint = { t: number; value: number; invested: number };

/**
 * Money-weighted return (Modified Dietz) from the first point to every point: the gain after flows
 * divided by the average capital at work, each flow weighted by the share of the period it was invested.
 * Unlike the time-weighted return, it rewards or penalizes the timing and size of deposits.
 * Null where no capital was at work yet.
 */
export function moneyWeightedPath(points: FlowPoint[]): Array<number | null> {
  if (!points.length) return [];
  const start = points[0];
  let flowSum = 0;
  let flowTimeSum = 0;
  return points.map((point, index) => {
    if (index === 0) return 0;
    const flow = point.invested - points[index - 1].invested;
    const entered = points[index - 1].t;
    flowSum += flow;
    flowTimeSum += flow * entered;
    const span = point.t - start.t;
    if (span <= 0) return 0;
    const capital = start.value + (point.t * flowSum - flowTimeSum) / span;
    if (!(capital > 1e-9)) return null;
    return (point.value - start.value - flowSum) / capital;
  });
}

/**
 * The same money put into an index instead: the portfolio's starting value buys the index at the
 * first point, and every later deposit or withdrawal buys or sells it at that day's level. `level` is
 * the index level at each point (any scale). Returns the replica's value and invested amount per point.
 */
export function replicateInIndex(points: FlowPoint[], level: (point: FlowPoint, index: number) => number): FlowPoint[] {
  if (!points.length) return [];
  let units = points[0].value / level(points[0], 0);
  return points.map((point, index) => {
    if (index > 0) units += (point.invested - points[index - 1].invested) / level(point, index);
    return { t: point.t, value: units * level(point, index), invested: point.invested };
  });
}

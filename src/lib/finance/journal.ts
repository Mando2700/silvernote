/** Decision-journal scoring: how each call has played out and how well-calibrated the investor is. */

export type Decision = {
  id: string;
  symbol: string;
  direction: 'long' | 'short' | 'avoid';
  entry_price: number;
  entry_date: string;
  target_price: number | null;
  stop_price: number | null;
  horizon_date: string | null;
  confidence: number;
  status: 'open' | 'closed';
  exit_price: number | null;
  outcome: 'right' | 'wrong' | 'mixed' | null;
};

export type ScoredDecision = {
  id: string;
  /** Return in the direction of the call (a short that fell is positive; an "avoid" that fell is positive). */
  directionalReturn: number | null;
  /** Share of the way from entry to target (1 = target reached). */
  progress: number | null;
  hitTarget: boolean;
  hitStop: boolean;
  /** Settled right/wrong: the investor's own verdict when closed, else target/stop/horizon rules. */
  verdict: 'right' | 'wrong' | 'mixed' | 'pending';
};

export function scoreDecision(decision: Decision, price: number | null, today: string): ScoredDecision {
  const last = decision.status === 'closed' && decision.exit_price !== null ? decision.exit_price : price;
  const raw = last !== null && decision.entry_price > 0 ? last / decision.entry_price - 1 : null;
  const sign = decision.direction === 'long' ? 1 : -1;
  const directionalReturn = raw === null ? null : raw * sign;
  const target = decision.target_price;
  const progress = target !== null && last !== null && target !== decision.entry_price ? (last - decision.entry_price) / (target - decision.entry_price) : null;
  const hitTarget = progress !== null && progress >= 1;
  const stop = decision.stop_price;
  const hitStop = stop !== null && last !== null && (decision.direction === 'long' ? last <= stop : last >= stop);
  let verdict: ScoredDecision['verdict'] = 'pending';
  if (decision.outcome) verdict = decision.outcome;
  else if (hitTarget) verdict = 'right';
  else if (hitStop) verdict = 'wrong';
  else if (decision.horizon_date && decision.horizon_date <= today && directionalReturn !== null) verdict = directionalReturn > 0 ? 'right' : 'wrong';
  return { id: decision.id, directionalReturn, progress, hitTarget, hitStop, verdict };
}

/**
 * Calibration: for each confidence bucket, how often calls settled right. A well-calibrated investor
 * is right ~70% of the time on 70%-confidence calls. Brier score: lower is better (0.25 = coin flip).
 */
export function calibration(decisions: Decision[], scored: ScoredDecision[]) {
  const byId = new Map(scored.map((row) => [row.id, row]));
  const buckets = [50, 60, 70, 80, 90].map((low) => ({ low, high: low === 90 ? 100 : low + 9, calls: 0, right: 0 }));
  let brier = 0;
  let settled = 0;
  for (const decision of decisions) {
    const verdict = byId.get(decision.id)?.verdict;
    if (verdict !== 'right' && verdict !== 'wrong') continue;
    const bucket = buckets.find((item) => decision.confidence >= item.low && decision.confidence <= item.high);
    const hit = verdict === 'right' ? 1 : 0;
    if (bucket) {
      bucket.calls += 1;
      bucket.right += hit;
    }
    brier += (decision.confidence / 100 - hit) ** 2;
    settled += 1;
  }
  const right = scored.filter((row) => row.verdict === 'right').length;
  const wrong = scored.filter((row) => row.verdict === 'wrong').length;
  const returns = scored.map((row) => row.directionalReturn).filter((value): value is number => value !== null);
  return {
    buckets: buckets.map((bucket) => ({ ...bucket, hitRate: bucket.calls ? bucket.right / bucket.calls : null })),
    brier: settled ? brier / settled : null,
    settled,
    hitRate: right + wrong ? right / (right + wrong) : null,
    averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
  };
}

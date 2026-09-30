import { describe, expect, it } from 'vitest';

import { calibration, scoreDecision, type Decision } from '@/lib/finance/journal';

const base: Decision = { id: 'a', symbol: 'X', direction: 'long', entry_price: 100, entry_date: '2026-01-01', target_price: 130, stop_price: 85, horizon_date: '2026-12-31', confidence: 70, status: 'open', exit_price: null, outcome: null };

describe('journal scoring', () => {
  it('scores longs, shorts and targets', () => {
    expect(scoreDecision(base, 130, '2026-06-01')).toMatchObject({ hitTarget: true, verdict: 'right' });
    expect(scoreDecision(base, 80, '2026-06-01')).toMatchObject({ hitStop: true, verdict: 'wrong' });
    const short = scoreDecision({ ...base, direction: 'short', target_price: 70, stop_price: 115 }, 90, '2026-06-01');
    expect(short.directionalReturn).toBeCloseTo(0.1);
    expect(short.verdict).toBe('pending');
  });
  it('settles at the horizon and computes calibration', () => {
    const decisions = [base, { ...base, id: 'b', confidence: 90 }];
    const scored = [scoreDecision(base, 110, '2027-01-02'), scoreDecision(decisions[1], 95, '2027-01-02')];
    expect(scored.map((row) => row.verdict)).toEqual(['right', 'wrong']);
    const result = calibration(decisions, scored);
    expect(result.hitRate).toBe(0.5);
    expect(result.brier).toBeCloseTo(((0.7 - 1) ** 2 + 0.9 ** 2) / 2);
  });
});

import { describe, expect, it } from 'vitest';

import { moneyWeightedPath, replicateInIndex } from './performance';

const DAY = 86_400;

describe('moneyWeightedPath', () => {
  it('equals the simple return when nothing is added', () => {
    const path = moneyWeightedPath([
      { t: 0, value: 100, invested: 100 },
      { t: DAY, value: 105, invested: 100 },
      { t: 2 * DAY, value: 110, invested: 100 },
    ]);
    expect(path).toEqual([0, expect.closeTo(0.05, 10), expect.closeTo(0.1, 10)]);
  });

  it('weights a deposit by how long it was invested', () => {
    // $100 for two days, $100 more for the second day only; ends at $220: $20 gain on $150 average capital.
    const path = moneyWeightedPath([
      { t: 0, value: 100, invested: 100 },
      { t: DAY, value: 100, invested: 100 },
      { t: 2 * DAY, value: 220, invested: 200 },
    ]);
    expect(path[2]).toBeCloseTo(20 / 150, 10);
  });

  it('differs from the time-weighted return when money arrives before a rally', () => {
    // Flat on a small balance, then a big deposit just before +20%: time-weighted 20%, money-weighted higher.
    const path = moneyWeightedPath([
      { t: 0, value: 100, invested: 100 },
      { t: 10 * DAY, value: 100, invested: 100 },
      { t: 11 * DAY, value: 1320, invested: 1100 },
    ]);
    expect(path[2]).toBeCloseTo(220 / (100 + 1000 / 11), 10);
    expect(path[2] as number).toBeGreaterThan(0.2);
  });
});

describe('replicateInIndex', () => {
  it('invests the starting value and every flow in the index on the same days', () => {
    const points = [
      { t: 0, value: 1000, invested: 1000 },
      { t: DAY, value: 1500, invested: 1500 },
      { t: 2 * DAY, value: 1500, invested: 1500 },
    ];
    const levels = [100, 110, 121];
    const replica = replicateInIndex(points, (_, index) => levels[index]);
    // 10 units, then 500 / 110 more; worth (10 + 4.545…) × 121 at the end.
    expect(replica[2].value).toBeCloseTo((10 + 500 / 110) * 121, 8);
    expect(replica.map((point) => point.invested)).toEqual([1000, 1500, 1500]);
    // Its money-weighted return is the index's, weighted the same way as the portfolio's money.
    expect(moneyWeightedPath(replica)[2]).toBeGreaterThan(0);
  });
});

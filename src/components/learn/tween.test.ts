import { describe, expect, it } from 'vitest';

import { lerpDeep } from '@/components/learn/tween';

describe('lerpDeep', () => {
  it('interpolates nested numbers and keeps non-numbers from the target', () => {
    const from = { label: 'a', points: [[0, 0], [10, 10]], value: null as number | null };
    const to = { label: 'b', points: [[10, 20], [20, 30]], value: 5 as number | null };
    expect(lerpDeep(from, to, 0.5)).toEqual({ label: 'b', points: [[5, 10], [15, 20]], value: 5 });
    expect(lerpDeep(from, to, 1)).toBe(to);
  });

  it('resamples arrays of a different length', () => {
    expect(lerpDeep([0, 10], [0, 0, 0], 0)).toEqual([0, 5, 10]);
    expect(lerpDeep([0, 10, 20], [100, 100], 0.5)).toEqual([50, 60]);
  });
});

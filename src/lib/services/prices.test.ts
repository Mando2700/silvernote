import { describe, expect, it } from 'vitest';

import { historyRebased } from './prices';

const bar = (t: number, c: number) => ({ t, o: c, h: c, l: c, c, v: null });

describe('historyRebased', () => {
  const stored = [bar(1, 400), bar(2, 404), bar(3, 408)];

  it('spots a history re-adjusted for a split since it was stored', () => {
    expect(historyRebased(stored, [bar(2, 101), bar(3, 102), bar(4, 103)])).toBe(true);
  });

  it('accepts small data revisions and new days', () => {
    expect(historyRebased(stored, [bar(2, 404.2), bar(3, 407.9), bar(4, 410)])).toBe(false);
    expect(historyRebased(stored, [bar(9, 50)])).toBe(false);
  });
});

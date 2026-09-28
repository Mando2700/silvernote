import { describe, expect, it } from 'vitest';

import { sectorPerformance } from './sectors';

describe('sectorPerformance', () => {
  const entries = [
    { sector: 'Health Care', marketCap: 300, changePct: 1 },
    { sector: 'Health Care', marketCap: 100, changePct: -1 },
    { sector: 'Materials', marketCap: 50, changePct: -2 },
    { sector: 'Health Care', marketCap: 10, changePct: 9 },
    { sector: 'Materials', marketCap: null, changePct: 5 },
  ];

  it('weights by market cap and skips unpriced entries', () => {
    const health = sectorPerformance(entries).find((stat) => stat.sector === 'Health Care');
    expect(health?.changePct).toBeCloseTo((300 - 100 + 90) / 410);
    expect(sectorPerformance(entries).find((stat) => stat.sector === 'Materials')?.count).toBe(1);
  });

  it('only counts the requested number of largest entries', () => {
    const health = sectorPerformance(entries, 2).find((stat) => stat.sector === 'Health Care');
    expect(health?.changePct).toBeCloseTo(0.5);
  });
});

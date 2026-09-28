import { describe, expect, it } from 'vitest';

import { evaluate } from './calc';

describe('evaluate', () => {
  it('follows precedence and associativity', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluate('-2 ^ 2')).toBe(-4);
    expect(evaluate('10 / 4 - 1')).toBe(1.5);
    expect(evaluate('2 ** 10')).toBe(1024);
  });

  it('handles scientific notation, percents and functions', () => {
    expect(evaluate('1.5e9 / 3e8')).toBe(5);
    expect(evaluate('50%')).toBe(0.5);
    expect(evaluate('max(1, 7, 3) + min(4, 2)')).toBe(9);
    expect(evaluate('round(cagr(100, 133.1, 3), 4)')).toBe(0.1);
    expect(evaluate('avg(2, 4, 6)')).toBe(4);
    expect(evaluate('sum(0.5*0.2, 0.3*0.1, 0.2*0.05)')).toBeCloseTo(0.14);
  });

  it('rejects anything that is not arithmetic', () => {
    expect(() => evaluate('process.exit(1)')).toThrow();
    expect(() => evaluate('2 +')).toThrow();
    expect(() => evaluate('')).toThrow();
    expect(() => evaluate('(1 + 2')).toThrow();
  });
});

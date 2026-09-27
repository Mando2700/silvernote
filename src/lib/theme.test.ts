import { describe, expect, it } from 'vitest';

import { luminance, MARKET_PALETTES, withAlpha } from './theme';

describe('theme helpers', () => {
  it('computes relative luminance from hex and rgb strings', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('rgb(255, 255, 255)')).toBeCloseTo(1, 6);
    expect(luminance('not a color')).toBe(0);
  });

  it('adds alpha to a hex color', () => {
    expect(withAlpha('#14a37c', 0.35)).toBe('rgba(20,163,124,0.35)');
  });

  it('keeps text colors readable on the darkest panels', () => {
    const contrast = (a: string, b: string) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };
    for (const palette of Object.values(MARKET_PALETTES)) {
      expect(contrast(palette.gain, '#1c2027')).toBeGreaterThan(4.5);
      expect(contrast(palette.loss, '#1c2027')).toBeGreaterThan(4.5);
    }
  });
});

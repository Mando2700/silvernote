/**
 * Colors for code that cannot read CSS variables (canvas charts, d3 scales, PDF/PPTX export).
 * Keep in sync with the tokens in globals.css.
 */

export const SILVER = {
  base: '#cdd4de',
  bright: '#f4f6f9',
  soft: '#a9b2bf',
  deep: '#6b7380',
  rgb: '205,212,222',
} as const;

export const NEUTRAL_MARK = '#5d6470';
export const NEUTRAL_FILL = '#2a2e36';

/** Market direction pairs; both passed the CVD/contrast validator on the dark chart surface. */
export const MARKET_PALETTES = {
  'red-green': { gain: '#3ddba4', loss: '#ff6e66', gainFill: '#14a37c', lossFill: '#f0564f' },
  'blue-orange': { gain: '#6cb4ff', loss: '#ffa053', gainFill: '#3987e5', lossFill: '#d9772b' },
} as const;

export type MarketPaletteName = keyof typeof MARKET_PALETTES;
export type MarketPalette = (typeof MARKET_PALETTES)[MarketPaletteName];

/** Categorical order: green and orange come last so few-series charts never read as gain/loss. */
export const SERIES_COLORS = ['#3987e5', '#c98500', '#d55181', '#9085e9', '#199e70', '#d95926'];

/** Relative luminance of a `#rrggbb` or `rgb(r, g, b)` color, for picking dark or light text on a tile. */
export function luminance(color: string) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim());
  const channels = hex
    ? [0, 2, 4].map((offset) => parseInt(hex[1].slice(offset, offset + 2), 16) / 255)
    : rgb
      ? [rgb[1], rgb[2], rgb[3]].map((value) => Number(value) / 255)
      : null;
  if (!channels) return 0;
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `#rrggbb` → `rgba(r,g,b,a)` for libraries that need explicit alpha. */
export function withAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

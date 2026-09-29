import { money, shortDate, signedMoney, signedPct } from '@/lib/format';
import { rangeLabel, SCALED_BASE } from '@/lib/share/options';
import { MAX_SLICES, NEUTRAL_COLORS, sliceColorMap } from '@/lib/share/colors';
import { donutCenter, groupSlices, weightLabel, type ShareSlice, type ShareView } from '@/lib/share/view';
import type { MarketPalette } from '@/lib/theme';

/**
 * Draws a shared portfolio as an image. It paints straight onto a canvas (instead of screenshotting the page)
 * so the preview and the exported PNG are the same pixels, at any size, in the app's own font.
 */

export type ShareTemplate = 'summary' | 'holdings' | 'allocation' | 'performance' | 'sectors';
export type ShareFormat = 'square' | 'portrait' | 'story' | 'landscape';
export type ShareTheme = 'silver' | 'midnight' | 'paper' | 'noir';

export const SHARE_TEMPLATES: Array<{ id: ShareTemplate; label: string; hint: string }> = [
  { id: 'summary', label: 'Snapshot', hint: 'Headline, chart and top holdings' },
  { id: 'holdings', label: 'Holdings', hint: 'Ranked positions' },
  { id: 'allocation', label: 'Allocation', hint: 'Donut and legend' },
  { id: 'performance', label: 'Performance', hint: 'Return against the benchmark' },
  { id: 'sectors', label: 'Sectors', hint: 'Exposure by sector' },
];

export const SHARE_FORMATS: Record<ShareFormat, { w: number; h: number; label: string; ratio: string }> = {
  square: { w: 1080, h: 1080, label: 'Square', ratio: '1:1' },
  portrait: { w: 1080, h: 1350, label: 'Portrait', ratio: '4:5' },
  story: { w: 1080, h: 1920, label: 'Story', ratio: '9:16' },
  landscape: { w: 1600, h: 900, label: 'Wide', ratio: '16:9' },
};

type Theme = {
  label: string;
  bg: [string, string];
  glow: string;
  ink: string;
  ink2: string;
  muted: string;
  faint: string;
  line: string;
  track: string;
  accent: string;
  ramp: string[];
  other: string;
  light: boolean;
};

export const SHARE_THEMES: Record<ShareTheme, Theme> = {
  silver: {
    label: 'Silver',
    bg: ['#101216', '#060708'],
    glow: 'rgba(205,212,222,0.10)',
    ink: '#eceef1',
    ink2: '#b9bdc6',
    muted: '#858a95',
    faint: '#5a5f69',
    line: 'rgba(255,255,255,0.10)',
    track: 'rgba(255,255,255,0.06)',
    accent: '#cdd4de',
    ramp: ['#f4f6f9', '#d5dbe4', '#b6bfcc', '#98a2b1', '#7c8695', '#646d7b', '#505866'],
    other: '#333943',
    light: false,
  },
  midnight: {
    label: 'Midnight',
    bg: ['#0d1630', '#050914'],
    glow: 'rgba(120,160,255,0.16)',
    ink: '#eaf0ff',
    ink2: '#b4c2e6',
    muted: '#7889b3',
    faint: '#4c5a80',
    line: 'rgba(160,190,255,0.16)',
    track: 'rgba(160,190,255,0.08)',
    accent: '#8fb4ff',
    ramp: ['#d7e4ff', '#b0c9ff', '#8fb4ff', '#6f9aff', '#5480ee', '#4468c8', '#3a55a0'],
    other: '#243050',
    light: false,
  },
  paper: {
    label: 'Paper',
    bg: ['#f8f8f6', '#ebe9e4'],
    glow: 'rgba(0,0,0,0.03)',
    ink: '#14161a',
    ink2: '#3a3f48',
    muted: '#767c88',
    faint: '#a3a8b1',
    line: 'rgba(0,0,0,0.11)',
    track: 'rgba(0,0,0,0.06)',
    accent: '#23272e',
    ramp: ['#14161a', '#2f343c', '#4a505a', '#666c77', '#838995', '#a0a5af', '#bcc0c8'],
    other: '#d5d7dc',
    light: true,
  },
  noir: {
    label: 'Noir',
    bg: ['#000000', '#000000'],
    glow: 'rgba(255,255,255,0.05)',
    ink: '#ffffff',
    ink2: '#c9c9c9',
    muted: '#8a8a8a',
    faint: '#5a5a5a',
    line: 'rgba(255,255,255,0.16)',
    track: 'rgba(255,255,255,0.09)',
    accent: '#ffffff',
    ramp: ['#ffffff', '#e0e0e0', '#c2c2c2', '#a3a3a3', '#858585', '#686868', '#4d4d4d'],
    other: '#262626',
    light: false,
  },
};

export type ShareImageConfig = {
  template: ShareTemplate;
  format: ShareFormat;
  theme: ShareTheme;
  /** A line under the title, in the sharer's words. */
  caption: string;
  /** The SilverNote mark in the corner. */
  mark: boolean;
  /** The date the figures are as of. */
  date: boolean;
  /** color: each stock has its own color and logo. mono: the theme's tints, no logos. */
  colors: 'color' | 'mono';
};

export type ShareImageEnv = { sans: string; mono: string; market: MarketPalette; logos: Map<string, HTMLImageElement | null> };

const logoCache = new Map<string, Promise<HTMLImageElement | null>>();

/** Loads company logos (a missing one resolves to null) so the canvas can draw them synchronously. */
export async function loadLogos(symbols: string[], src: (symbol: string) => string = (symbol) => `/api/logo/${encodeURIComponent(symbol)}`) {
  const entries = await Promise.all(
    [...new Set(symbols)].map(async (symbol) => {
      let pending = logoCache.get(symbol);
      if (!pending) {
        pending = new Promise<HTMLImageElement | null>((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = src(symbol);
        });
        logoCache.set(symbol, pending);
      }
      return [symbol, await pending] as const;
    }),
  );
  return new Map(entries);
}

/** The tickers whose logos an image of this view can show. */
export function logoSymbols(view: ShareView) {
  return view.allocation.filter((slice) => slice.kind === 'holding').map((slice) => slice.label);
}

type Rect = { x: number; y: number; w: number; h: number };
type G = { c: CanvasRenderingContext2D; W: number; H: number; u: number; t: Theme; env: ShareImageEnv; colors: Map<string, string>; logos: boolean };
type TextOptions = { size: number; weight?: number; color: string; align?: CanvasTextAlign; mono?: boolean; max?: number; baseline?: CanvasTextBaseline; track?: number };

const setFont = (g: G, size: number, weight = 500, mono = false) => {
  g.c.font = `${weight} ${(size * g.u).toFixed(2)}px ${mono ? g.env.mono : g.env.sans}`;
};

function setTracking(g: G, px: number) {
  if ('letterSpacing' in g.c) (g.c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(px * g.u).toFixed(2)}px`;
}

/** Draws text (sizes are design units: 1 = 1px on a 1080-wide image) and returns its width. */
function text(g: G, value: string, x: number, y: number, o: TextOptions) {
  const { c } = g;
  setFont(g, o.size, o.weight, o.mono);
  setTracking(g, o.track ?? 0);
  c.textAlign = o.align ?? 'left';
  c.textBaseline = o.baseline ?? 'alphabetic';
  c.fillStyle = o.color;
  let shown = value;
  if (o.max !== undefined) {
    const limit = o.max * g.u;
    if (c.measureText(shown).width > limit) {
      while (shown.length > 1 && c.measureText(`${shown}…`).width > limit) shown = shown.slice(0, -1);
      shown = `${shown.trimEnd()}…`;
    }
  }
  c.fillText(shown, x, y);
  const width = c.measureText(shown).width;
  setTracking(g, 0);
  return width;
}

/** The largest size (down from `size`) at which `value` fits in `max`. */
function fitSize(g: G, value: string, max: number, size: number, weight: number) {
  let current = size;
  while (current > size * 0.5) {
    setFont(g, current, weight);
    if (g.c.measureText(value).width <= max * g.u) break;
    current -= 2;
  }
  return current;
}

function wrap(g: G, value: string, x: number, y: number, maxW: number, lineH: number, size: number, color: string, maxLines: number) {
  setFont(g, size, 500);
  setTracking(g, 0);
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.c.measureText(next).width > maxW * g.u && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1].replace(/[\s.,;:!?]+$/, '')}…`;
  shown.forEach((entry, index) => text(g, entry, x, y + index * lineH * g.u, { size, color }));
  return shown.length * lineH;
}

const tone = (g: G, value: number | null) => (value === null || value === 0 ? g.t.muted : value > 0 ? (g.t.light ? g.env.market.gainFill : g.env.market.gain) : g.t.light ? g.env.market.lossFill : g.env.market.loss);

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.c.beginPath();
  g.c.roundRect(x, y, Math.max(0, w), h, Math.min(r, h / 2, Math.max(0, w) / 2));
}

function fillBar(g: G, x: number, y: number, w: number, h: number, ratio: number, color: string) {
  roundRect(g, x, y, w, h, h / 2);
  g.c.fillStyle = g.t.track;
  g.c.fill();
  if (ratio > 0) {
    roundRect(g, x, y, Math.max(h, w * Math.min(1, ratio)), h, h / 2);
    g.c.fillStyle = color;
    g.c.fill();
  }
}

// ─── Building blocks ────────────────────────────────────────────────────────

function drawBackground(g: G) {
  const { c, W, H, t } = g;
  const gradient = c.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, t.bg[0]);
  gradient.addColorStop(1, t.bg[1]);
  c.fillStyle = gradient;
  c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(W * 0.08, 0, 0, W * 0.08, 0, Math.max(W, H) * 0.75);
  glow.addColorStop(0, t.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);
}

function drawMark(g: G, x: number, y: number, size: number) {
  const { c } = g;
  const gradient = c.createLinearGradient(x, y, x + size, y + size);
  const stops = g.t.light ? ['#3a3f48', '#14161a'] : ['#f7f8fa', '#959daa'];
  gradient.addColorStop(0, stops[0]);
  gradient.addColorStop(1, stops[1]);
  roundRect(g, x, y, size, size, size * 0.25);
  c.fillStyle = gradient;
  c.fill();
  const s = size / 32;
  c.beginPath();
  c.moveTo(x + 7.5 * s, y + 21.5 * s);
  c.lineTo(x + 13 * s, y + 15.5 * s);
  c.lineTo(x + 17.5 * s, y + 18.5 * s);
  c.lineTo(x + 24.5 * s, y + 10.5 * s);
  c.strokeStyle = g.t.light ? '#f8f8f6' : '#0b0c0f';
  c.lineWidth = 2.6 * s;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.stroke();
}

function asOfLabel(view: ShareView) {
  return shortDate(view.asOf);
}

/** Title, byline and caption. Returns the bottom edge. */
function drawHeader(g: G, view: ShareView, cfg: ShareImageConfig, r: Rect) {
  const { u } = g;
  const titleSize = fitSize(g, view.title, r.w, 54, 650);
  text(g, view.title, r.x, r.y + titleSize * u, { size: titleSize, weight: 650, color: g.t.ink, max: r.w });
  let bottom = r.y + titleSize * u + 14 * u;
  const byline = [view.owner ? `by ${view.owner}` : null, cfg.date ? asOfLabel(view) : null].filter(Boolean).join('  ·  ');
  if (byline) {
    text(g, byline, r.x, bottom + 22 * u, { size: 24, color: g.t.muted, max: r.w });
    bottom += 34 * u;
  }
  if (cfg.caption.trim()) {
    bottom += 14 * u;
    bottom += wrap(g, cfg.caption.trim(), r.x, bottom + 26 * u, r.w, 36, 26, g.t.ink2, 2) * u;
  }
  return bottom;
}

function drawFooter(g: G, view: ShareView, cfg: ShareImageConfig, r: Rect) {
  const { c, u } = g;
  const y = r.y + r.h;
  c.fillStyle = g.t.line;
  c.fillRect(r.x, r.y, r.w, Math.max(1, u));
  if (cfg.mark) {
    drawMark(g, r.x, y - 30 * u, 30 * u);
    const width = text(g, 'SILVER', r.x + 44 * u, y - 8 * u, { size: 20, weight: 600, mono: true, color: g.t.muted, track: 4 });
    text(g, 'NOTE', r.x + 44 * u + width, y - 8 * u, { size: 20, weight: 600, mono: true, color: g.t.ink, track: 4 });
  }
  const note = view.amounts === 'scaled' ? `Scaled to a ${money(SCALED_BASE, { digits: 0 })} model portfolio` : view.amounts === 'hidden' ? 'Percentages only' : '';
  if (note) text(g, note, r.x + r.w, y - 8 * u, { size: 20, color: g.t.faint, align: 'right', max: r.w * 0.6 });
}

/** The kicker, the big number and the day/total lines. Returns the bottom edge. */
function drawHeadline(g: G, view: ShareView, r: Rect, options: { compact?: boolean } = {}) {
  const { u, t } = g;
  const { totals } = view;
  const showValue = totals.value !== null;
  const label = showValue ? (view.amounts === 'scaled' ? 'MODEL PORTFOLIO' : 'PORTFOLIO VALUE') : totals.gainPct !== null ? 'TOTAL GAIN' : 'ALLOCATION';
  text(g, label, r.x, r.y + 20 * u, { size: 20, weight: 600, color: t.muted, track: 3 });
  const big = showValue ? money(totals.value, { digits: 0 }) : totals.gainPct !== null ? signedPct(totals.gainPct, 1) : '';
  const size = fitSize(g, big, r.w, options.compact ? 96 : 132, 650);
  let y = r.y + 28 * u + size * u;
  if (big) text(g, big, r.x, y, { size, weight: 650, color: showValue ? t.ink : tone(g, totals.gainPct), track: -2 });
  y += 18 * u;
  const parts: Array<[string, string, number | null]> = [];
  if (totals.dayChangePct !== null) parts.push(['Today', totals.dayChange !== null ? `${signedMoney(totals.dayChange, { digits: 0 })}  ${signedPct(totals.dayChangePct)}` : signedPct(totals.dayChangePct), totals.dayChangePct]);
  if (showValue && totals.gainPct !== null) parts.push(['Total gain', signedPct(totals.gainPct, 1), totals.gainPct]);
  let x = r.x;
  for (const [name, value, direction] of parts) {
    y += 0;
    const nameWidth = text(g, name, x, y + 26 * u, { size: 22, color: t.muted });
    const valueWidth = text(g, value, x + nameWidth + 12 * u, y + 26 * u, { size: 24, weight: 600, color: tone(g, direction) });
    x += nameWidth + valueWidth + 44 * u;
    if (x - r.x > r.w * 0.78) {
      x = r.x;
      y += 40 * u;
    }
  }
  return y + (parts.length ? 40 * u : 0);
}

function dateTick(t: number) {
  return new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function benchmarkName(symbol: string) {
  return symbol === 'SPY' ? 'S&P 500' : symbol;
}

/** Round tick values covering [lo, hi], about `count` of them. */
function niceTicks(lo: number, hi: number, count: number) {
  const span = hi - lo || 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** A smooth path through `pts` that never overshoots between points (monotone cubic). */
function smoothPath(c: CanvasRenderingContext2D, pts: Array<[number, number]>, move = true) {
  const n = pts.length;
  if (move) c.moveTo(pts[0][0], pts[0][1]);
  else c.lineTo(pts[0][0], pts[0][1]);
  if (n < 3) {
    for (let i = 1; i < n; i += 1) c.lineTo(pts[i][0], pts[i][1]);
    return;
  }
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(pts[i + 1][0] - pts[i][0] || 1e-6);
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const m = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  m.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = (3 * a * slope[i]) / h;
      m[i + 1] = (3 * b * slope[i]) / h;
    }
  }
  for (let i = 0; i < n - 1; i += 1) {
    const w = dx[i] / 3;
    c.bezierCurveTo(pts[i][0] + w, pts[i][1] + m[i] * w, pts[i + 1][0] - w, pts[i + 1][1] - m[i + 1] * w, pts[i + 1][0], pts[i + 1][1]);
  }
}

function drawChart(g: G, view: ShareView, r: Rect) {
  const perf = view.performance;
  if (!perf) return;
  const { c, u, t } = g;
  const points = perf.points;
  const hasNasdaq = perf.nasdaqReturn !== undefined && points.every((point) => point.nasdaq !== undefined);
  const nasdaqColor = t.light ? '#2f62d0' : '#7aa7ff';
  const legendH = 44 * u;
  const axisH = 36 * u;
  const plot = { x: r.x, y: r.y + legendH + 8 * u, w: r.w, h: r.h - legendH - axisH - 8 * u };

  // Legend: a swatch in each line's style, its name and its return over the range.
  type Series = { name: string; ret: number; color: string; width: number; dash: number[]; pick: (point: (typeof points)[number]) => number };
  const series: Series[] = [
    { name: 'Portfolio', ret: perf.portfolioReturn, color: t.ink, width: 3.6, dash: [], pick: (point) => point.portfolio },
    { name: benchmarkName(perf.benchmark), ret: perf.benchmarkReturn, color: t.muted, width: 2.4, dash: [8, 7], pick: (point) => point.benchmark },
    ...(hasNasdaq ? [{ name: 'Nasdaq 100', ret: perf.nasdaqReturn ?? 0, color: nasdaqColor, width: 2.4, dash: [8, 7], pick: (point: (typeof points)[number]) => point.nasdaq ?? 100 }] : []),
  ];
  let lx = r.x;
  const ly = r.y + 22 * u;
  for (const item of series) {
    c.strokeStyle = item.color;
    c.lineWidth = Math.max(2, item.width * 0.7) * u;
    c.lineCap = 'round';
    c.setLineDash(item.dash.map((d) => d * 0.6 * u));
    c.beginPath();
    c.moveTo(lx, ly - 8 * u);
    c.lineTo(lx + 26 * u, ly - 8 * u);
    c.stroke();
    c.setLineDash([]);
    const nameW = text(g, item.name, lx + 38 * u, ly, { size: 22, color: item === series[0] ? t.ink2 : t.muted });
    const retW = text(g, signedPct(item.ret, 1), lx + 38 * u + nameW + 10 * u, ly, { size: 22, weight: 600, color: tone(g, item.ret) });
    lx += 38 * u + nameW + 10 * u + retW + 36 * u;
  }

  const times = points.map((point) => point.t);
  const values = points.flatMap((point) => series.map((item) => item.pick(point)).concat(100));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || 1) * 0.12;
  const min = lo - pad;
  const max = hi + pad;
  const sx = (time: number) => plot.x + ((time - times[0]) / Math.max(1, times[times.length - 1] - times[0])) * plot.w;
  const sy = (value: number) => plot.y + plot.h - ((value - min) / (max - min)) * plot.h;

  // Gridlines at round return levels, labelled on the left edge; the 0% base is dashed.
  const ticks = niceTicks(min - 100, max - 100, 4);
  for (const tick of ticks) {
    const y = sy(100 + tick);
    if (tick === 0) continue;
    c.fillStyle = t.line;
    c.fillRect(plot.x, y, plot.w, Math.max(1, u * 0.8));
    text(g, `${tick > 0 ? '+' : '−'}${Math.abs(tick).toFixed(Math.abs(tick) < 10 && tick % 1 !== 0 ? 1 : 0)}%`, plot.x, y - 8 * u, { size: 17, color: t.faint });
  }
  const base = sy(100);
  c.setLineDash([3 * u, 7 * u]);
  c.strokeStyle = t.muted;
  c.lineWidth = 1.5 * u;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(plot.x, base);
  c.lineTo(plot.x + plot.w, base);
  c.stroke();
  c.setLineDash([]);
  text(g, '0%', plot.x, base - 8 * u, { size: 17, color: t.muted });

  const coords = (pick: Series['pick']) => points.map((point): [number, number] => [sx(point.t), sy(pick(point))]);
  // Soft area under the portfolio line, clipped to the plot.
  const main = coords(series[0].pick);
  c.save();
  c.beginPath();
  c.rect(plot.x, plot.y - 4 * u, plot.w, plot.h + 8 * u);
  c.clip();
  c.beginPath();
  smoothPath(c, main);
  c.lineTo(main[main.length - 1][0], plot.y + plot.h);
  c.lineTo(main[0][0], plot.y + plot.h);
  c.closePath();
  const fill = c.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
  fill.addColorStop(0, t.light ? 'rgba(20,22,26,0.16)' : 'rgba(255,255,255,0.15)');
  fill.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = fill;
  c.fill();
  c.restore();

  // Lines: benchmarks first so the portfolio sits on top.
  c.lineJoin = 'round';
  c.lineCap = 'round';
  for (const item of [...series].reverse()) {
    c.strokeStyle = item.color;
    c.lineWidth = item.width * u;
    c.setLineDash(item.dash.map((d) => d * u));
    c.beginPath();
    smoothPath(c, coords(item.pick));
    c.stroke();
    c.setLineDash([]);
  }
  // End markers with a halo in the background color.
  for (const item of series) {
    const [ex, ey] = coords(item.pick).at(-1) ?? [0, 0];
    c.beginPath();
    c.arc(ex, ey, (item === series[0] ? 10 : 8) * u, 0, Math.PI * 2);
    c.fillStyle = t.bg[1];
    c.fill();
    c.beginPath();
    c.arc(ex, ey, (item === series[0] ? 6.5 : 5) * u, 0, Math.PI * 2);
    c.fillStyle = item.color;
    c.fill();
  }

  // Dates: start, middle and end of the range.
  const axisY = r.y + r.h - 6 * u;
  text(g, dateTick(times[0]), plot.x, axisY, { size: 18, color: t.faint });
  text(g, dateTick(times[Math.floor((times.length - 1) / 2)]), plot.x + plot.w / 2, axisY, { size: 18, color: t.faint, align: 'center' });
  text(g, dateTick(times[times.length - 1]), plot.x + plot.w, axisY, { size: 18, color: t.faint, align: 'right' });
}

function drawDonut(g: G, slices: ShareSlice[], cx: number, cy: number, radius: number, thickness: number, center?: { value: string; label: string }) {
  const { c, u, t } = g;
  const items = groupSlices(slices, MAX_SLICES);
  const total = items.reduce((sum, slice) => sum + slice.weight, 0) || 1;
  const gap = items.length > 1 ? 0.018 : 0;
  let angle = -Math.PI / 2;
  c.lineCap = 'butt';
  c.lineWidth = thickness;
  items.forEach((slice) => {
    const sweep = (slice.weight / total) * Math.PI * 2;
    c.beginPath();
    c.arc(cx, cy, radius - thickness / 2, angle + gap, Math.max(angle + gap + 0.001, angle + sweep - gap));
    c.strokeStyle = g.colors.get(slice.label) ?? t.other;
    c.stroke();
    angle += sweep;
  });
  if (g.logos) {
    // A logo sits on each holding's slice when the slice is wide enough to carry it.
    const mid = radius - thickness / 2;
    const size = Math.min(thickness * 0.74, 64 * g.u);
    angle = -Math.PI / 2;
    for (const slice of items) {
      const sweep = (slice.weight / total) * Math.PI * 2;
      if (slice.kind === 'holding' && sweep * mid >= size * 1.25) {
        const at = angle + sweep / 2;
        drawLogo(g, slice.label, cx + Math.cos(at) * mid - size / 2, cy + Math.sin(at) * mid - size / 2, size, g.colors.get(slice.label) ?? t.other, t.bg[1]);
      }
      angle += sweep;
    }
  }
  if (center) {
    text(g, center.value, cx, cy + 14 * u, { size: fitSize(g, center.value, (radius - thickness) * 1.5, 76, 650), weight: 650, color: t.ink, align: 'center', track: -1 });
    text(g, center.label, cx, cy + 56 * u, { size: 22, color: t.muted, align: 'center', max: (radius - thickness) * 1.6 });
  }
  return items;
}

type Row = { label: string; sub?: string; weight: number; value: number | null; ret: number | null; color?: string; symbol?: string };

/** A company logo on a tile with a thin ring in the stock's color (or `ring`), or its first letter when there is no logo. */
function drawLogo(g: G, symbol: string, x: number, y: number, size: number, color: string, ring = color) {
  const { c, u, t } = g;
  const image = g.env.logos.get(symbol);
  const border = Math.max(1.6, size * 0.075);
  roundRect(g, x, y, size, size, size * 0.26);
  c.fillStyle = ring;
  c.fill();
  const inner = size - border * 2;
  roundRect(g, x + border, y + border, inner, inner, inner * 0.22);
  c.fillStyle = t.light ? '#ffffff' : '#1c2027';
  c.fill();
  if (image) {
    c.save();
    roundRect(g, x + border, y + border, inner, inner, inner * 0.22);
    c.clip();
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(image, x + border, y + border, inner, inner);
    c.restore();
  } else {
    text(g, symbol.replace(/[^A-Z0-9]/gi, '').slice(0, 1), x + size / 2, y + size * 0.68, { size: (size / u) * 0.46, weight: 650, mono: true, color: t.ink2, align: 'center' });
  }
}

/** Slices as legend rows: swatch, name, weight. Flows into `columns` columns when it needs the room. */
function drawLegend(g: G, items: Array<ShareSlice>, r: Rect, rowH: number, columns = 1) {
  const { u } = g;
  const grouped = groupSlices(items, MAX_SLICES);
  const perColumn = Math.max(1, Math.ceil(grouped.length / columns));
  const gutter = 48 * u;
  const columnW = (r.w - gutter * (columns - 1)) / columns;
  const fits = Math.max(1, Math.floor(r.h / (rowH * u)));
  grouped.slice(0, fits * columns).forEach((slice, index) => {
    const column = Math.floor(index / perColumn);
    const x = r.x + column * (columnW + gutter);
    const top = r.y + (index % perColumn) * rowH * u;
    const mid = top + rowH * u * 0.5;
    const color = g.colors.get(slice.label) ?? g.t.other;
    const withLogo = g.logos && slice.kind === 'holding';
    if (withLogo) drawLogo(g, slice.label, x, mid - 17 * u, 34 * u, color);
    else roundRectFill(g, x + 8 * u, mid - 9 * u, 18 * u, 18 * u, 5 * u, color);
    text(g, slice.label, x + 50 * u, mid + 9 * u, { size: 26, weight: withLogo ? 650 : 500, color: g.t.ink, max: columnW / u - 50 - 96, mono: slice.kind === 'holding' });
    text(g, weightLabel(slice.weight), x + columnW, mid + 9 * u, { size: 26, weight: 600, color: g.t.ink2, align: 'right' });
  });
}

function roundRectFill(g: G, x: number, y: number, w: number, h: number, radius: number, color: string) {
  roundRect(g, x, y, w, h, radius);
  g.c.fillStyle = color;
  g.c.fill();
}

/** Weight bars: label, bar, percentage (and an optional right-hand value). */
function drawBars(g: G, rows: Row[], r: Rect, rowH: number) {
  const { u, t } = g;
  const cap = Math.max(1, Math.floor(r.h / (rowH * u)));
  const shown = rows.slice(0, cap);
  const top = Math.max(0.0001, ...shown.map((row) => row.weight));
  const logoW = g.logos && shown.some((row) => row.symbol) ? 42 : 0;
  const labelW = Math.min(r.w * 0.38, 330 * u) / u;
  shown.forEach((row, index) => {
    const y = r.y + index * rowH * u;
    const mid = y + rowH * u * 0.5;
    const color = row.color ?? t.accent;
    if (logoW && row.symbol) drawLogo(g, row.symbol, r.x, mid - 15 * u, 30 * u, color);
    text(g, row.label, r.x + logoW * u, mid + 9 * u, { size: 26, weight: 500, color: t.ink, max: labelW - logoW, mono: Boolean(row.sub) });
    const barX = r.x + (labelW + 24) * u;
    const barW = r.w - (labelW + 24 + 120) * u;
    fillBar(g, barX, mid - 8 * u, barW, 16 * u, row.weight / top, color);
    text(g, weightLabel(row.weight), r.x + r.w, mid + 9 * u, { size: 26, weight: 600, color: t.ink2, align: 'right' });
  });
  return shown.length;
}

/** A ranked table: name, weight bar and whatever figures the view shares. */
function drawTable(g: G, rows: Row[], r: Rect, rowH: number) {
  const { u, t, c } = g;
  const hasValue = rows.some((row) => row.value !== null);
  const hasReturn = rows.some((row) => row.ret !== null);
  const cap = Math.max(1, Math.floor((r.h - 30 * u) / (rowH * u)));
  const overflow = rows.length > cap;
  const shown = overflow ? rows.slice(0, cap - 1) : rows.slice(0, cap);
  const top = Math.max(0.0001, ...rows.map((row) => row.weight));
  const wide = r.w > 800 * u;
  const retW = hasReturn ? 150 : 0;
  const valW = hasValue ? (wide ? 190 : 170) : 0;
  const pctW = 96;
  const nameW = r.w / u - retW - valW - pctW - (wide ? 200 : 0) - 16;
  const barW = wide ? 170 : 0;
  shown.forEach((row, index) => {
    const y = r.y + index * rowH * u;
    const mid = y + rowH * u * 0.5;
    if (index > 0) {
      c.fillStyle = t.line;
      c.fillRect(r.x, y, r.w, Math.max(1, u * 0.8));
    }
    text(g, String(index + 1).padStart(2, '0'), r.x, mid + 8 * u, { size: 22, color: t.faint, mono: true });
    const rowColor = row.color ?? t.accent;
    const withLogo = g.logos && Boolean(row.symbol);
    if (withLogo && row.symbol) drawLogo(g, row.symbol, r.x + 56 * u, mid - 17 * u, 34 * u, rowColor);
    const labelX = r.x + (withLogo ? 106 : 56) * u;
    const labelShift = withLogo ? 50 : 0;
    if (row.sub) {
      const w = text(g, row.label, labelX, mid + 9 * u, { size: 28, weight: 650, mono: true, color: t.ink, max: 150 });
      text(g, row.sub, labelX + w + 16 * u, mid + 8 * u, { size: 22, color: t.muted, max: Math.max(40, nameW - 56 - labelShift - 16 - w / u - 8) });
    } else {
      text(g, row.label, labelX, mid + 9 * u, { size: 27, weight: 500, color: t.ink2, max: nameW - 56 - labelShift });
    }
    let right = r.x + r.w;
    if (hasReturn) {
      text(g, row.ret === null ? '—' : signedPct(row.ret, 1), right, mid + 9 * u, { size: 26, weight: 600, color: tone(g, row.ret), align: 'right' });
      right -= retW * u;
    }
    if (hasValue) {
      text(g, row.value === null ? '—' : money(row.value, { digits: 0 }), right, mid + 9 * u, { size: 26, color: t.ink, align: 'right' });
      right -= valW * u;
    }
    text(g, weightLabel(row.weight), right, mid + 9 * u, { size: 26, weight: 600, color: t.ink2, align: 'right' });
    right -= (pctW + 24) * u;
    if (barW) fillBar(g, right - barW * u, mid - 7 * u, barW * u, 14 * u, row.weight / top, rowColor);
  });
  if (overflow) {
    const rest = rows.length - shown.length;
    text(g, `+ ${rest} more`, r.x + 56 * u, r.y + shown.length * rowH * u + rowH * u * 0.5 + 8 * u, { size: 22, color: t.faint });
  }
}

function drawMessage(g: G, r: Rect, title: string, body: string) {
  const { u, t } = g;
  text(g, title, r.x + r.w / 2, r.y + r.h / 2 - 8 * u, { size: 34, weight: 600, color: t.ink2, align: 'center', max: r.w });
  text(g, body, r.x + r.w / 2, r.y + r.h / 2 + 34 * u, { size: 24, color: t.muted, align: 'center', max: r.w });
}

// ─── Templates ──────────────────────────────────────────────────────────────

type Extra = 'sectors' | 'performance' | 'holdings';

/** Fills the room a template leaves under its content (tall formats) with more of the portfolio: sectors, the chart, top holdings. */
function drawExtras(g: G, view: ShareView, r: Rect, kinds: Extra[]) {
  const { u, t } = g;
  const gap = 44 * u;
  let y = r.y;
  const bottom = r.y + r.h;
  const label = (value: string) => text(g, value, r.x, y + 18 * u, { size: 20, weight: 600, color: t.muted, track: 3 });
  for (const kind of kinds) {
    const room = (bottom - y) / u;
    if (kind === 'sectors' && view.sectors.length) {
      const rows = Math.min(view.sectors.length, Math.floor((room - 50) / 56));
      if (rows < Math.min(3, view.sectors.length)) continue;
      label('SECTORS');
      drawBars(g, view.sectors.map((sector) => ({ label: sector.sector, weight: sector.weight, value: null, ret: null })), { x: r.x, y: y + 40 * u, w: r.w, h: rows * 56 * u }, 56);
      y += (40 + rows * 56) * u + gap;
    } else if (kind === 'performance' && view.performance) {
      if (room < 380) continue;
      const height = Math.min(room - 50, 520);
      label(`${rangeLabel(view.performance.range).toUpperCase()} PERFORMANCE`);
      drawChart(g, view, { x: r.x, y: y + 34 * u, w: r.w, h: height * u });
      y += (34 + height) * u + gap;
    } else if (kind === 'holdings' && view.holdings.length) {
      const rows = Math.min(view.holdings.length, Math.floor((room - 50) / 58));
      if (rows < Math.min(3, view.holdings.length)) continue;
      label('TOP HOLDINGS');
      const list: Row[] = holdingRows(g, view).slice(0, rows);
      drawBars(g, list, { x: r.x, y: y + 40 * u, w: r.w, h: rows * 58 * u }, 58);
      y += (40 + rows * 58) * u + gap;
    }
  }
}


function holdingRows(g: G, view: ShareView): Row[] {
  if (view.holdings.length) {
    return view.holdings.map((row) => ({ label: row.symbol ?? row.name, sub: row.symbol ? row.name : undefined, symbol: row.symbol ?? undefined, color: g.colors.get(row.symbol ?? '') ?? (g.logos ? NEUTRAL_COLORS.other : undefined), weight: row.weight, value: row.value, ret: row.returnPct }));
  }
  return view.allocation.map((slice) => ({ label: slice.label, color: g.colors.get(slice.label), weight: slice.weight, value: null, ret: null }));
}

function templateSummary(g: G, view: ShareView, body: Rect) {
  const wide = g.W / g.H > 1.3;
  const { u } = g;
  const rows = holdingRows(g, view);
  if (wide) {
    // Headline and the biggest holdings on the left, the chart taking the whole right side.
    const leftW = body.w * 0.42;
    const headBottom = drawHeadline(g, view, { x: body.x, y: body.y, w: leftW, h: body.h });
    const barsY = headBottom + 16 * u;
    drawBars(g, rows, { x: body.x, y: barsY, w: leftW, h: body.y + body.h - barsY }, 50);
    const right: Rect = { x: body.x + leftW + 64 * u, y: body.y, w: body.w - leftW - 64 * u, h: body.h };
    if (view.performance) drawChart(g, view, right);
    else drawBars(g, rows, right, 56);
    return;
  }
  const headBottom = drawHeadline(g, view, body);
  let y = headBottom + 26 * u;
  if (view.performance) {
    const chartH = Math.min(body.h * 0.36, 400 * u);
    drawChart(g, view, { x: body.x, y, w: body.w, h: chartH });
    y += chartH + 30 * u;
  }
  const shown = drawBars(g, rows, { x: body.x, y, w: body.w, h: body.y + body.h - y }, 60);
  const used = y + shown * 60 * u + 40 * u;
  drawExtras(g, view, { x: body.x, y: used, w: body.w, h: body.y + body.h - used }, ['sectors']);
}

function templateHoldings(g: G, view: ShareView, body: Rect) {
  const rows = holdingRows(g, view);
  if (!rows.length) return drawMessage(g, body, 'Nothing to list', 'This portfolio has no holdings to show.');
  const rowH = g.W / g.H > 1.3 ? 62 : 74;
  drawTable(g, rows, body, rowH);
  const used = body.y + rows.length * rowH * g.u + 44 * g.u;
  if (g.W / g.H <= 1.3 && rows.length * rowH * g.u < body.h - 30 * g.u) drawExtras(g, view, { x: body.x, y: used, w: body.w, h: body.y + body.h - used }, ['sectors', 'performance']);
}

function templateAllocation(g: G, view: ShareView, body: Rect) {
  const { u } = g;
  if (!view.allocation.length) return drawMessage(g, body, 'Nothing to show', 'This portfolio has no allocation yet.');
  const center = donutCenter(view);
  // Donut beside the legend when there is width to spare, above it (legend in two columns) when the image is tall.
  if (body.w / body.h > 1.25) {
    const radius = Math.min(body.h * 0.5, body.w * 0.3);
    const rows = Math.min(8, groupSlices(view.allocation, 8).length);
    const legendH = Math.min(body.h, rows * 64 * u);
    const legendW = Math.min(body.w - radius * 2 - 72 * u, 520 * u);
    // Centre the pair so a wide image does not strand the legend at the far edge.
    const start = body.x + (body.w - (radius * 2 + 72 * u + legendW)) / 2;
    drawDonut(g, view.allocation, start + radius, body.y + body.h / 2, radius, radius * 0.24, center);
    drawLegend(g, view.allocation, { x: start + radius * 2 + 72 * u, y: body.y + (body.h - legendH) / 2, w: legendW, h: legendH }, 64);
    return;
  }
  const rows = Math.ceil(Math.min(8, groupSlices(view.allocation, 8).length) / 2);
  const legendH = rows * 64 * u;
  const radius = Math.max(140 * u, Math.min(body.w * 0.36, (body.h - legendH - 56 * u) / 2));
  drawDonut(g, view.allocation, body.x + body.w / 2, body.y + radius + 4 * u, radius, radius * 0.24, center);
  drawLegend(g, view.allocation, { x: body.x, y: body.y + radius * 2 + 56 * u, w: body.w, h: legendH }, 64, 2);
  const used = body.y + radius * 2 + 56 * u + legendH + 48 * u;
  const sectorSlices = view.allocation.some((slice) => slice.kind === 'sector');
  drawExtras(g, view, { x: body.x, y: used, w: body.w, h: body.y + body.h - used }, sectorSlices ? ['performance', 'holdings'] : ['sectors', 'performance']);
}

function templatePerformance(g: G, view: ShareView, body: Rect) {
  const { u, t } = g;
  const perf = view.performance;
  if (!perf) return drawMessage(g, body, 'Performance is not included', view.returns ? 'Not enough history yet.' : 'Returns are turned off for this share.');
  const wide = g.W / g.H > 1.3;
  const gap = perf.portfolioReturn - perf.benchmarkReturn;
  const big = signedPct(perf.portfolioReturn, 1);
  const size = fitSize(g, big, wide ? body.w * 0.4 : body.w, wide ? 150 : 170, 650);
  text(g, `${rangeLabel(perf.range).toUpperCase()} RETURN`, body.x, body.y + 20 * u, { size: 20, weight: 600, color: t.muted, track: 3 });
  text(g, big, body.x, body.y + 30 * u + size * u, { size, weight: 650, color: tone(g, perf.portfolioReturn), track: -2 });
  const statsY = body.y + 30 * u + size * u + 30 * u;
  const label = `vs ${benchmarkName(perf.benchmark)}`;
  const w1 = text(g, label, body.x, statsY + 24 * u, { size: 24, color: t.muted });
  const w2 = text(g, signedPct(perf.benchmarkReturn, 1), body.x + w1 + 12 * u, statsY + 24 * u, { size: 26, weight: 600, color: tone(g, perf.benchmarkReturn) });
  const w3 = text(g, gap >= 0 ? 'Ahead by' : 'Behind by', body.x + w1 + w2 + 52 * u, statsY + 24 * u, { size: 24, color: t.muted });
  text(g, `${Math.abs(gap * 100).toFixed(1)} pts`, body.x + w1 + w2 + w3 + 64 * u, statsY + 24 * u, { size: 26, weight: 600, color: tone(g, gap) });
  const chartY = statsY + 70 * u;
  const room = body.y + body.h - chartY;
  // A very tall image gets a chart of sensible proportions, and the rest of the portfolio under it.
  const chartH = wide ? room : Math.min(room, Math.max(520 * u, body.w * 0.78));
  drawChart(g, view, { x: body.x, y: chartY, w: body.w, h: chartH });
  const used = chartY + chartH + 48 * u;
  if (!wide) drawExtras(g, view, { x: body.x, y: used, w: body.w, h: body.y + body.h - used }, ['holdings', 'sectors']);
}

function templateSectors(g: G, view: ShareView, body: Rect) {
  if (!view.sectors.length) return drawMessage(g, body, 'Nothing to show', 'No sector data for this portfolio.');
  const rows: Row[] = view.sectors.map((sector) => ({ label: sector.sector, weight: sector.weight, value: null, ret: null }));
  const wide = g.W / g.H > 1.3;
  const rowH = Math.min(wide ? 110 : 88, Math.max(wide ? 62 : 82, body.h / g.u / rows.length));
  const shown = drawBars(g, rows, body, rowH);
  const used = body.y + shown * rowH * g.u + 48 * g.u;
  if (!wide) drawExtras(g, view, { x: body.x, y: used, w: body.w, h: body.y + body.h - used }, ['performance', 'holdings']);
}

const TEMPLATES: Record<ShareTemplate, (g: G, view: ShareView, body: Rect) => void> = {
  summary: templateSummary,
  holdings: templateHoldings,
  allocation: templateAllocation,
  performance: templatePerformance,
  sectors: templateSectors,
};

/** Paints the image onto `canvas` (resizing it to the format at `scale`). */
export function renderShareImage(canvas: HTMLCanvasElement, view: ShareView, cfg: ShareImageConfig, env: ShareImageEnv, scale = 1) {
  const { w: W, h: H } = SHARE_FORMATS[cfg.format];
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const c = canvas.getContext('2d');
  if (!c) throw new Error('This browser cannot draw images.');
  c.scale(scale, scale);
  const u = W > H ? H / 1080 : W / 1080;
  const theme = SHARE_THEMES[cfg.theme];
  const colored = cfg.colors === 'color';
  const g: G = { c, W, H, u, t: theme, env, colors: sliceColorMap(view.allocation, colored ? undefined : theme.ramp), logos: colored };
  if (!colored) for (const slice of groupSlices(view.allocation, MAX_SLICES)) if (slice.kind === 'other') g.colors.set(slice.label, theme.other);
  drawBackground(g);
  const pad = 72 * u;
  const header = drawHeader(g, view, cfg, { x: pad, y: pad, w: W - pad * 2, h: 0 });
  const footer: Rect = { x: pad, y: H - pad - 46 * u, w: W - pad * 2, h: 46 * u };
  const bodyTop = header + 44 * u;
  TEMPLATES[cfg.template](g, view, { x: pad, y: bodyTop, w: W - pad * 2, h: footer.y - 28 * u - bodyTop });
  drawFooter(g, view, cfg, footer);
}

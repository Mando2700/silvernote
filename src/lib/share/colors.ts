import { groupSlices, type ShareSlice } from '@/lib/share/view';

/** One vivid color per holding, by rank: distinct enough to tell apart on the donut, legible on dark and light. */
export const STOCK_COLORS = ['#4c8dff', '#f5a524', '#e5548c', '#8e7cf0', '#2dbe8a', '#f0643b', '#22b8cf', '#b5d334'];

/** Anything that is not a single holding stays neutral, so the colored slices are the stocks. */
export const NEUTRAL_COLORS = { other: '#5d6470', cash: '#8b93a1', bonds: '#6b7380' } as const;

/** The most slices a chart shows before folding the rest into "Other". */
export const MAX_SLICES = 8;

/**
 * Label → color for what the allocation chart shows. Holdings and sectors take the palette in rank order;
 * the same map colors table rows and bars so a stock looks the same everywhere.
 */
export function sliceColorMap(slices: ShareSlice[], palette: readonly string[] = STOCK_COLORS): Map<string, string> {
  const colors = new Map<string, string>();
  let next = 0;
  for (const slice of groupSlices(slices, MAX_SLICES)) {
    if (slice.kind === 'other' || slice.kind === 'cash' || slice.kind === 'bonds') colors.set(slice.label, NEUTRAL_COLORS[slice.kind]);
    else colors.set(slice.label, palette[next++ % palette.length]);
  }
  return colors;
}

import { z } from 'zod';

/** What a shared portfolio reveals. One set of options drives the image export and the public link. */

export const SHARE_RANGES = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const;
export type ShareRange = (typeof SHARE_RANGES)[number];

/** A range as it reads in a heading: "3M", or "All-time" for the whole history. */
export const rangeLabel = (range: ShareRange) => (range === 'ALL' ? 'All-time' : range);

/** exact: real dollars · scaled: the same mix as a $100K model portfolio · hidden: percentages only. */
export const SHARE_AMOUNTS = ['exact', 'scaled', 'hidden'] as const;
export type ShareAmounts = (typeof SHARE_AMOUNTS)[number];

/** How much of the holdings list is shown; "sectors" hides every ticker. */
export const SHARE_DETAILS = ['all', 'top10', 'top5', 'sectors'] as const;
export type ShareDetail = (typeof SHARE_DETAILS)[number];

/** The size of the model portfolio when amounts are scaled. */
export const SCALED_BASE = 100_000;

export const shareOptionsSchema = z.object({
  amounts: z.enum(SHARE_AMOUNTS),
  /** Share counts per holding (only meaningful with exact amounts). */
  shares: z.boolean(),
  /** Gains, losses and performance against the benchmark. */
  returns: z.boolean(),
  /** Also plot the Nasdaq 100 next to the benchmark. */
  nasdaq: z.boolean().default(false),
  /** Count cash in the mix. Off: weights are of the invested part only. */
  cash: z.boolean(),
  detail: z.enum(SHARE_DETAILS),
  /** A name shown on the page or image, or null to stay anonymous. */
  owner: z.string().trim().max(40).nullable(),
  sections: z.object({
    allocation: z.boolean(),
    holdings: z.boolean(),
    sectors: z.boolean(),
    performance: z.boolean(),
  }),
  range: z.enum(SHARE_RANGES),
});

export type ShareOptions = z.infer<typeof shareOptionsSchema>;

/** The safest starting point: no dollar amounts, no share counts, no name. */
export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  amounts: 'hidden',
  shares: false,
  returns: true,
  nasdaq: false,
  cash: true,
  detail: 'all',
  owner: null,
  sections: { allocation: true, holdings: true, sectors: true, performance: true },
  range: '1Y',
};

/** Resolve options that contradict each other, so a view can never show more than the person asked for. */
export function normalizeShareOptions(options: ShareOptions): ShareOptions {
  const detail = options.detail;
  return {
    ...options,
    owner: options.owner?.trim() ? options.owner.trim() : null,
    nasdaq: options.nasdaq === true && options.returns,
    shares: options.amounts === 'exact' && detail !== 'sectors' ? options.shares : false,
    sections: {
      allocation: options.sections.allocation,
      holdings: options.sections.holdings && detail !== 'sectors',
      sectors: options.sections.sectors,
      performance: options.sections.performance && options.returns,
    },
  };
}

export const SHARE_EXPIRIES = ['never', '1d', '7d', '30d', '90d'] as const;
export type ShareExpiry = (typeof SHARE_EXPIRIES)[number];
export const SHARE_MODES = ['live', 'snapshot'] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

export const AMOUNT_LABEL: Record<ShareAmounts, string> = { exact: 'Exact', scaled: `$${SCALED_BASE / 1000}K model`, hidden: 'Hidden' };
export const DETAIL_LABEL: Record<ShareDetail, string> = { all: 'All', top10: 'Top 10', top5: 'Top 5', sectors: 'Sectors only' };

/** A link as the browser receives it (dates are ISO strings). */
export type ShareLinkItem = {
  id: string;
  token: string;
  title: string | null;
  message: string | null;
  mode: ShareMode;
  options: ShareOptions;
  protected: boolean;
  status: 'ok' | 'expired' | 'revoked';
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

/** What a link or image reveals, in a few words. */
export function describeShare(options: ShareOptions): string {
  const parts: string[] = [
    options.amounts === 'exact' ? 'Exact amounts' : options.amounts === 'scaled' ? `Scaled to $${SCALED_BASE / 1000}K` : 'Percentages only',
    options.detail === 'sectors' ? 'Sectors only' : options.detail === 'all' ? 'All holdings' : DETAIL_LABEL[options.detail],
  ];
  if (!options.returns) parts.push('No returns');
  return parts.join(' · ');
}

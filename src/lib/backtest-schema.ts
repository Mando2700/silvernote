import { z } from 'zod';

import { PRICE_FIELDS, SCORE_FIELDS } from '@/lib/finance/backtest';

const field = z.enum([...SCORE_FIELDS, ...PRICE_FIELDS]);

const condition = z.object({
  field,
  op: z.enum(['gt', 'lt', 'rising', 'falling', 'top', 'bottom']),
  value: z.number().min(-1e6).max(1e6).optional(),
  lookback: z.number().int().min(1).max(24).optional(),
});

export const strategySchema = z.object({
  entry: z.array(condition).min(1, 'Add at least one entry rule').max(10),
  exit: z.array(condition).max(10),
  rebalance: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  maxPositions: z.number().int().min(1).max(200),
  rankBy: field,
  weighting: z.enum(['equal', 'signal']),
  costBps: z.number().min(0).max(500),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minMarketCap: z.number().min(0).max(10_000).optional(),
  sectors: z.array(z.string().max(60)).max(20).optional(),
});

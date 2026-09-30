import { z } from 'zod';

import { symbolSchema } from '@/lib/api';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const decisionSchema = z.object({
  symbol: symbolSchema,
  direction: z.enum(['long', 'short', 'avoid']),
  entry_price: z.number().positive().nullable().optional(),
  entry_date: date.optional(),
  target_price: z.number().positive().nullable().optional(),
  stop_price: z.number().positive().nullable().optional(),
  horizon_date: date.nullable().optional(),
  confidence: z.number().int().min(50).max(100),
  rationale: z.string().max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
});

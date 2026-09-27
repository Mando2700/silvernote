import { z } from 'zod';

export const screenDefinition = z.object({
  search: z.string().max(80).optional(),
  sectors: z.array(z.string().max(60)).max(20).optional(),
  industries: z.array(z.string().max(120)).max(50).optional(),
  filters: z
    .array(z.object({ key: z.string().max(40), min: z.number().nullable().optional(), max: z.number().nullable().optional() }))
    .max(30)
    .optional(),
  sort: z.object({ key: z.string().max(40), dir: z.enum(['asc', 'desc']) }).optional(),
  columns: z.array(z.string().max(40)).max(30).optional(),
  relative: z.boolean().optional(),
});

export type ScreenDefinition = z.infer<typeof screenDefinition>;

export const THESIS_SECTIONS = ['thesis', 'drivers', 'risks', 'catalysts', 'disconfirming', 'valuation'] as const;
export type ThesisSection = (typeof THESIS_SECTIONS)[number];

export const THESIS_SECTION_META: Record<ThesisSection, { title: string; prompt: string }> = {
  thesis: { title: 'Thesis', prompt: 'Why this company, why now, and what the market is missing.' },
  drivers: { title: 'Key drivers', prompt: 'The few variables that move the value: volumes, pricing, margins, capital returns.' },
  risks: { title: 'Risks', prompt: 'What could go wrong, how likely it is, and how much it would cost.' },
  catalysts: { title: 'Catalysts', prompt: 'Events that could close the gap between price and value, with timing.' },
  disconfirming: { title: 'What would prove me wrong', prompt: 'Specific, observable signals that would break the thesis. Decide them now, not later.' },
  valuation: { title: 'Valuation', prompt: 'Your fair-value range, the method, and the key assumptions.' },
};

import { z } from 'zod';

import { body, route } from '@/lib/api';
import { buildWorkbook, xlsxResponse } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';

const cell = z.union([z.string().max(2000), z.number(), z.null()]);
const schema = z.object({
  filename: z.string().max(120),
  sheets: z
    .array(
      z.object({
        name: z.string().max(60),
        title: z.string().max(300).optional(),
        columns: z.array(z.object({ header: z.string().max(80), key: z.string().max(60), format: z.enum(['text', 'number', 'integer', 'currency', 'currencyMillions', 'percent', 'multiple', 'date']).optional(), width: z.number().max(80).optional() })).max(80),
        rows: z.array(z.record(z.string(), cell.optional())).max(10_000),
        notes: z.array(z.string().max(1000)).max(20).optional(),
      }),
    )
    .min(1)
    .max(12),
  sources: z.array(z.string().max(1000)).max(20).default([]),
});

/** Any table on screen (screens, comps, DCF, holdings, event studies) as a formatted workbook. */
export const POST = route(async ({ request }) => {
  const input = await body(request, schema);
  const buffer = await buildWorkbook(input.sheets, input.sources);
  return xlsxResponse(buffer, input.filename.endsWith('.xlsx') ? input.filename : `${input.filename}.xlsx`);
});

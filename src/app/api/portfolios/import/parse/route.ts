import { z } from 'zod';

import { body, route } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { GrokError } from '@/lib/ai/grok';
import { env } from '@/lib/env';
import { buildImportCandidates, extractHoldingsFromImage, mergeDuplicateHoldings } from '@/lib/services/portfolio-import';

export const dynamic = 'force-dynamic';
// Each photo gets up to two vision passes.
export const maxDuration = 120;

const MAX_IMAGE_BASE64_LENGTH = 10_500_000;

const schema = z.object({
  images: z
    .array(
      z.object({
        base64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH, 'Photo is too large. Crop it to the holdings.'),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }),
    )
    .min(1)
    .max(4),
});

/** Read holdings from 1–4 portfolio photos. Returns rows to review; nothing is saved. */
export const POST = route(async ({ request }) => {
  if (!env.xaiKey) throw new HttpError(400, 'Photo import uses Grok. Set XAI_API_KEY in .env.local to enable it.');
  const { images } = await body(request, schema);
  try {
    const results = await Promise.all(images.map((image) => extractHoldingsFromImage({ base64: image.base64.replace(/^data:[^,]+,/, ''), mimeType: image.mimeType })));
    const rows = mergeDuplicateHoldings(results.flatMap((result) => result.holdings));
    const candidates = await buildImportCandidates(rows);
    return {
      candidates,
      notes: [...new Set(results.flatMap((result) => result.notes))],
      ignoredSensitiveData: [...new Set(results.flatMap((result) => result.ignoredSensitiveData))],
      unreadable: results.some((result) => result.imageAssessment && !result.imageAssessment.readable),
      partial: results.some((result) => result.imageAssessment?.partialScreenshot),
    };
  } catch (error) {
    if (error instanceof GrokError) throw new HttpError(error.status >= 500 || error.status === 429 ? 502 : 400, `Couldn’t read the photo: ${error.message}`);
    throw error;
  }
});

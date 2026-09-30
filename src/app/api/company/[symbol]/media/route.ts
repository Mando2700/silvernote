import { route, symbolSchema } from '@/lib/api';
import { getCompanyMedia } from '@/lib/services/company-media';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const media = await getCompanyMedia(symbol).catch(() => null);
  return {
    headquarters: media?.headquarters ?? null,
    // Thumbnail URLs stay server-side: images are served through the route below.
    images: (media?.images ?? []).map((image) => ({ ...image, thumbUrl: undefined })),
  };
});

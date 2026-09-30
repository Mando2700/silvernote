import { notFound, route, symbolSchema } from '@/lib/api';
import { getCompanyImage } from '@/lib/services/company-media';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string; id: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  if (!/^[0-9a-f]{12}$/.test(params.id)) notFound('Image not found.');
  const image = await getCompanyImage(symbol, params.id);
  if (!image) notFound('Image not found.');
  return new Response(new Blob([image as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=604800, stale-while-revalidate=2592000',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
});

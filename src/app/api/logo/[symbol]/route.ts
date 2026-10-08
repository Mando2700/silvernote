import { route, symbolSchema } from '@/lib/api';
import { getAsset } from '@/lib/data/assets';
import { getLogo } from '@/lib/services/logos';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  // Commodities and crypto have no company logo; a lookup by their symbol could find an unrelated one.
  const logo = getAsset(symbol) ? null : await getLogo(symbol);
  if (!logo) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=86400' } });
  }
  return new Response(new Blob([logo.data as Uint8Array<ArrayBuffer>], { type: logo.contentType }), {
    headers: {
      'Content-Type': logo.contentType,
      'Cache-Control': 'private, max-age=604800, stale-while-revalidate=2592000',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
});

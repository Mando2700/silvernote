import { route, symbolSchema } from '@/lib/api';
import { getLogo } from '@/lib/services/logos';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const logo = await getLogo(symbol);
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

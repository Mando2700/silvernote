import { notFound, route, symbolSchema } from '@/lib/api';
import { getAssetDetails } from '@/lib/services/assets';

export const dynamic = 'force-dynamic';

/** Commodity and crypto details: market data, performance, and contract terms or supply. */
export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const details = await getAssetDetails(symbol);
  if (!details) notFound(`${symbol} is not a commodity or crypto asset.`);
  return details;
});

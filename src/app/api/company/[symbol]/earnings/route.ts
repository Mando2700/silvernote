import { route, symbolSchema } from '@/lib/api';
import { getAsset } from '@/lib/data/assets';
import { getNextEarnings } from '@/lib/services/calendar';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  // Commodities and crypto don't report earnings.
  return { symbol, earnings: getAsset(symbol) ? null : await getNextEarnings(symbol) };
});

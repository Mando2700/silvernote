import { route, symbolSchema } from '@/lib/api';
import { getCompanyProfile } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  return { symbol, profile: await getCompanyProfile(symbol).catch(() => null) };
});

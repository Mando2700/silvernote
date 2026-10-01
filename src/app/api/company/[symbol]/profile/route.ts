import { route, searchParam, symbolSchema } from '@/lib/api';
import { getCompanyProfile } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ request, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  return { symbol, profile: await getCompanyProfile(symbol, { fast: searchParam(request, 'fast') === '1', lite: searchParam(request, 'lite') === '1' }).catch(() => null) };
});

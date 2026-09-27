import { route, searchParam, symbolSchema } from '@/lib/api';
import { getCompanyStatements } from '@/lib/services/statements';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ request, params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  const statements = await getCompanyStatements(symbol, { force: searchParam(request, 'refresh') === '1' });
  return statements ?? { symbol, annual: [], quarterly: [], ttm: null, currency: 'USD', source: 'none' };
});

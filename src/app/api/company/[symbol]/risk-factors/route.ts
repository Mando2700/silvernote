import { route, symbolSchema } from '@/lib/api';
import { getRiskFactorChanges } from '@/lib/services/sec-insights';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = route<{ symbol: string }>(async ({ params }) => {
  const symbol = symbolSchema.parse(params.symbol);
  return { changes: await getRiskFactorChanges(symbol) };
});

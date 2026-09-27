import { route, searchParam } from '@/lib/api';
import { getQuotes } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ request }) => {
  const symbols = (searchParam(request, 'symbols') ?? '')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9.\-]{1,16}$/.test(symbol))
    .slice(0, 300);
  return getQuotes(symbols);
});

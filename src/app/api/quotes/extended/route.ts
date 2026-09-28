import { route, searchParam } from '@/lib/api';
import { getExtendedQuotes } from '@/lib/services/market';

export const dynamic = 'force-dynamic';

/** Pre-market and after-hours moves for the given symbols (one Nasdaq request each, so capped). */
export const GET = route(async ({ request }) => {
  const symbols = (searchParam(request, 'symbols') ?? '')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9.\-]{1,16}$/.test(symbol))
    .slice(0, 60);
  return getExtendedQuotes(symbols);
});

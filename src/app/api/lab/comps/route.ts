import { z } from 'zod';

import { route, searchParam, symbolSchema } from '@/lib/api';
import { buildComps } from '@/lib/services/lab';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ request }) => {
  const symbol = symbolSchema.parse(searchParam(request, 'symbol'));
  const peers = (searchParam(request, 'peers') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return buildComps(symbol, peers.length ? z.array(symbolSchema).max(30).parse(peers) : undefined);
});

import { z } from 'zod';

import { route, searchParam } from '@/lib/api';
import { usdPerUnit } from '@/lib/data/providers/fx';

export const dynamic = 'force-dynamic';

/** Units of `currency` per 1 USD (e.g. PLN → ~3.6), for showing totals in the base currency. */
export const GET = route(async ({ request }) => {
  const currency = z.string().regex(/^[A-Z]{3}$/).parse((searchParam(request, 'currency') ?? 'USD').toUpperCase());
  const usd = await usdPerUnit(currency);
  return { currency, perUsd: usd ? 1 / usd : null };
});

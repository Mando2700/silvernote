import { route, symbolSchema } from '@/lib/api';
import { getDcfInputs } from '@/lib/services/dcf';

export const dynamic = 'force-dynamic';

export const GET = route<{ symbol: string }>(async ({ params }) => getDcfInputs(symbolSchema.parse(params.symbol)));

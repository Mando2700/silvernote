import { route } from '@/lib/api';
import { getPortfolio } from '@/lib/services/portfolio';
import { dividendForecast } from '@/lib/services/portfolio-tools';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async ({ user, params }) => dividendForecast(await getPortfolio(user.id, params.id)));

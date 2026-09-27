import { route } from '@/lib/api';
import { getDailyUsage } from '@/lib/data/http';
import { getConfigStatus } from '@/lib/env';
import { latestJobs } from '@/lib/jobs';
import { isMarketOpen } from '@/lib/services/prices';
import { scoreCoverage } from '@/lib/services/scores';
import { universeStatus } from '@/lib/services/universe';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const [universe, jobs, scores, fmpCalls] = await Promise.all([universeStatus(), latestJobs(), scoreCoverage(), getDailyUsage('fmp')]);
  return {
    user: { email: user.email, local: user.local },
    config: getConfigStatus(),
    universe,
    jobs,
    scores,
    marketOpen: isMarketOpen(),
    usage: { fmpCallsToday: fmpCalls },
  };
});

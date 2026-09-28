import { route } from '@/lib/api';
import { latestJobs } from '@/lib/jobs';
import { listSectors, PANEL_DEFAULTS, panelStatus } from '@/lib/services/backtest';

export const dynamic = 'force-dynamic';

/** Coverage of the point-in-time score history and the state of the job that builds it. */
export const GET = route(async () => {
  const [status, jobs] = await Promise.all([panelStatus(), latestJobs()]);
  return {
    panel: status,
    job: jobs.panel ?? null,
    defaults: PANEL_DEFAULTS,
    sectors: status?.rows ? await listSectors() : [],
  };
});

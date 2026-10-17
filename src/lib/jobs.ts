import 'server-only';

import { q, q1 } from '@/lib/db';
import { serverless } from '@/lib/platform';
import { forget, keepAlive, purgeExpiredCache, runInBackground } from '@/lib/data/http';
import { evaluatePriceAlerts } from '@/lib/services/alerts';
import { dueIbkrConnections, syncDueIbkr } from '@/lib/services/ibkr';
import { FUNDAMENTALS_VERSION, ingestFundamentals } from '@/lib/services/fundamentals';
import { buildScorePanel } from '@/lib/services/backtest';
import { getCandles, isMarketOpen } from '@/lib/services/prices';
import { computeUniverseScore } from '@/lib/services/scores';
import { getCompanyStatements, SCHEMA_VERSION } from '@/lib/services/statements';
import { refreshUniverse, universeStatus } from '@/lib/services/universe';

export type JobKind = 'universe' | 'fundamentals' | 'scores' | 'panel' | 'ibkr';

export type JobRow = {
  id: string;
  kind: JobKind;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  total: number;
  done: number;
  message: string | null;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

type Running = { id: string; cancelled: boolean };

const globalForJobs = globalThis as unknown as {
  __silvernoteJobs?: Map<JobKind, Running>;
  __silvernoteScheduler?: ReturnType<typeof setInterval>;
  __silvernoteTicking?: boolean;
  __silvernoteLastTick?: number;
};
const running = (globalForJobs.__silvernoteJobs ??= new Map());

type Reporter = (done: number, total: number, message: string) => void;

function reporter(id: string): Reporter {
  let last = 0;
  let pending: { done: number; total: number; message: string } | null = null;
  return (done, total, message) => {
    pending = { done, total, message };
    const now = Date.now();
    if (now - last < 1500 && done < total) return;
    last = now;
    const snapshot = pending;
    q('update public.jobs set done = $2, total = $3, message = $4 where id = $1', [id, snapshot.done, snapshot.total, snapshot.message]).catch(() => {});
  };
}

async function runUniverse(report: Reporter) {
  report(0, 100, 'Downloading market snapshot…');
  // Serverless: the function is killed at 300 s (off hours the quote sweep runs slower than that), so stop in time to finish cleanly.
  const deadline = serverless ? Date.now() + 230_000 : undefined;
  const result = await refreshUniverse((message, fraction) => report(Math.min(99, Math.round(fraction * 100)), 100, message), deadline);
  forget('universe:');
  forget('group:');
  await evaluatePriceAlerts().catch(() => 0);
  const left = result.left ? ` · ${result.left.toLocaleString()} left for the next run` : '';
  report(100, 100, `${result.count.toLocaleString()} securities updated · ${result.quoted.toLocaleString()} quoted live${left}`);
}

async function runFundamentals(report: Reporter) {
  const result = await ingestFundamentals(report);
  forget('universe:');
  forget('group:');
  report(result.requests, result.requests, `Fundamentals for ${result.companies.toLocaleString()} companies`);
}

async function runScores(report: Reporter, job: Running, params: { minMarketCap?: number; symbols?: string[] }) {
  const spy = await getCandles('SPY', 2);
  const targets = params.symbols?.length
    ? params.symbols.map((symbol) => ({ symbol: symbol.toUpperCase() }))
    : await q<{ symbol: string; has_statements: boolean }>(
        // Every listed common stock with a price is a target, not just companies that already have
        // universe (frames) statements — full filings are fetched on the way for the rest, and
        // computeUniverseScore falls back to a low-confidence, price-only score when none are found.
        // Frames sets that stopped updating (a switch to IFRS) and detailed sets built by an older
        // standardizer are refetched too, so the score never runs on stale or incomplete filings.
        `select s.symbol, (st.symbol is not null
            and not (st.source = 'sec-frames' and (st.periods->0->>'periodEnd')::date < now() - interval '15 months')
            and not (st.source <> 'sec-frames' and coalesce((st.meta->>'schema')::int, 0) < $2)) as has_statements
         from public.securities s
         left join public.statement_sets st on st.symbol = s.symbol and st.frequency = 'annual'
         left join public.scores sc on sc.symbol = s.symbol
         where s.listed and s.is_common and s.price is not null
           and coalesce(s.market_cap, 0) >= $1
           and (sc.calculated_at is null or sc.calculated_at < now() - interval '6 days')
         order by s.market_cap desc nulls last`,
        [params.minMarketCap ?? 0, SCHEMA_VERSION],
      );
  const total = targets.length;
  let done = 0;
  let scored = 0;
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      for (;;) {
        if (job.cancelled) return;
        const next = queue.shift();
        if (!next) return;
        try {
          if ('has_statements' in next && !next.has_statements) await getCompanyStatements(next.symbol);
          if (await computeUniverseScore(next.symbol, spy)) scored += 1;
        } catch {
          // keep sweeping
        }
        done += 1;
        report(done, total, `Scored ${scored.toLocaleString()} of ${total.toLocaleString()} · ${next.symbol}`);
      }
    }),
  );
  forget('universe:');
  report(total, total, `Scored ${scored.toLocaleString()} companies`);
}

/** The GitHub Actions worker (scripts/worker.ts): a one-off process that runs the scheduler and waits for its jobs. */
const worker = process.env.SILVERNOTE_WORKER === '1';
/** On a serverless host the worker does the background work (free-plan function time runs out otherwise); SERVERLESS_SCHEDULER=on brings it back. */
const hostJobs = serverless && process.env.SERVERLESS_SCHEDULER === 'on';
/** Several processes share the jobs table: how long a "running" row may belong to another one (0: this process is the only one). */
const sharedRunMs = hostJobs ? 10 * 60_000 : serverless || worker ? 6 * 3_600_000 : 0;
const pendingWork = new Set<Promise<unknown>>();

export async function startJob(kind: JobKind, params: Record<string, unknown> = {}): Promise<string> {
  if (kind === 'fundamentals') params = { version: FUNDAMENTALS_VERSION, ...params };
  const existing = running.get(kind);
  if (existing) return existing.id;
  if (sharedRunMs) {
    // Each serverless instance and worker run has its own `running` map; another one may already be on this job.
    const other = await q1<{ id: string }>(
      `select id from public.jobs where kind = $1 and status = 'running' and started_at > now() - make_interval(secs => $2)
       order by started_at desc limit 1`,
      [kind, sharedRunMs / 1000],
    );
    if (other) return other.id;
  }
  const row = await q1<{ id: string }>(
    `insert into public.jobs (kind, status, params, started_at) values ($1, 'running', $2::jsonb, now()) returning id`,
    [kind, JSON.stringify(params)],
  );
  const id = row?.id as string;
  const job: Running = { id, cancelled: false };
  running.set(kind, job);
  const report = reporter(id);
  const work = runInBackground(async () => {
    try {
      if (kind === 'universe') await runUniverse(report);
      else if (kind === 'fundamentals') await runFundamentals(report);
      else if (kind === 'ibkr') await syncDueIbkr(report);
      else if (kind === 'panel') await buildScorePanel(report, job, params as { size?: number; years?: number });
      else await runScores(report, job, params as { minMarketCap?: number; symbols?: string[] });
      await q(`update public.jobs set status = $2, finished_at = now() where id = $1`, [id, job.cancelled ? 'cancelled' : 'done']);
    } catch (error) {
      await q(`update public.jobs set status = 'failed', error = $2, finished_at = now() where id = $1`, [id, (error as Error).message?.slice(0, 500) ?? 'failed']).catch(() => {});
    } finally {
      running.delete(kind);
    }
  });
  keepAlive(work);
  pendingWork.add(work);
  void work.finally(() => pendingWork.delete(work)).catch(() => {});
  return id;
}

/** Wait until every job this process started has finished (the worker exits after this). */
export async function settleJobs() {
  while (pendingWork.size) await Promise.allSettled([...pendingWork]);
}

/** Mark this process's running jobs failed, for a worker that is being stopped mid-run. */
export async function abandonJobs(reason: string) {
  const ids = [...running.values()].map((job) => job.id);
  if (ids.length) await q(`update public.jobs set status = 'failed', error = $2, finished_at = now() where id = any($1) and status = 'running'`, [ids, reason]).catch(() => {});
}

export function cancelJob(kind: JobKind) {
  const job = running.get(kind);
  if (job) job.cancelled = true;
  return Boolean(job);
}

export async function latestJobs() {
  const rows = await q<JobRow>(
    `select distinct on (kind) id, kind, status, total, done, message, error, created_at, started_at, finished_at
     from public.jobs order by kind, created_at desc`,
  );
  const byKind = Object.fromEntries(rows.map((row) => [row.kind, row])) as Partial<Record<JobKind, JobRow>>;
  // A job row left "running" by a previous server process is stale.
  for (const row of rows) {
    // Another process (serverless instance, worker run) may own it; only call it stale once it outlived that process's run.
    const owned = sharedRunMs && row.started_at && Date.now() - new Date(row.started_at).getTime() < sharedRunMs;
    if (row.status === 'running' && !running.has(row.kind) && !owned) {
      row.status = 'failed';
      row.error = row.error ?? 'Interrupted by a server restart';
    }
  }
  return byKind;
}

/**
 * Last completed full run: a targeted run (a few symbols) must not postpone the universe-wide sweep,
 * and a run made by an older version of the job (fewer concepts) does not count.
 */
async function lastFinished(kind: JobKind, minVersion = 0) {
  const row = await q1<{ finished_at: Date }>(
    `select finished_at from public.jobs where kind = $1 and status = 'done' and not (coalesce(params, '{}'::jsonb) ? 'symbols')
       and coalesce((params->>'version')::int, 0) >= $2
     order by finished_at desc limit 1`,
    [kind, minVersion],
  );
  return row?.finished_at ? new Date(row.finished_at).getTime() : 0;
}

/**
 * Failed runs are retried with exponential backoff (15 min, 30 min, … up to 6 h) instead of
 * waiting for the next regular window, so one bad run can't leave data stale for a week.
 */
export async function inFailureBackoff(kind: JobKind, now = Date.now()) {
  const rows = await q<{ status: string; finished_at: Date | null }>(
    `select status, finished_at from public.jobs where kind = $1 order by created_at desc limit 6`,
    [kind],
  );
  let failures = 0;
  for (const row of rows) {
    if (row.status !== 'failed') break;
    failures += 1;
  }
  if (!failures || !rows[0]?.finished_at) return false;
  const wait = Math.min(6 * 3_600_000, 15 * 60_000 * 2 ** (failures - 1));
  return now - new Date(rows[0].finished_at).getTime() < wait;
}

async function unscoredCount() {
  const row = await q1<{ count: number }>(
    `select count(*)::int as count from public.securities s left join public.scores sc on sc.symbol = s.symbol
     where s.listed and s.is_common and s.price is not null and sc.symbol is null`,
  );
  return row?.count ?? 0;
}

/**
 * Decide what needs refreshing: prices every 5 min in market hours, fundamentals weekly, scores after.
 * Broker sync runs alongside those every few hours.
 */
export async function schedulerTick() {
  if (globalForJobs.__silvernoteTicking) return;
  globalForJobs.__silvernoteTicking = true;
  try {
    await q("update public.jobs set status = 'failed', error = 'Interrupted by a server restart', finished_at = now() where status = 'running' and started_at < now() - interval '6 hours'").catch(() => {});
    if (!running.has('ibkr') && (await dueIbkrConnections().catch(() => [])).length) await startJob('ibkr');
    const status = await universeStatus();
    const updated = status?.updated_at ? new Date(status.updated_at).getTime() : 0;
    const maxAge = isMarketOpen() ? 5 * 60_000 : 6 * 3_600_000;
    if (!status?.count || Date.now() - updated > maxAge) {
      if (!running.has('universe') && !(await inFailureBackoff('universe'))) await startJob('universe');
      return;
    }
    const week = 7 * 86_400_000;
    const fundamentalsAt = await lastFinished('fundamentals', FUNDAMENTALS_VERSION);
    if (Date.now() - fundamentalsAt > week) {
      if (!running.has('fundamentals') && !(await inFailureBackoff('fundamentals'))) await startJob('fundamentals', { version: FUNDAMENTALS_VERSION });
      return;
    }
    const scoresAt = await lastFinished('scores');
    if (!running.has('scores') && !running.has('fundamentals')) {
      // Weekly full sweep, plus a catch-up (at most every 6 hours) for newly listed or missed companies.
      const due = Date.now() - scoresAt > week || (Date.now() - scoresAt > 6 * 3_600_000 && (await unscoredCount()) > 0);
      if (due && !(await inFailureBackoff('scores'))) await startJob('scores', { minMarketCap: 0 });
    }
    if (Math.random() < 0.05) await purgeExpiredCache().catch(() => {});
  } catch (error) {
    console.error('[silvernote] scheduler tick failed:', (error as Error).message);
  } finally {
    globalForJobs.__silvernoteTicking = false;
  }
}

export function startScheduler() {
  if (worker || (serverless && !hostJobs)) return;
  if (serverless) {
    // Timers don't fire while a serverless instance is frozen: tick after a response instead, at most once a minute per instance.
    const now = Date.now();
    if (now - (globalForJobs.__silvernoteLastTick ?? 0) < 60_000) return;
    globalForJobs.__silvernoteLastTick = now;
    keepAlive(Promise.resolve().then(schedulerTick));
    return;
  }
  if (globalForJobs.__silvernoteScheduler) return;
  globalForJobs.__silvernoteScheduler = setInterval(() => void schedulerTick(), 60_000);
  setTimeout(() => void schedulerTick(), 2_000);
}

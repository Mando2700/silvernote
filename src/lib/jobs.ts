import 'server-only';

import { q, q1 } from '@/lib/db';
import { forget, purgeExpiredCache } from '@/lib/data/http';
import { evaluatePriceAlerts } from '@/lib/services/alerts';
import { ingestFundamentals } from '@/lib/services/fundamentals';
import { getCandles, isMarketOpen } from '@/lib/services/prices';
import { computeUniverseScore } from '@/lib/services/scores';
import { getCompanyStatements } from '@/lib/services/statements';
import { refreshUniverse, universeStatus } from '@/lib/services/universe';

export type JobKind = 'universe' | 'fundamentals' | 'scores';

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
  report(0, 1, 'Downloading market snapshot…');
  const result = await refreshUniverse((message) => report(0, 1, message));
  forget('universe:');
  forget('group:');
  await evaluatePriceAlerts().catch(() => 0);
  report(1, 1, `${result.count.toLocaleString()} securities updated`);
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
        `select s.symbol, (st.symbol is not null) as has_statements from public.securities s
         left join public.statement_sets st on st.symbol = s.symbol and st.frequency = 'annual'
         left join public.scores sc on sc.symbol = s.symbol
         where s.listed and s.is_common and s.price is not null
           and coalesce(s.market_cap, 0) >= $1
           and (sc.calculated_at is null or sc.calculated_at < now() - interval '6 days')
         order by s.market_cap desc nulls last`,
        [params.minMarketCap ?? 0],
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

export async function startJob(kind: JobKind, params: Record<string, unknown> = {}): Promise<string> {
  const existing = running.get(kind);
  if (existing) return existing.id;
  const row = await q1<{ id: string }>(
    `insert into public.jobs (kind, status, params, started_at) values ($1, 'running', $2::jsonb, now()) returning id`,
    [kind, JSON.stringify(params)],
  );
  const id = row?.id as string;
  const job: Running = { id, cancelled: false };
  running.set(kind, job);
  const report = reporter(id);
  void (async () => {
    try {
      if (kind === 'universe') await runUniverse(report);
      else if (kind === 'fundamentals') await runFundamentals(report);
      else await runScores(report, job, params as { minMarketCap?: number; symbols?: string[] });
      await q(`update public.jobs set status = $2, finished_at = now() where id = $1`, [id, job.cancelled ? 'cancelled' : 'done']);
    } catch (error) {
      await q(`update public.jobs set status = 'failed', error = $2, finished_at = now() where id = $1`, [id, (error as Error).message?.slice(0, 500) ?? 'failed']).catch(() => {});
    } finally {
      running.delete(kind);
    }
  })();
  return id;
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
    if (row.status === 'running' && !running.has(row.kind)) {
      row.status = 'failed';
      row.error = row.error ?? 'Interrupted by a server restart';
    }
  }
  return byKind;
}

async function lastFinished(kind: JobKind) {
  const row = await q1<{ finished_at: Date }>(
    `select finished_at from public.jobs where kind = $1 and status = 'done' order by finished_at desc limit 1`,
    [kind],
  );
  return row?.finished_at ? new Date(row.finished_at).getTime() : 0;
}

/** Decide what needs refreshing: prices every 5 min in market hours, fundamentals weekly, scores after. */
export async function schedulerTick() {
  if (globalForJobs.__silvernoteTicking) return;
  globalForJobs.__silvernoteTicking = true;
  try {
    await q("update public.jobs set status = 'failed', error = 'Interrupted by a server restart', finished_at = now() where status = 'running' and started_at < now() - interval '6 hours'").catch(() => {});
    const status = await universeStatus();
    const updated = status?.updated_at ? new Date(status.updated_at).getTime() : 0;
    const maxAge = isMarketOpen() ? 5 * 60_000 : 6 * 3_600_000;
    if (!status?.count || Date.now() - updated > maxAge) {
      if (!running.has('universe')) await startJob('universe');
      return;
    }
    const week = 7 * 86_400_000;
    const fundamentalsAt = await lastFinished('fundamentals');
    if (Date.now() - fundamentalsAt > week) {
      if (!running.has('fundamentals')) await startJob('fundamentals');
      return;
    }
    const scoresAt = await lastFinished('scores');
    if (Date.now() - scoresAt > week && !running.has('scores') && !running.has('fundamentals')) {
      await startJob('scores', { minMarketCap: 0 });
    }
    if (Math.random() < 0.05) await purgeExpiredCache().catch(() => {});
  } catch (error) {
    console.error('[silvernote] scheduler tick failed:', (error as Error).message);
  } finally {
    globalForJobs.__silvernoteTicking = false;
  }
}

export function startScheduler() {
  if (globalForJobs.__silvernoteScheduler) return;
  globalForJobs.__silvernoteScheduler = setInterval(() => void schedulerTick(), 60_000);
  setTimeout(() => void schedulerTick(), 2_000);
}

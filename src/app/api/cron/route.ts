import { NextResponse } from 'next/server';

import { runCron } from '@/lib/cron';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The background scheduler's entry point for hosts that call it over HTTP, with `Authorization: Bearer $CRON_SECRET`.
 * The Vercel deployment leaves background work to the GitHub Actions worker (scripts/worker.ts) unless VERCEL_SCHEDULER=on.
 */
export async function GET(request: Request) {
  if (!env.cronSecret) return NextResponse.json({ error: 'CRON_SECRET is not set.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${env.cronSecret}`) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const started = Date.now();
  const steps = await runCron();
  return NextResponse.json({ ok: steps.every((step) => step.ok), ms: Date.now() - started, steps });
}

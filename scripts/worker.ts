export {};

/**
 * One scheduler run outside the web server: refresh data, check alerts, deliver notifications, write
 * due briefs, then wait for the jobs it started (price sweep, fundamentals, scores) and exit.
 * The Worker workflow (.github/workflows/worker.yml) runs it on GitHub Actions, so the deployment
 * itself does no background work. Locally:  npm run worker  (reads .env.local, like db:migrate)
 */
process.env.SILVERNOTE_WORKER = '1';
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local (GitHub Actions passes the settings as environment variables).
}

async function main() {
  const { runCron } = await import('../src/lib/cron');
  const { abandonJobs, settleJobs } = await import('../src/lib/jobs');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`${signal}: stopping, marking unfinished jobs failed`);
      void abandonJobs('Worker stopped before the job finished').finally(() => process.exit(1));
    });
  }

  const started = Date.now();
  const steps = await runCron();
  // Only step names and outcomes: the logs of a public repository are public, so no portfolio details.
  for (const step of steps) console.log(`${step.ok ? '✓' : '✗'} ${step.step}`);
  await settleJobs();
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
  process.exit(steps.every((step) => step.ok) ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

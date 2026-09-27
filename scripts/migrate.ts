export {};

/**
 * Apply SilverNote's SQL migrations to the configured database.
 * Local PGlite is migrated automatically on startup; run this against Supabase
 * after setting DATABASE_URL in .env.local:  npm run db:migrate
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local: migrate the local database.
}

async function main() {
  const { getDb, q } = await import('../src/lib/db');
  const db = await getDb();
  const rows = await q<{ name: string; applied_at: Date }>(
    'select name, applied_at from public._silvernote_migrations order by name',
  );
  console.log(`Database (${db.kind}) is up to date:`);
  for (const row of rows) console.log(`  ✓ ${row.name}  (${row.applied_at.toISOString()})`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

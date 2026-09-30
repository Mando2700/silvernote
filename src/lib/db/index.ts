import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '@/lib/env';

type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

interface Driver extends Queryable {
  kind: 'pglite' | 'postgres';
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Run a multi-statement script without parameters (migrations). */
  exec(script: string): Promise<void>;
}

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const LOCAL_DATA_DIR = path.join(process.cwd(), '.silvernote');

// PGlite has no Supabase roles or `auth` schema. Recreate the small surface the migrations
// rely on so the same SQL (including RLS policies) runs locally.
const LOCAL_BOOTSTRAP = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$f$;
`;

/**
 * Objects become JSON text (callers cast with ::jsonb / ::json), arrays of objects too
 * (used with json_to_recordset). Arrays of primitives stay arrays for ::text[] params, and
 * binary values (Uint8Array/Buffer) pass through for bytea.
 */
function normalizeParams(params: unknown[] = []) {
  return params.map((value) => {
    if (value === undefined) return null;
    if (value === null || value instanceof Date || ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) {
      return value.some((item) => item !== null && typeof item === 'object') ? JSON.stringify(value) : value;
    }
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  });
}

async function createPglite(): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = path.join(LOCAL_DATA_DIR, 'db');
  await fs.mkdir(dataDir, { recursive: true });
  await acquireLocalLock();
  const pg = await PGlite.create(dataDir);

  return {
    kind: 'pglite',
    async query<T>(text: string, params?: unknown[]) {
      const result = await pg.query<T>(text, normalizeParams(params));
      return result.rows;
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      return pg.transaction(async (tx) =>
        fn({
          async query<R>(text: string, params?: unknown[]) {
            const result = await tx.query<R>(text, normalizeParams(params));
            return result.rows;
          },
        }),
      );
    },
    async exec(script: string) {
      await pg.exec(script);
    },
  };
}

async function createPostgres(url: string): Promise<Driver> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    // Every serverless instance keeps its own pool; a small one stops many instances from exhausting Supabase's connection limit.
    max: process.env.VERCEL ? 2 : 5,
    idle_timeout: 20,
    connect_timeout: 20,
    // Supabase's transaction pooler cannot use prepared statements.
    prepare: false,
    onnotice: () => {},
  });

  const run = async <T>(runner: typeof sql, text: string, params?: unknown[]) =>
    (await runner.unsafe(text, normalizeParams(params) as never[])) as unknown as T[];

  return {
    kind: 'postgres',
    query: <T>(text: string, params?: unknown[]) => run<T>(sql, text, params),
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      const result = await sql.begin((tx) =>
        fn({ query: <R>(text: string, params?: unknown[]) => run<R>(tx as unknown as typeof sql, text, params) }),
      );
      return result as T;
    },
    async exec(script: string) {
      // Scripts carry their own begin/commit (and rollback on failure), so pin them to one connection.
      const conn = await sql.reserve();
      try {
        await conn.unsafe(script).simple();
      } catch (error) {
        // Don't hand a connection with a half-open transaction back to the pool.
        await conn.unsafe('rollback;').simple().catch(() => {});
        throw error;
      } finally {
        conn.release();
      }
    },
  };
}

/** Refuse to open the local database from two processes at once (PGlite is single-process). */
async function acquireLocalLock() {
  const lockFile = path.join(LOCAL_DATA_DIR, 'db.lock');
  try {
    const existing = Number((await fs.readFile(lockFile, 'utf8')).trim());
    if (existing && existing !== process.pid && isProcessAlive(existing)) {
      throw new Error(
        `The local SilverNote database is already open in another process (pid ${existing}). Stop the other server first.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.writeFile(lockFile, String(process.pid));
  process.once('exit', () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('node:fs').unlinkSync(lockFile);
    } catch {
      // already gone
    }
  });
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function migrate(driver: Driver) {
  if (driver.kind === 'pglite') await driver.exec(LOCAL_BOOTSTRAP);
  await driver.exec(
    'create table if not exists public._silvernote_migrations (name text primary key, applied_at timestamptz not null default now());',
  );
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const applied = new Set(
    (await driver.query<{ name: string }>('select name from public._silvernote_migrations')).map((row) => row.name),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const script = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const safeName = file.replace(/'/g, "''");
    try {
      await driver.exec(`begin;\n${script}\ninsert into public._silvernote_migrations (name) values ('${safeName}');\ncommit;`);
    } catch (error) {
      await driver.exec('rollback;').catch(() => {});
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
}

async function init(): Promise<Driver> {
  const driver = env.databaseUrl ? await createPostgres(env.databaseUrl) : await createPglite();
  await migrate(driver);
  return driver;
}

const globalForDb = globalThis as unknown as {
  __silvernoteDb?: Promise<Driver>;
  __silvernoteMigrationCheck?: { at: number; files: string; running: Promise<void> | null };
};

/**
 * In development the server outlives code changes, so a migration added while it runs would never
 * apply (they run at startup) and queries would hit a missing column. Look for new files every few
 * seconds and apply them before the next query.
 */
async function applyNewMigrations(driver: Driver) {
  if (process.env.NODE_ENV === 'production') return;
  const state = (globalForDb.__silvernoteMigrationCheck ??= { at: Date.now(), files: '', running: null });
  if (state.running) return state.running;
  if (Date.now() - state.at < 3_000) return;
  state.at = Date.now();
  state.running = (async () => {
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort().join('|');
    if (files !== state.files) {
      await migrate(driver);
      state.files = files;
    }
  })().finally(() => {
    state.running = null;
  });
  return state.running;
}

export async function getDb(): Promise<Driver> {
  if (!globalForDb.__silvernoteDb) {
    globalForDb.__silvernoteDb = init().catch((error) => {
      globalForDb.__silvernoteDb = undefined;
      throw error;
    });
  }
  const driver = await globalForDb.__silvernoteDb;
  await applyNewMigrations(driver);
  return driver;
}

export async function q<T = Row>(text: string, params?: unknown[]): Promise<T[]> {
  const db = await getDb();
  return db.query<T>(text, params);
}

export async function q1<T = Row>(text: string, params?: unknown[]): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

export async function tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

export async function dbKind() {
  return (await getDb()).kind;
}

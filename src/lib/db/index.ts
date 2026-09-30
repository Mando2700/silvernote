import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import type { Pool } from 'pg';

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
 * binary values become Buffers for bytea.
 */
function normalizeParams(params: unknown[] = []) {
  return params.map((value) => {
    if (value === undefined) return null;
    if (value === null || value instanceof Date) return value;
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
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

/** A query with no answer this long is on a dead socket (typically left over from a frozen instance). */
const QUERY_WATCHDOG_MS = 60_000;

/**
 * Serverless instances are frozen between requests with their sockets still open. On Supabase's
 * session pooler (5432) each open socket pins one of a handful of server slots, so frozen instances
 * starve live ones; the transaction pooler (6543) only holds a slot while a query runs.
 */
export function serverlessDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('.pooler.supabase.com') && parsed.port === '5432') {
      parsed.port = '6543';
      return parsed.toString();
    }
  } catch {
    // not a URL we can reason about; use it as given
  }
  return url;
}

/** JSON columns, unwrapping rows an earlier driver stored as a JSON string scalar holding the JSON text. */
function parseJson(value: string) {
  const parsed = JSON.parse(value);
  if (typeof parsed === 'string' && /^\s*[[{]/.test(parsed)) {
    try {
      return JSON.parse(parsed);
    } catch {
      return parsed;
    }
  }
  return parsed;
}

async function createPostgres(rawUrl: string): Promise<Driver> {
  // node-postgres sends each query as one Parse/Bind/Execute/Sync batch, which Supabase's pooler
  // handles in both modes (postgres.js's describe round trip stalled there).
  const { default: pg } = await import('pg');
  const serverless = Boolean(process.env.VERCEL);
  const url = serverless ? serverlessDatabaseUrl(rawUrl) : rawUrl;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const types = {
    getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
      if (oid === 114 || oid === 3802) return parseJson;
      // A date is a calendar day: midnight UTC, not the server's local midnight.
      if (oid === 1082) return (value: string) => new Date(value);
      return pg.types.getTypeParser(oid, format);
    }) as typeof pg.types.getTypeParser,
  };
  const pool = new pg.Pool({
    connectionString: url,
    ssl: local ? undefined : { rejectUnauthorized: false },
    // Every serverless instance keeps its own pool; keep it small.
    max: serverless ? 3 : 5,
    idleTimeoutMillis: serverless ? 5_000 : 20_000,
    connectionTimeoutMillis: 20_000,
    maxLifetimeSeconds: serverless ? 5 * 60 : 0,
    types,
  });
  // A socket that dies while idle in the pool must not crash the process.
  pool.on('error', () => {});
  if (serverless) {
    // Keep the function alive until idle clients are released before Vercel freezes it.
    const { attachDatabasePool } = await import('@vercel/functions');
    attachDatabasePool(pool);
  }
  globalForDb.__silvernotePool = pool;

  const run = async <T>(runner: Pick<Pool, 'query'>, text: string, params?: unknown[]) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Drop the whole pool so the next request connects afresh instead of queueing behind dead sockets.
        if (globalForDb.__silvernotePool === pool) {
          globalForDb.__silvernotePool = undefined;
          globalForDb.__silvernoteDb = undefined;
        }
        void pool.end().catch(() => {});
        reject(new Error('The database did not answer in time. Please retry.'));
      }, QUERY_WATCHDOG_MS);
    });
    try {
      const result = await Promise.race([runner.query(text, normalizeParams(params)), watchdog]);
      return result.rows as T[];
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    kind: 'postgres',
    query: <T>(text: string, params?: unknown[]) => run<T>(pool, text, params),
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: <R>(text: string, params?: unknown[]) => run<R>(client, text, params) });
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async exec(script: string) {
      // Scripts carry their own begin/commit (and rollback on failure), so pin them to one connection.
      const client = await pool.connect();
      try {
        await client.query(script);
      } catch (error) {
        // Don't hand a connection with a half-open transaction back to the pool.
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        client.release();
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
  /** The live Postgres pool, so a watchdog on a replaced pool can't discard its successor. */
  __silvernotePool?: unknown;
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

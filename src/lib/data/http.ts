import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import { after } from 'next/server';

import { q, q1 } from '@/lib/db';

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

const backgroundWork = new AsyncLocalStorage<true>();

const urgentWork = new AsyncLocalStorage<true>();

/** Run `fn` as urgent: its provider requests jump the queue ahead of other waiting requests (the price a page header waits on). */
export function runUrgent<T>(fn: () => Promise<T>): Promise<T> {
  return urgentWork.run(true, fn);
}

/** Run `fn` as background work: its provider requests yield to the ones a page is waiting on. */
export function runInBackground<T>(fn: () => Promise<T>): Promise<T> {
  return backgroundWork.run(true, fn);
}

/**
 * Spaces out requests to one provider and caps how many run at once. Background work (jobs) queues
 * behind requests a page is waiting on and never takes the last slot, so a long sweep can't stall the UI.
 */
export class RateLimiter {
  private nextSlot = 0;
  private active = 0;
  private waiting: Array<() => void> = [];
  private waitingBackground: Array<() => void> = [];

  constructor(
    private readonly minIntervalMs: number,
    private readonly concurrency: number,
  ) {}

  private get backgroundLimit() {
    return Math.max(1, this.concurrency - 1);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const background = backgroundWork.getStore() === true;
    const urgent = !background && urgentWork.getStore() === true;
    if (background ? this.active >= this.backgroundLimit || this.waiting.length > 0 : this.active >= this.concurrency) {
      await new Promise<void>((resolve) => {
        if (background) this.waitingBackground.push(resolve);
        else if (urgent) this.waiting.unshift(resolve);
        else this.waiting.push(resolve);
      });
    }
    this.active += 1;
    try {
      const now = Date.now();
      const wait = Math.max(0, this.nextSlot - now);
      this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;
      if (wait > 0) await sleep(wait);
      return await task();
    } finally {
      this.active -= 1;
      if (this.waiting.length) this.waiting.shift()?.();
      else if (this.active < this.backgroundLimit) this.waitingBackground.shift()?.();
    }
  }
}

export const limiters = {
  sec: new RateLimiter(125, 4), // SEC fair-access: max 10 requests/second
  nasdaq: new RateLimiter(220, 3),
  finnhub: new RateLimiter(1050, 2), // free tier: 60/min
  fmp: new RateLimiter(250, 2),
  fred: new RateLimiter(300, 2),
  xai: new RateLimiter(0, 4),
  news: new RateLimiter(250, 3),
  yahoo: new RateLimiter(300, 2),
  wikimedia: new RateLimiter(100, 4),
};

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait at most `ms` for optional data: past that resolve `undefined` and let the work finish on its
 * own (its memo/cache entry then serves the next request).
 */
export async function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms)));
  work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

type FetchOptions = {
  provider: string;
  limiter?: RateLimiter;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
};

export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const { provider, limiter, headers, timeoutMs = 20_000, retries = 2 } = options;
  let attempt = 0;
  for (;;) {
    try {
      const run = async () => {
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
        });
        if (!response.ok) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const body = (await response.text().catch(() => '')).slice(0, 240);
          const error = new ProviderError(provider, response.status, `HTTP ${response.status} ${body}`.trim());
          (error as ProviderError & { retryAfterMs?: number }).retryAfterMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : undefined;
          throw error;
        }
        return response.text();
      };
      return limiter ? await limiter.run(run) : await run();
    } catch (error) {
      const status = error instanceof ProviderError ? error.status : 0;
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= retries) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(provider, 0, (error as Error).message || 'network error');
      }
      attempt += 1;
      const hinted = (error as { retryAfterMs?: number }).retryAfterMs;
      await sleep(hinted ?? 600 * 2 ** attempt + Math.random() * 250);
    }
  }
}

export async function fetchJson<T>(url: string, options: FetchOptions): Promise<T> {
  const text = await fetchText(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(options.provider, 0, 'invalid JSON response');
  }
}

// ─── Caching ────────────────────────────────────────────────────────────────

type MemoEntry = { expires: number; value: unknown };
const globalForMemo = globalThis as unknown as {
  __silvernoteMemo?: Map<string, MemoEntry>;
  __silvernoteInflight?: Map<string, Promise<unknown>>;
};
const memoStore = (globalForMemo.__silvernoteMemo ??= new Map());
const inflight = (globalForMemo.__silvernoteInflight ??= new Map());

/** In-process cache with request de-duplication. */
export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memoStore.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = load()
    .then((value) => {
      memoStore.set(key, { value, expires: Date.now() + ttlMs });
      if (memoStore.size > 5000) {
        const oldest = memoStore.keys().next().value;
        if (oldest) memoStore.delete(oldest);
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function forget(prefix: string) {
  for (const key of memoStore.keys()) if (key.startsWith(prefix)) memoStore.delete(key);
}

/** True inside runInBackground (jobs): such callers want current data and can afford to wait for it. */
export function inBackground() {
  return backgroundWork.getStore() === true;
}

/**
 * Keep the serverless instance alive until `work` settles when there is a request to attach it to
 * (Vercel freezes an instance once its response is sent).
 */
export function keepAlive(work: Promise<unknown>) {
  // Failures are the work's own business (a background refresh keeps the old value); never leave them unhandled.
  const settled = work.catch(() => {});
  try {
    after(() => settled);
  } catch {
    // outside a request (background job, local timer): the process keeps running anyway
  }
}

const refreshing = new Map<string, Promise<unknown>>();

/** Load and store one cache entry; concurrent refreshes of a key share one load. */
function refreshCached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const pending = refreshing.get(key);
  if (pending) return pending as Promise<T>;
  const promise = (async () => {
    const value = await load();
    await q(
      `insert into public.api_cache (key, payload, fetched_at, expires_at)
       values ($1, $2::jsonb, now(), now() + make_interval(secs => $3))
       on conflict (key) do update set payload = excluded.payload, fetched_at = now(), expires_at = excluded.expires_at`,
      [key, JSON.stringify(value ?? null), ttlSeconds],
    );
    memoStore.set(`db:${key}`, { value, expires: Date.now() + Math.min(ttlSeconds * 1000, 60_000) });
    return value;
  })().finally(() => refreshing.delete(key));
  refreshing.set(key, promise);
  return promise;
}

/**
 * Database-backed cache for provider payloads, shared by every server instance. Fresh rows are
 * returned directly. An expired row is still returned at once while a background refresh replaces
 * it (a page never waits on a slow provider for data it already has); if that refresh fails the old
 * row stays. Only a key with no row at all waits for the provider. Background jobs always wait for
 * a refresh of an expired row, since they are there to bring data up to date.
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  return memo(`db:${key}`, Math.min(ttlSeconds * 1000, 60_000), async () => {
    const row = await q1<{ payload: T; fresh: boolean }>(
      'select payload, expires_at > now() as fresh from public.api_cache where key = $1',
      [key],
    );
    if (row?.fresh) return row.payload;
    if (row && !inBackground()) {
      keepAlive(runInBackground(() => refreshCached(key, ttlSeconds, load)));
      return row.payload;
    }
    try {
      return await refreshCached(key, ttlSeconds, load);
    } catch (error) {
      if (row) return row.payload;
      throw error;
    }
  });
}

export async function purgeExpiredCache() {
  await q("delete from public.api_cache where expires_at < now() - interval '7 days'");
}

// ─── Daily budgets (FMP free tier = 250 calls/day) ──────────────────────────

export async function takeDailyBudget(provider: string, limit: number): Promise<boolean> {
  const row = await q1<{ calls: number }>(
    `insert into public.provider_usage (provider, day, calls) values ($1, current_date, 1)
     on conflict (provider, day) do update set calls = public.provider_usage.calls + 1
     returning calls`,
    [provider],
  );
  return (row?.calls ?? 0) <= limit;
}

export async function getDailyUsage(provider: string) {
  const row = await q1<{ calls: number }>(
    'select calls from public.provider_usage where provider = $1 and day = current_date',
    [provider],
  );
  return row?.calls ?? 0;
}

// ─── Parsing helpers shared by providers ────────────────────────────────────

/** "$1,234.50" / "4.55%" / "N/A" → number | null */
export function parseLooseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[$,%\s+]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!cleaned || cleaned === 'N/A' || cleaned === 'NA' || cleaned === '--') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ q: vi.fn(async () => []), q1: vi.fn(async () => null) }));
vi.mock('next/server', () => ({
  after: () => {
    throw new Error('outside a request');
  },
}));

const db = await import('@/lib/db');
const { cached, RateLimiter, runInBackground, within } = await import('./http');

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

describe('RateLimiter', () => {
  it('lets a page request past queued background work', async () => {
    const limiter = new RateLimiter(0, 2);
    const order: string[] = [];
    const gate = deferred();
    // Background work may hold only one of the two slots; the rest of the sweep queues.
    const sweep = runInBackground(() =>
      Promise.all(
        ['bg1', 'bg2', 'bg3'].map((name) =>
          limiter.run(async () => {
            order.push(name);
            await gate.promise;
          }),
        ),
      ),
    );
    await Promise.resolve();
    const page = limiter.run(async () => {
      order.push('page');
    });
    await page;
    expect(order).toEqual(['bg1', 'page']);
    gate.resolve();
    await sweep;
    expect(order).toEqual(['bg1', 'page', 'bg2', 'bg3']);
  });

  it('still caps page requests at the full concurrency', async () => {
    const limiter = new RateLimiter(0, 2);
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});

describe('within', () => {
  it('returns the value when it arrives in time', async () => {
    await expect(within(Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it('gives up on slow work without rejecting', async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 100));
    await expect(within(slow, 10)).resolves.toBeUndefined();
  });
});

describe('cached', () => {
  const upserts = () => vi.mocked(db.q).mock.calls.filter(([sql]) => String(sql).includes('insert into public.api_cache'));

  it('serves a fresh row without calling the provider', async () => {
    vi.mocked(db.q1).mockResolvedValueOnce({ payload: { price: 1 }, fresh: true });
    const load = vi.fn(async () => ({ price: 2 }));
    await expect(cached('test:fresh', 60, load)).resolves.toEqual({ price: 1 });
    expect(load).not.toHaveBeenCalled();
  });

  it('serves an expired row at once and refreshes it in the background', async () => {
    vi.mocked(db.q).mockClear();
    vi.mocked(db.q1).mockResolvedValueOnce({ payload: { price: 1 }, fresh: false });
    let finish: (value: { price: number }) => void = () => {};
    const load = vi.fn(() => new Promise<{ price: number }>((resolve) => (finish = resolve)));
    await expect(cached('test:stale', 60, load)).resolves.toEqual({ price: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    finish({ price: 2 });
    await vi.waitFor(() => expect(upserts()).toHaveLength(1));
    expect(upserts()[0][1]).toEqual(['test:stale', JSON.stringify({ price: 2 }), 60]);
    // The refreshed value replaces the stale one for this instance's next caller.
    await expect(cached('test:stale', 60, load)).resolves.toEqual({ price: 2 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the expired row when the background refresh fails', async () => {
    vi.mocked(db.q1).mockResolvedValueOnce({ payload: 'old', fresh: false });
    await expect(cached('test:stale-error', 60, async () => Promise.reject(new Error('down')))).resolves.toBe('old');
  });

  it('waits for the provider when nothing is stored', async () => {
    vi.mocked(db.q1).mockResolvedValueOnce(null);
    await expect(cached('test:missing', 60, async () => 'new')).resolves.toBe('new');
  });

  it('makes background jobs wait for a refresh of an expired row', async () => {
    vi.mocked(db.q1).mockResolvedValueOnce({ payload: 'old', fresh: false });
    await expect(runInBackground(() => cached('test:job', 60, async () => 'new'))).resolves.toBe('new');
  });
});

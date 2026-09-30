import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ q: vi.fn(), q1: vi.fn() }));

const { RateLimiter, runInBackground, within } = await import('./http');

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

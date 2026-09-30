import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ q: vi.fn(async () => []), q1: vi.fn(async () => null) }));
vi.mock('next/server', () => ({
  after: () => {
    throw new Error('outside a request');
  },
}));
vi.mock('@/lib/data/providers/nasdaq', () => ({ fetchDailyHistory: vi.fn(async () => []) }));
vi.mock('@/lib/data/providers/fmp', () => ({ fmpEnabled: () => false, fetchDailyHistory: vi.fn(async () => []) }));
vi.mock('@/lib/data/providers/fred', () => ({ fetchFredSeries: vi.fn(async () => []) }));

const db = await import('@/lib/db');
const nasdaq = await import('@/lib/data/providers/nasdaq');
const { runInBackground } = await import('@/lib/data/http');
const { getCandles } = await import('./prices');

const day = 86_400;
const now = Math.floor(Date.now() / 1000);
const stored = [
  [now - 5 * day, 1, 1, 1, 10, 100],
  [now - 4 * day, 1, 1, 1, 11, 100],
] as Array<[number, number, number, number, number, number | null]>;

function row(overrides: Partial<{ first_date: string; last_date: string; fetched_at: Date }>) {
  return {
    candles: stored,
    first_date: '2015-01-02',
    last_date: '2000-01-03',
    fetched_at: new Date(Date.now() - 2 * 86_400_000),
    adjusted_at: new Date(Date.now() - 30 * 86_400_000),
    ...overrides,
  };
}

describe('getCandles', () => {
  beforeEach(() => {
    vi.mocked(nasdaq.fetchDailyHistory).mockClear();
  });

  it('serves a stored history that misses the latest sessions at once and tops it up in the background', async () => {
    vi.mocked(db.q1).mockResolvedValueOnce(row({}));
    let finish = () => {};
    vi.mocked(nasdaq.fetchDailyHistory).mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve([]))));
    const candles = await getCandles('AAA', 1);
    expect(candles.map((candle) => candle.c)).toEqual([10, 11]);
    expect(nasdaq.fetchDailyHistory).toHaveBeenCalledTimes(1);
    finish();
  });

  it('does not re-download a young listing fetched a moment ago', async () => {
    vi.mocked(db.q1).mockResolvedValueOnce(row({ first_date: '2025-06-01', fetched_at: new Date() }));
    const candles = await getCandles('BBB', 10);
    expect(candles).toHaveLength(2);
    expect(nasdaq.fetchDailyHistory).not.toHaveBeenCalled();
  });

  it('waits for the download when nothing is stored', async () => {
    vi.mocked(db.q1).mockResolvedValueOnce(null);
    vi.mocked(nasdaq.fetchDailyHistory).mockResolvedValueOnce([{ t: now - day, o: 1, h: 1, l: 1, c: 12, v: 1 }]);
    const candles = await getCandles('CCC', 1);
    expect(candles.map((candle) => candle.c)).toEqual([12]);
  });

  it('makes background jobs wait for the top-up', async () => {
    vi.mocked(db.q1).mockResolvedValueOnce(row({}));
    vi.mocked(nasdaq.fetchDailyHistory).mockResolvedValueOnce([{ t: now - day, o: 1, h: 1, l: 1, c: 13, v: 1 }]);
    const candles = await runInBackground(() => getCandles('DDD', 1));
    expect(candles.map((candle) => candle.c)).toEqual([10, 11, 13]);
  });
});

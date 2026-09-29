'use client';

import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { api } from '@/lib/client';
import { alignReturns, dailyReturns, type DatedClose } from '@/lib/finance/stats';
import type { ProgressItem, RankSummary } from '@/lib/learn/rank';
import type { DcfInputs } from '@/lib/services/dcf';
import type { UniverseEntry } from '@/lib/services/screener';

export type LearnState = { progress: ProgressItem[]; rank: RankSummary };

type ProgressInput =
  | { kind: 'lesson'; slug: string; score: number; answers?: Record<string, number | string> }
  | { kind: 'drill'; type: string; correct: boolean }
  | { kind: 'card'; id: string; rating: 'nailed' | 'partial' | 'missed' }
  | { kind: 'read'; slug: string; sections: string[]; seconds: number };

/** Learn progress and rank, with a recorder that toasts XP gained and promotions. */
export function useLearn() {
  const { data, mutate, isLoading } = useSWR<LearnState>('/api/learn');
  const byId = useMemo(() => new Map((data?.progress ?? []).map((item) => [item.item_id, item])), [data]);
  const record = useCallback(
    async (input: ProgressInput, options: { quiet?: boolean } = {}) => {
      const before = data?.rank;
      try {
        const next = await api<LearnState>('/api/learn/progress', { body: input });
        await mutate(next, { revalidate: false });
        const gained = before ? next.rank.xp - before.xp : 0;
        if (before && next.rank.rankIndex > before.rankIndex) toast.success(`Promoted to ${next.rank.rank}`, { description: `${next.rank.xp.toLocaleString()} XP` });
        else if (gained > 0 && !options.quiet) toast.success(`+${gained} XP`, { description: `${next.rank.rank} · ${next.rank.xp.toLocaleString()} XP` });
        return next;
      } catch (error) {
        toast.error((error as Error).message);
        return null;
      }
    },
    [data, mutate],
  );
  return { state: data ?? null, isLoading, byId, record, refresh: mutate };
}

const NO_STALE = { keepPreviousData: false } as const;

/** Daily closes (never aggregated), for statistics on daily returns. */
export function useDailyCloses(symbol: string | null, years = 3) {
  const { data, error, isLoading } = useSWR<{ closes: DatedClose[] }>(symbol ? `/api/learn/closes/${encodeURIComponent(symbol)}?years=${years}` : null, NO_STALE);
  return { candles: data?.closes ?? null, error, isLoading };
}

export function useDcfInputs(symbol: string | null) {
  const { data, error, isLoading } = useSWR<DcfInputs>(symbol ? `/api/company/${encodeURIComponent(symbol)}/dcf` : null, NO_STALE);
  return { data: data ?? null, error, isLoading };
}

export type PeersPayload = {
  subject: UniverseEntry | null;
  peers: UniverseEntry[];
  sector: Record<string, number | null> | null;
};

export function usePeers(symbol: string | null) {
  const { data, error, isLoading } = useSWR<PeersPayload>(symbol ? `/api/company/${encodeURIComponent(symbol)}/peers` : null, NO_STALE);
  return { data: data ?? null, error, isLoading };
}

/** Daily returns of `symbol` and a benchmark aligned on shared dates. */
export function useAlignedReturns(symbol: string | null, benchmark = 'SPY', years = 3) {
  const asset = useDailyCloses(symbol, years);
  const market = useDailyCloses(symbol === benchmark ? null : benchmark, years);
  const aligned = useMemo(() => {
    if (!asset.candles?.length) return null;
    if (symbol === benchmark) {
      const own = dailyReturns(asset.candles);
      const dates = [...own.keys()].sort((a, b) => a - b);
      const values = dates.map((date) => own.get(date) as number);
      return { dates, asset: values, market: values, closes: asset.candles, marketCloses: asset.candles };
    }
    if (!market.candles?.length) return null;
    const { dates, matrix } = alignReturns([dailyReturns(asset.candles), dailyReturns(market.candles)]);
    return { dates, asset: matrix[0] ?? [], market: matrix[1] ?? [], closes: asset.candles, marketCloses: market.candles };
  }, [asset.candles, market.candles, symbol, benchmark]);
  return { aligned, isLoading: asset.isLoading || market.isLoading, error: asset.error ?? market.error };
}

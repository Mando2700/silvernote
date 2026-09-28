import type { StatementPeriod } from '@/lib/finance/statement-types';
import { isRealSplit, type Split } from '@/lib/finance/ledger';
import { betaFromCloses } from '@/lib/finance/stats';

import { calculateSilverNoteScore } from './engine';
import { buildScoreInput } from './input';
import type { ScoreCandle } from './types';

/** When a filing's figures could first have been known: its filing date, else 90 days after period end. */
export function availableOn(period: StatementPeriod) {
  if (period.filed) return period.filed;
  return new Date(Date.parse(`${period.periodEnd}T00:00:00Z`) + 90 * 86_400_000).toISOString().slice(0, 10);
}

/** Month-end dates covering the last `years`, with today standing in for the current month. */
export function monthEnds(years: number, today: string) {
  const [year, month] = today.split('-').map(Number);
  const dates: string[] = [];
  for (let offset = Math.round(years * 12); offset >= 1; offset -= 1) {
    dates.push(new Date(Date.UTC(year, month - offset, 0)).toISOString().slice(0, 10));
  }
  dates.push(today);
  return dates;
}

export type PointInTimeSource = {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  currency: string;
  fxToUsd: number;
  /** Newest first, as stored. */
  annual: StatementPeriod[];
  /** Ascending daily candles, time in epoch seconds. */
  candles: ScoreCandle[];
  benchmark: Array<{ t: number; c: number }>;
  /** Today's market value and price, to scale market value back in time when share counts aren't comparable. */
  currentMarketCap: number | null;
  currentPrice: number | null;
  /** Split history: prices are split-adjusted to today, filings are in the share units of their filing date. */
  splits?: Split[];
};

/** Shares today per share on `date`: the product of the splits after it. */
function unitsSince(splits: Split[] | undefined, date: string) {
  return (splits ?? []).filter((split) => isRealSplit(split) && split.date > date).reduce((product, split) => product * split.factor, 1);
}

/** A filing's per-share figures restated in today's share units, so they compare with split-adjusted prices. */
function toTodayUnits(period: StatementPeriod, splits: Split[] | undefined): StatementPeriod {
  const factor = unitsSince(splits, availableOn(period));
  if (factor === 1) return period;
  return {
    ...period,
    epsBasic: period.epsBasic != null ? period.epsBasic / factor : period.epsBasic,
    epsDiluted: period.epsDiluted != null ? period.epsDiluted / factor : period.epsDiluted,
    sharesDiluted: period.sharesDiluted != null ? period.sharesDiluted * factor : period.sharesDiluted,
  };
}

export type PanelRow = {
  symbol: string;
  as_of: string;
  overall: number;
  sub_scores: Record<string, number>;
  price: number;
  market_cap: number | null;
};

/**
 * Recomputes the SilverNote Score as it would have read at each date: only annual filings public by
 * then, a year of prices up to that day, beta against the benchmark to that day, and the market value
 * implied by that day's price. No look-ahead.
 */
export function pointInTimeScores(source: PointInTimeSource, dates: string[]): PanelRow[] {
  const rows: PanelRow[] = [];
  const annual = [...source.annual].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).map((period) => toTodayUnits(period, source.splits));
  let candleEnd = 0;
  let benchmarkEnd = 0;
  for (const date of dates) {
    const cutoff = Date.parse(`${date}T23:59:59Z`) / 1000;
    while (candleEnd < source.candles.length && source.candles[candleEnd].timestamp <= cutoff) candleEnd += 1;
    while (benchmarkEnd < source.benchmark.length && source.benchmark[benchmarkEnd].t <= cutoff) benchmarkEnd += 1;
    const last = source.candles[candleEnd - 1];
    // Needs a recent close (not suspended or pre-listing) and a few months of trading.
    if (!last || candleEnd < 60 || cutoff - last.timestamp > 10 * 86_400) continue;
    const filed = annual.filter((period) => availableOn(period) <= date);
    if (!filed.length) continue;

    const candles = source.candles.slice(Math.max(0, candleEnd - 280), candleEnd);
    const price = last.close;
    const shares = filed[0].sharesDiluted;
    const marketCap =
      source.currency === 'USD' && shares && shares > 0
        ? price * shares
        : source.currentMarketCap && source.currentPrice
          ? (source.currentMarketCap * price) / source.currentPrice
          : null;
    const benchmark = source.benchmark.slice(Math.max(0, benchmarkEnd - 280), benchmarkEnd);
    const beta = benchmark.length > 60 ? betaFromCloses(candles.map((candle) => ({ t: candle.timestamp, c: candle.close })), benchmark) : null;

    const score = calculateSilverNoteScore(
      buildScoreInput({
        symbol: source.symbol,
        companyName: source.name,
        calculatedAt: `${date}T21:00:00.000Z`,
        profile: { name: source.name, industry: source.industry, sector: source.sector, marketCap },
        quote: { currentPrice: price, marketCap, timestamp: last.timestamp, source: 'history' },
        annual: filed,
        quarterly: [],
        currency: source.currency,
        fxToUsd: source.fxToUsd,
        candles,
        metrics: beta !== null ? { beta } : {},
        hasPeerData: Boolean(source.sector),
      }),
    );
    rows.push({
      symbol: source.symbol,
      as_of: date,
      overall: score.overallScore,
      sub_scores: Object.fromEntries(score.subScores.map((sub) => [sub.key, sub.score])),
      price,
      market_cap: marketCap,
    });
  }
  return rows;
}

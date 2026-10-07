import 'server-only';

import { q, q1 } from '@/lib/db';
import { memo } from '@/lib/data/http';
import { usdPerUnit } from '@/lib/data/providers/fx';
import type { Candle } from '@/lib/data/types';
import { betaFromCloses } from '@/lib/finance/stats';
import { calculateSilverNoteScore } from '@/lib/score/engine';
import { buildScoreInput } from '@/lib/score/input';
import type { SilverNoteScore, ScoreCandle } from '@/lib/score/types';
import { evaluateScoreAlerts } from '@/lib/services/alerts';
import { getCompanyProfile, getLiveQuote } from '@/lib/services/market';
import { getCandles } from '@/lib/services/prices';
import { getCompanyStatements, getStoredAnnual } from '@/lib/services/statements';
import { getSecurity } from '@/lib/services/universe';

export type StoredScore = {
  symbol: string;
  overall: number;
  label: string;
  confidence: string;
  data_quality: number | null;
  sub_scores: Array<{ key: string; name: string; weight: number; score: number; confidence: string; reason: string }>;
  payload: { shortSummary: string; strengths: string[]; weaknesses: string[]; watchItems: string[] };
  input_level: string;
  version: string;
  calculated_at: Date;
};

const toScoreCandles = (candles: Candle[]): ScoreCandle[] =>
  candles.map((candle) => ({ timestamp: candle.t, open: candle.o, high: candle.h, low: candle.l, close: candle.c, volume: candle.v }));

const benchmarkCandles = () => memo('score:spy', 30 * 60_000, () => getCandles('SPY', 2));

async function persist(score: SilverNoteScore, level: 'detailed' | 'universe') {
  const previous = await q1<{ overall: number }>('select overall from public.scores where symbol = $1', [score.symbol]);
  const compactSubScores = score.subScores.map(({ key, name, weight, score: value, confidence, reason }) => ({ key, name, weight, score: value, confidence, reason }));
  await q(
    `insert into public.scores (symbol, overall, label, confidence, data_quality, sub_scores, payload, input_level, version, calculated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now())
     on conflict (symbol) do update set overall = excluded.overall, label = excluded.label, confidence = excluded.confidence,
       data_quality = excluded.data_quality, sub_scores = excluded.sub_scores, payload = excluded.payload,
       input_level = excluded.input_level, version = excluded.version, calculated_at = now()`,
    [
      score.symbol,
      score.overallScore,
      score.label,
      score.confidence,
      score.dataQualityScore,
      JSON.stringify(compactSubScores),
      JSON.stringify({ shortSummary: score.shortSummary, strengths: score.strengths, weaknesses: score.weaknesses, watchItems: score.watchItems }),
      level,
      score.version,
    ],
  );
  const last = await q1<{ overall: number; age_hours: number }>(
    `select overall, extract(epoch from now() - calculated_at) / 3600 as age_hours
     from public.score_history where symbol = $1 order by calculated_at desc limit 1`,
    [score.symbol],
  );
  if (!last || last.overall !== score.overallScore || Number(last.age_hours) > 24 * 6) {
    await q('insert into public.score_history (symbol, overall, sub_scores) values ($1, $2, $3::jsonb)', [
      score.symbol,
      score.overallScore,
      JSON.stringify(compactSubScores.map(({ key, score: value }) => ({ key, score: value }))),
    ]);
  }
  if (previous && previous.overall !== score.overallScore) {
    await evaluateScoreAlerts(score.symbol, score.overallScore, previous.overall).catch(() => {});
  }
}

/**
 * Full-fidelity score for a company page: companyfacts statements (quarterly, every line item),
 * two years of prices, beta against the S&P 500, a live quote and forward P/E when available.
 */
export async function getDetailedScore(symbol: string): Promise<SilverNoteScore | null> {
  const upper = symbol.toUpperCase();
  return memo(`score:detailed:${upper}`, 10 * 60_000, async () => {
    const [security, statements, candles, spy, profile, quote] = await Promise.all([
      getSecurity(upper),
      getCompanyStatements(upper),
      getCandles(upper, 2).catch(() => [] as Candle[]),
      benchmarkCandles().catch(() => [] as Candle[]),
      getCompanyProfile(upper).catch(() => null),
      getLiveQuote(upper).catch(() => null),
    ]);
    if (!security) return null;
    const fxRate = statements ? await usdPerUnit(statements.currency) : 1;
    // Without an exchange rate, foreign-currency statements can't be compared with a USD market value.
    const fx = fxRate ?? 1;
    const comparable = fxRate !== null;
    const metrics: Record<string, number | null> = {};
    const beta = candles.length && spy.length ? betaFromCloses(candles, spy) : null;
    if (beta !== null) metrics.beta = beta;
    if (profile?.forwardPE) metrics.forwardPE = profile.forwardPE;
    const price = quote?.price ?? security.price;
    const input = buildScoreInput({
      symbol: upper,
      companyName: security.name,
      profile: { name: security.name, industry: security.industry, sector: security.sector, marketCap: comparable ? security.market_cap : null, sharesOutstanding: statements?.sharesOutstanding?.value ?? null },
      quote: price !== null ? { currentPrice: price, change: quote?.change ?? security.change, changePercent: quote?.changePct ?? security.change_pct, marketCap: comparable ? security.market_cap : null, timestamp: quote?.timestamp ?? new Date(security.price_at ?? security.updated_at).getTime(), source: quote?.source ?? 'Nasdaq' } : null,
      annual: statements?.annual ?? [],
      quarterly: statements?.quarterly ?? [],
      currency: statements?.currency ?? 'USD',
      fxToUsd: fx,
      candles: toScoreCandles(candles),
      metrics,
      hasPeerData: Boolean(security.sector),
    });
    const score = calculateSilverNoteScore(input);
    await persist(score, 'detailed');
    return score;
  });
}

/**
 * Lighter score used by the universe sweep: annual frames statements and 13 months of prices.
 * Mirrors getDetailedScore's resilience — missing fundamentals or an unconvertible currency
 * shrink confidence rather than skipping the company, so every priced security gets a score.
 */
export async function computeUniverseScore(symbol: string, spy: Candle[]): Promise<SilverNoteScore | null> {
  const security = await getSecurity(symbol);
  if (!security || security.price === null) return null;
  const stored = await getStoredAnnual(symbol);
  const periods = stored?.periods ?? [];
  const currency = stored?.currency ?? 'USD';
  const candles = await getCandles(symbol, 1.1).catch(() => [] as Candle[]);
  const fxRate = currency !== 'USD' ? await usdPerUnit(currency) : 1;
  // Without a rate, foreign-currency fundamentals can't be compared with a USD market value.
  const fx = fxRate ?? 1;
  const comparable = fxRate !== null;
  const metrics: Record<string, number | null> = {};
  const beta = candles.length && spy.length ? betaFromCloses(candles, spy) : null;
  if (beta !== null) metrics.beta = beta;
  const input = buildScoreInput({
    symbol,
    companyName: security.name,
    profile: { name: security.name, industry: security.industry, sector: security.sector, marketCap: comparable ? security.market_cap : null },
    quote: { currentPrice: security.price, change: security.change, changePercent: security.change_pct, marketCap: comparable ? security.market_cap : null, timestamp: new Date(security.price_at ?? security.updated_at).getTime(), source: 'Nasdaq' },
    annual: periods,
    quarterly: [],
    currency,
    fxToUsd: fx,
    candles: toScoreCandles(candles),
    metrics,
    hasPeerData: Boolean(security.sector),
  });
  const score = calculateSilverNoteScore(input);
  await persist(score, 'universe');
  return score;
}

export async function getStoredScores(symbols: string[]) {
  if (!symbols.length) return [];
  return q<StoredScore>('select * from public.scores where symbol = any($1::text[])', [symbols.map((symbol) => symbol.toUpperCase())]);
}

export async function getScoreHistory(symbol: string) {
  return q<{ overall: number; sub_scores: Array<{ key: string; score: number }>; calculated_at: Date }>(
    'select overall, sub_scores, calculated_at from public.score_history where symbol = $1 order by calculated_at asc limit 200',
    [symbol.toUpperCase()],
  );
}

export async function scoreCoverage() {
  return q1<{ scored: number; fresh: number }>(
    `select count(*)::int as scored, count(*) filter (where calculated_at > now() - interval '7 days')::int as fresh from public.scores`,
  );
}

export { benchmarkCandles };

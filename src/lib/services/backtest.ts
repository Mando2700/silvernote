import 'server-only';

import { q, q1 } from '@/lib/db';
import { forget, memo } from '@/lib/data/http';
import { usdPerUnit } from '@/lib/data/providers/fx';
import type { Candle } from '@/lib/data/types';
import { type Panel, type PanelPoint, runBacktest, type ScoreField, type Strategy } from '@/lib/finance/backtest';
import { monthEnds, pointInTimeScores, type PanelRow } from '@/lib/score/point-in-time';
import { getCandles, lastSessionDate } from '@/lib/services/prices';
import { getSplits } from '@/lib/services/splits';
import { getCompanyStatements } from '@/lib/services/statements';

export const PANEL_DEFAULTS = { size: 500, years: 10 };

type Reporter = (done: number, total: number, message: string) => void;

const toScoreCandles = (candles: Candle[]) => candles.map((candle) => ({ timestamp: candle.t, open: candle.o, high: candle.h, low: candle.l, close: candle.c, volume: candle.v }));

async function savePanelRows(symbol: string, rows: PanelRow[]) {
  await q('delete from public.score_panel where symbol = $1', [symbol]);
  for (let index = 0; index < rows.length; index += 400) {
    await q(
      `insert into public.score_panel (symbol, as_of, overall, sub_scores, price, market_cap)
       select symbol, as_of, overall, sub_scores, price, market_cap
       from json_to_recordset($1::json) as t(symbol text, as_of date, overall integer, sub_scores jsonb, price double precision, market_cap double precision)
       on conflict (symbol, as_of) do nothing`,
      [rows.slice(index, index + 400)],
    );
  }
}

/**
 * Builds the backtest history: for the largest listed companies, month-end SilverNote Scores
 * recomputed from the filings and prices available at each month end. Downloads SEC statements and
 * ten years of prices per company, so the first run takes a while; later runs reuse the caches.
 */
export async function buildScorePanel(report: Reporter, job: { cancelled: boolean }, params: { size?: number; years?: number }) {
  const size = Math.min(1500, Math.max(20, params.size ?? PANEL_DEFAULTS.size));
  const years = Math.min(10, Math.max(1, params.years ?? PANEL_DEFAULTS.years));
  const targets = await q<{ symbol: string; name: string; sector: string | null; industry: string | null; market_cap: number | null; price: number | null }>(
    `select symbol, name, sector, industry, market_cap, price from public.securities
     where listed and is_common and cik is not null and price is not null
     order by market_cap desc nulls last limit $1`,
    [size],
  );
  const dates = monthEnds(years, lastSessionDate());
  report(0, targets.length, 'Loading benchmark history…');
  const spy = (await getCandles('SPY', years + 1.2)).map((candle) => ({ t: candle.t, c: candle.c }));
  const queue = [...targets];
  let done = 0;
  let stored = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (;;) {
        if (job.cancelled) return;
        const security = queue.shift();
        if (!security) return;
        try {
          const [statements, candles, splits] = await Promise.all([getCompanyStatements(security.symbol), getCandles(security.symbol, years + 1.2), getSplits(security.symbol)]);
          const fx = statements ? await usdPerUnit(statements.currency) : null;
          if (statements?.annual.length && candles.length && fx !== null) {
            const rows = pointInTimeScores(
              {
                symbol: security.symbol,
                name: security.name,
                sector: security.sector,
                industry: security.industry,
                currency: statements.currency,
                fxToUsd: fx,
                annual: statements.annual,
                candles: toScoreCandles(candles),
                benchmark: spy,
                currentMarketCap: security.market_cap,
                currentPrice: security.price,
                splits: splits ?? undefined,
              },
              dates,
            );
            if (rows.length) {
              await savePanelRows(security.symbol, rows);
              stored += 1;
            }
          }
        } catch {
          // skip this company, keep building
        }
        done += 1;
        report(done, targets.length, `Rebuilt history for ${stored.toLocaleString()} of ${targets.length.toLocaleString()} · ${security.symbol}`);
      }
    }),
  );
  forget('backtest:');
  report(targets.length, targets.length, `History for ${stored.toLocaleString()} companies`);
}

export async function panelStatus() {
  return q1<{ symbols: number; rows: number; first: string | null; last: string | null }>(
    'select count(distinct symbol)::int as symbols, count(*)::int as rows, min(as_of)::text as first, max(as_of)::text as last from public.score_panel',
  );
}

type Row = { symbol: string; as_of: string; overall: number; sub_scores: Partial<Record<ScoreField, number>>; price: number; market_cap: number | null; sector: string | null };

export async function loadPanel(): Promise<Panel> {
  return memo('backtest:panel', 15 * 60_000, async () => {
    const rows = await q<Row>(
      `select p.symbol, p.as_of::text as as_of, p.overall, p.sub_scores, p.price, p.market_cap, s.sector
       from public.score_panel p left join public.securities s on s.symbol = p.symbol`,
    );
    const dates = [...new Set(rows.map((row) => row.as_of))].sort();
    const index = new Map(dates.map((date, i) => [date, i]));
    const series = new Map<string, Array<PanelPoint | null>>();
    const sectors = new Map<string, string | null>();
    for (const row of rows) {
      let list = series.get(row.symbol);
      if (!list) {
        list = new Array(dates.length).fill(null);
        series.set(row.symbol, list);
        sectors.set(row.symbol, row.sector);
      }
      list[index.get(row.as_of) as number] = { overall: row.overall, sub: row.sub_scores, price: row.price, marketCap: row.market_cap };
    }
    const years = dates.length ? (Date.now() - Date.parse(`${dates[0]}T00:00:00Z`)) / (365.25 * 86_400_000) + 0.1 : 1;
    const spy = dates.length ? await getCandles('SPY', Math.min(11, years)).catch(() => [] as Candle[]) : [];
    let cursor = 0;
    const benchmark = dates.map((date) => {
      const cutoff = Date.parse(`${date}T23:59:59Z`) / 1000;
      while (cursor < spy.length && spy[cursor].t <= cutoff) cursor += 1;
      return spy[cursor - 1]?.c ?? null;
    });
    return { dates, series, sectors, benchmark };
  });
}

export async function runStrategy(strategy: Strategy, riskFree: number) {
  const panel = await loadPanel();
  if (!panel.dates.length) return null;
  return runBacktest(panel, strategy, riskFree);
}

export async function listSectors() {
  const panel = await loadPanel();
  return [...new Set([...panel.sectors.values()].filter((sector): sector is string => Boolean(sector)))].sort();
}

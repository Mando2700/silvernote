import 'server-only';

import { q, q1 } from '@/lib/db';
import { memo } from '@/lib/data/http';
import { fetchStatements as fmpStatements, fmpEnabled } from '@/lib/data/providers/fmp';
import { usdPerUnit } from '@/lib/data/providers/fx';
import { fetchCompanyFacts } from '@/lib/data/providers/sec';
import { buildTtm, standardizeCompanyFacts } from '@/lib/finance/sec-standardize';
import type { StandardizedStatements, StatementPeriod } from '@/lib/finance/statement-types';
import { saveFundamentalsFromStatements } from '@/lib/services/fundamentals';
import { getSecurity } from '@/lib/services/universe';

type SetRow = {
  frequency: 'annual' | 'quarterly';
  source: string;
  currency: string | null;
  periods: StatementPeriod[];
  meta: Partial<StandardizedStatements>;
  fetched_at: Date;
};

const DETAILED_TTL_MS = 3 * 86_400_000;
/** Bump when standardization adds line items, so stored statements are rebuilt. */
export const SCHEMA_VERSION = 3;

function assemble(symbol: string, rows: SetRow[]): StandardizedStatements | null {
  const annual = rows.find((row) => row.frequency === 'annual');
  const quarterly = rows.find((row) => row.frequency === 'quarterly');
  if (!annual && !quarterly) return null;
  const meta = (annual?.meta ?? quarterly?.meta ?? {}) as Partial<StandardizedStatements>;
  const currency = annual?.currency ?? quarterly?.currency ?? 'USD';
  return {
    symbol,
    entityName: meta.entityName ?? symbol,
    cik: meta.cik ?? null,
    source: (annual?.source ?? quarterly?.source ?? 'sec') as StandardizedStatements['source'],
    currency,
    taxonomy: meta.taxonomy ?? 'us-gaap',
    fiscalYearEndMonth: meta.fiscalYearEndMonth ?? null,
    annual: annual?.periods ?? [],
    quarterly: quarterly?.periods ?? [],
    ttm: (quarterly?.meta as Partial<StandardizedStatements> | undefined)?.ttm ?? buildTtm(quarterly?.periods ?? [], currency),
    sharesOutstanding: meta.sharesOutstanding ?? null,
    fetchedAt: (annual?.fetched_at ?? quarterly?.fetched_at ?? new Date()).toISOString(),
  };
}

async function readStored(symbol: string) {
  return q<SetRow>(
    'select frequency, source, currency, periods, meta, fetched_at from public.statement_sets where symbol = $1',
    [symbol],
  );
}

async function store(statements: StandardizedStatements) {
  const meta = {
    entityName: statements.entityName,
    cik: statements.cik,
    taxonomy: statements.taxonomy,
    fiscalYearEndMonth: statements.fiscalYearEndMonth,
    sharesOutstanding: statements.sharesOutstanding,
    schema: SCHEMA_VERSION,
  };
  for (const frequency of ['annual', 'quarterly'] as const) {
    const periods = statements[frequency];
    if (!periods.length && frequency === 'quarterly') continue;
    await q(
      `insert into public.statement_sets (symbol, frequency, source, currency, periods, meta, fetched_at)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, now())
       on conflict (symbol, frequency) do update set source = excluded.source, currency = excluded.currency,
         periods = excluded.periods, meta = excluded.meta, fetched_at = now()`,
      [statements.symbol, frequency, statements.source, statements.currency, JSON.stringify(periods), JSON.stringify(frequency === 'quarterly' ? { ...meta, ttm: statements.ttm } : meta)],
    );
  }
}

/**
 * Detailed statements for one company: SEC companyfacts first (full history, quarterly, free),
 * FMP as a fallback for companies without usable XBRL, and the universe frames as a last resort.
 */
export async function getCompanyStatements(symbol: string, options: { force?: boolean } = {}): Promise<StandardizedStatements | null> {
  const upper = symbol.toUpperCase();
  return memo(`statements:${upper}:${options.force ? Date.now() : ''}`, 5 * 60_000, async () => {
    const stored = await readStored(upper);
    const detailed = stored.filter((row) => row.source === 'sec' || row.source === 'fmp');
    const fresh = detailed.length && detailed.every(
      (row) => Date.now() - new Date(row.fetched_at).getTime() < DETAILED_TTL_MS && (row.meta as { schema?: number }).schema === SCHEMA_VERSION,
    );
    if (fresh && !options.force) return assemble(upper, detailed);

    const security = await getSecurity(upper);
    let result: StandardizedStatements | null = null;
    if (security?.cik) {
      try {
        const facts = await fetchCompanyFacts(security.cik);
        const standardized = standardizeCompanyFacts(facts, { symbol: upper });
        if (standardized.annual.some((period) => period.revenue != null || period.netIncome != null)) result = standardized;
      } catch {
        // try the next source
      }
    }
    if (!result && fmpEnabled()) {
      try {
        const fmp = await fmpStatements(upper);
        if (fmp.annual.length) {
          result = {
            symbol: upper,
            entityName: security?.name ?? upper,
            cik: security?.cik ?? null,
            source: 'fmp',
            currency: fmp.currency,
            taxonomy: 'fmp',
            fiscalYearEndMonth: fmp.annual[0] ? new Date(`${fmp.annual[0].periodEnd}T00:00:00Z`).getUTCMonth() + 1 : null,
            annual: fmp.annual,
            quarterly: fmp.quarterly,
            ttm: buildTtm(fmp.quarterly, fmp.currency),
            sharesOutstanding: null,
            fetchedAt: new Date().toISOString(),
          };
        }
      } catch {
        // fall back to what we have
      }
    }
    if (result) {
      await store(result);
      const fx = await usdPerUnit(result.currency);
      if (fx !== null) await saveFundamentalsFromStatements(upper, result.annual, result.source, fx).catch(() => {});
      return result;
    }
    return assemble(upper, detailed.length ? detailed : stored);
  });
}

export async function getStoredAnnual(symbol: string) {
  const row = await q1<{ periods: StatementPeriod[]; source: string; currency: string | null }>(
    "select periods, source, currency from public.statement_sets where symbol = $1 and frequency = 'annual'",
    [symbol.toUpperCase()],
  );
  return row;
}

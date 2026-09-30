import 'server-only';

import { q } from '@/lib/db';
import { fetchFrame } from '@/lib/data/providers/sec';
import { finalizePeriod } from '@/lib/finance/sec-standardize';
import type { StatementPeriod } from '@/lib/finance/statement-types';

/**
 * Universe-wide fundamentals from SEC "frames": each call returns one XBRL concept for every
 * filer in one period. ~300 calls rebuild five years of annual statements for ~6,000 companies,
 * without touching per-company endpoints. The company page later replaces these with the full
 * companyfacts statements (quarterly, every line item).
 */

/** Bump when the concepts below change so the scheduler rebuilds every company's row. */
export const FUNDAMENTALS_VERSION = 3;

type Concept = { key: string; tags: string[]; unit: string; kind: 'duration' | 'instant'; sign?: 1 | -1 };

const DURATIONS: Concept[] = [
  { key: 'revenue', unit: 'USD', kind: 'duration', tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense'] },
  { key: 'costOfRevenue', unit: 'USD', kind: 'duration', tags: ['CostOfRevenue', 'CostOfGoodsAndServicesSold'] },
  { key: 'grossProfit', unit: 'USD', kind: 'duration', tags: ['GrossProfit'] },
  { key: 'operatingIncome', unit: 'USD', kind: 'duration', tags: ['OperatingIncomeLoss'] },
  { key: 'pretaxIncome', unit: 'USD', kind: 'duration', tags: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'] },
  { key: 'taxExpense', unit: 'USD', kind: 'duration', tags: ['IncomeTaxExpenseBenefit'] },
  { key: 'interestExpense', unit: 'USD', kind: 'duration', tags: ['InterestExpense'] },
  { key: 'netIncome', unit: 'USD', kind: 'duration', tags: ['NetIncomeLoss', 'ProfitLoss'] },
  { key: 'epsDiluted', unit: 'USD-per-shares', kind: 'duration', tags: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'] },
  { key: 'sharesDiluted', unit: 'shares', kind: 'duration', tags: ['WeightedAverageNumberOfDilutedSharesOutstanding'] },
  { key: 'depreciationAmortization', unit: 'USD', kind: 'duration', tags: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'] },
  { key: 'operatingCashFlow', unit: 'USD', kind: 'duration', tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'] },
  { key: 'capex', unit: 'USD', kind: 'duration', sign: -1, tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements', 'PaymentsToAcquireOtherPropertyPlantAndEquipment', 'PaymentsToAcquireOtherProductiveAssets'] },
  { key: 'dividendsPaid', unit: 'USD', kind: 'duration', sign: -1, tags: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'] },
  { key: 'buybacks', unit: 'USD', kind: 'duration', sign: -1, tags: ['PaymentsForRepurchaseOfCommonStock'] },
  { key: 'netInterestIncome', unit: 'USD', kind: 'duration', tags: ['InterestIncomeExpenseNet'] },
  { key: 'nonInterestIncome', unit: 'USD', kind: 'duration', tags: ['NoninterestIncome'] },
];

const INSTANTS: Concept[] = [
  { key: 'totalAssets', unit: 'USD', kind: 'instant', tags: ['Assets'] },
  { key: 'currentAssets', unit: 'USD', kind: 'instant', tags: ['AssetsCurrent'] },
  { key: 'currentLiabilities', unit: 'USD', kind: 'instant', tags: ['LiabilitiesCurrent'] },
  { key: 'totalLiabilities', unit: 'USD', kind: 'instant', tags: ['Liabilities'] },
  { key: 'totalEquity', unit: 'USD', kind: 'instant', tags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  { key: 'cash', unit: 'USD', kind: 'instant', tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'] },
  { key: 'inventory', unit: 'USD', kind: 'instant', tags: ['InventoryNet'] },
  { key: 'retainedEarnings', unit: 'USD', kind: 'instant', tags: ['RetainedEarningsAccumulatedDeficit'] },
  { key: 'longTermDebt', unit: 'USD', kind: 'instant', tags: ['LongTermDebtNoncurrent'] },
  { key: '_longTermDebtTotal', unit: 'USD', kind: 'instant', tags: ['LongTermDebt'] },
  { key: '_debtCurrent', unit: 'USD', kind: 'instant', tags: ['DebtCurrent', 'LongTermDebtCurrent'] },
  { key: '_shortBorrowings', unit: 'USD', kind: 'instant', tags: ['ShortTermBorrowings'] },
];

const DURATION_INDEX = new Map(DURATIONS.map((concept, index) => [concept.key, index]));
const INSTANT_INDEX = new Map(INSTANTS.map((concept, index) => [concept.key, index]));

type Slot = { values: Float64Array; ranks: Int8Array; start?: string };

function newSlot(size: number): Slot {
  const values = new Float64Array(size).fill(Number.NaN);
  const ranks = new Int8Array(size).fill(127);
  return { values, ranks };
}

export function framePeriods(today = new Date()) {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const annual = Array.from({ length: 6 }, (_, index) => `CY${year - 5 + index}`);
  const instants = Array.from({ length: 5 }, (_, index) => `CY${year - 5 + index}Q4I`);
  // Quarter-end balance sheets of the current year that have had ~45 days to be filed.
  const completedQuarters = Math.floor((month - 1.5) / 3);
  for (let quarter = 1; quarter <= Math.min(3, completedQuarters); quarter += 1) instants.push(`CY${year}Q${quarter}I`);
  return { annual, instants };
}

type CompanyFacts = { durations: Map<string, Slot>; instants: Map<string, Slot> };

export async function ingestFundamentals(onProgress?: (done: number, total: number, message: string) => void) {
  const { annual, instants } = framePeriods();
  const tasks: Array<{ concept: Concept; rank: number; tag: string; period: string }> = [];
  for (const concept of DURATIONS) concept.tags.forEach((tag, rank) => annual.forEach((period) => tasks.push({ concept, rank, tag, period })));
  for (const concept of INSTANTS) concept.tags.forEach((tag, rank) => instants.forEach((period) => tasks.push({ concept, rank, tag, period })));

  const companies = new Map<number, CompanyFacts>();
  let done = 0;
  let failures = 0;
  const worker = async () => {
    for (;;) {
      const task = tasks.shift();
      if (!task) return;
      try {
        const rows = await fetchFrame('us-gaap', task.tag, task.concept.unit, task.period);
        const isDuration = task.concept.kind === 'duration';
        const index = (isDuration ? DURATION_INDEX : INSTANT_INDEX).get(task.concept.key) as number;
        for (const row of rows) {
          if (typeof row.val !== 'number' || !Number.isFinite(row.val)) continue;
          let company = companies.get(row.cik);
          if (!company) {
            company = { durations: new Map(), instants: new Map() };
            companies.set(row.cik, company);
          }
          const bucket = isDuration ? company.durations : company.instants;
          let slot = bucket.get(row.end);
          if (!slot) {
            slot = newSlot(isDuration ? DURATIONS.length : INSTANTS.length);
            bucket.set(row.end, slot);
          }
          if (task.rank < slot.ranks[index]) {
            slot.values[index] = row.val * (task.concept.sign ?? 1);
            slot.ranks[index] = task.rank;
            if (isDuration && row.start) slot.start = row.start;
          }
        }
      } catch {
        failures += 1;
      }
      done += 1;
      if (done % 10 === 0 || done === total) onProgress?.(done, total, `SEC frames ${done}/${total}`);
    }
  };
  const total = tasks.length;
  await Promise.all(Array.from({ length: 4 }, worker));
  if (failures > total * 0.25) throw new Error(`Too many SEC frame requests failed (${failures}/${total}).`);

  onProgress?.(total, total, 'Building company fundamentals…');
  const securities = await q<{ symbol: string; cik: string }>(
    'select symbol, cik from public.securities where listed and cik is not null',
  );
  const symbolsByCik = new Map<number, string[]>();
  for (const row of securities) {
    const cik = Number(row.cik);
    symbolsByCik.set(cik, [...(symbolsByCik.get(cik) ?? []), row.symbol]);
  }
  const richer = new Set(
    (await q<{ symbol: string }>("select symbol from public.statement_sets where frequency = 'annual' and source <> 'sec-frames'")).map((row) => row.symbol),
  );

  const fundamentalsRows: Record<string, unknown>[] = [];
  const statementRows: Array<{ symbol: string; periods: StatementPeriod[] }> = [];
  for (const [cik, facts] of companies) {
    const symbols = symbolsByCik.get(cik);
    if (!symbols) continue;
    const periods = buildAnnualPeriods(facts);
    if (!periods.length) continue;
    const row = toFundamentalsRow(periods);
    for (const symbol of symbols) {
      fundamentalsRows.push({ symbol, ...row });
      if (!richer.has(symbol)) statementRows.push({ symbol, periods });
    }
  }

  for (let index = 0; index < fundamentalsRows.length; index += 1000) {
    await upsertFundamentals(fundamentalsRows.slice(index, index + 1000), { onlyNewer: true });
  }
  for (let index = 0; index < statementRows.length; index += 300) {
    const chunk = statementRows.slice(index, index + 300).map((row) => ({ symbol: row.symbol, periods: row.periods }));
    await q(
      `insert into public.statement_sets (symbol, frequency, source, currency, periods, meta, fetched_at)
       select symbol, 'annual', 'sec-frames', 'USD', periods, '{}'::jsonb, now()
       from json_to_recordset($1::json) as t(symbol text, periods jsonb)
       on conflict (symbol, frequency) do update set periods = excluded.periods, fetched_at = now(), source = 'sec-frames'
       where statement_sets.source = 'sec-frames'`,
      [chunk],
    );
  }
  return { companies: fundamentalsRows.length, requests: total, failures };
}

function buildAnnualPeriods(facts: CompanyFacts): StatementPeriod[] {
  const ends = [...facts.durations.entries()]
    .filter(([, slot]) => {
      const revenue = slot.values[DURATION_INDEX.get('revenue') as number];
      const net = slot.values[DURATION_INDEX.get('netIncome') as number];
      const ocf = slot.values[DURATION_INDEX.get('operatingCashFlow') as number];
      return Number.isFinite(revenue) || Number.isFinite(net) || Number.isFinite(ocf);
    })
    .map(([end]) => end)
    .sort((a, b) => b.localeCompare(a))
    .filter((end, index, all) => index === 0 || Math.abs(Date.parse(all[index - 1]) - Date.parse(end)) > 20 * 86_400_000)
    .slice(0, 5);
  if (!ends.length) return [];

  const instantEnds = [...facts.instants.keys()].sort((a, b) => b.localeCompare(a));
  return ends.map((end, position) => {
    const duration = facts.durations.get(end) as Slot;
    // The newest annual period uses the newest balance sheet; older ones use the nearest year-end.
    const instantEnd =
      position === 0 && instantEnds[0] && instantEnds[0] >= end
        ? instantEnds[0]
        : instantEnds.reduce<string | null>((best, candidate) => {
            const distance = Math.abs(Date.parse(candidate) - Date.parse(end));
            if (distance > 200 * 86_400_000) return best;
            if (!best) return candidate;
            return distance < Math.abs(Date.parse(best) - Date.parse(end)) ? candidate : best;
          }, null);
    const instant = instantEnd ? facts.instants.get(instantEnd) : undefined;
    const date = new Date(`${end}T00:00:00Z`);
    const fiscalYear = date.getUTCMonth() === 0 && date.getUTCDate() <= 10 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
    const period: StatementPeriod = {
      key: `FY${fiscalYear}`,
      period: 'FY',
      fiscalYear,
      fiscalQuarter: null,
      periodStart: duration.start ?? null,
      periodEnd: end,
      label: `FY${String(fiscalYear).slice(-2)}`,
      currency: 'USD',
      filed: null,
      form: '10-K',
      fiscalDate: end,
      year: fiscalYear,
    };
    const record = period as Record<string, unknown>;
    const helpers = new Map<string, number | null>();
    DURATIONS.forEach((concept, index) => {
      const value = duration.values[index];
      record[concept.key] = Number.isFinite(value) ? value : null;
    });
    INSTANTS.forEach((concept, index) => {
      const value = instant?.values[index];
      const finite = value !== undefined && Number.isFinite(value) ? value : null;
      if (concept.key.startsWith('_')) helpers.set(concept.key, finite);
      else record[concept.key] = finite;
    });
    return finalizePeriod(period, helpers);
  });
}

function toFundamentalsRow(periods: StatementPeriod[]) {
  const [latest, previous] = periods;
  const threeYearsAgo = periods[3];
  return {
    fiscal_year: latest.fiscalYear,
    period_end: latest.periodEnd,
    currency: 'USD',
    revenue: latest.revenue ?? null,
    revenue_prev: previous?.revenue ?? null,
    revenue_3y_ago: threeYearsAgo?.revenue ?? null,
    gross_profit: latest.grossProfit ?? null,
    operating_income: latest.operatingIncome ?? null,
    ebitda: latest.ebitda ?? null,
    net_income: latest.netIncome ?? null,
    net_income_prev: previous?.netIncome ?? null,
    eps: latest.epsDiluted ?? null,
    eps_prev: previous?.epsDiluted ?? null,
    ocf: latest.operatingCashFlow ?? null,
    capex: latest.capex ?? null,
    fcf: latest.freeCashFlow ?? null,
    fcf_prev: previous?.freeCashFlow ?? null,
    dividends_paid: latest.dividendsPaid ?? null,
    total_assets: latest.totalAssets ?? null,
    total_liabilities: latest.totalLiabilities ?? null,
    total_equity: latest.totalEquity ?? null,
    cash: latest.cash ?? null,
    total_debt: latest.totalDebt ?? null,
    current_assets: latest.currentAssets ?? null,
    current_liabilities: latest.currentLiabilities ?? null,
    shares: latest.sharesDiluted ?? null,
    source: 'sec-frames',
  };
}

const FUNDAMENTAL_COLUMNS = [
  ['fiscal_year', 'integer'], ['period_end', 'date'], ['currency', 'text'], ['revenue', 'double precision'],
  ['revenue_prev', 'double precision'], ['revenue_3y_ago', 'double precision'], ['gross_profit', 'double precision'],
  ['operating_income', 'double precision'], ['ebitda', 'double precision'], ['net_income', 'double precision'],
  ['net_income_prev', 'double precision'], ['eps', 'double precision'], ['eps_prev', 'double precision'],
  ['ocf', 'double precision'], ['capex', 'double precision'], ['fcf', 'double precision'], ['fcf_prev', 'double precision'],
  ['dividends_paid', 'double precision'], ['total_assets', 'double precision'], ['total_liabilities', 'double precision'],
  ['total_equity', 'double precision'], ['cash', 'double precision'], ['total_debt', 'double precision'],
  ['current_assets', 'double precision'], ['current_liabilities', 'double precision'], ['shares', 'double precision'],
  ['source', 'text'],
] as const;

/**
 * `onlyNewer` keeps a row that already covers a later fiscal year: US-GAAP frames stop at the last
 * US-GAAP filing, so they must not overwrite IFRS data from a company that switched (e.g. Toyota).
 */
export async function upsertFundamentals(rows: Record<string, unknown>[], options: { onlyNewer?: boolean } = {}) {
  if (!rows.length) return;
  const columns = FUNDAMENTAL_COLUMNS.map(([name]) => name);
  const definitions = FUNDAMENTAL_COLUMNS.map(([name, type]) => `${name} ${type}`).join(', ');
  await q(
    `insert into public.fundamentals (symbol, ${columns.join(', ')}, updated_at)
     select symbol, ${columns.join(', ')}, now() from json_to_recordset($1::json) as t(symbol text, ${definitions})
     on conflict (symbol) do update set ${columns.map((column) => `${column} = excluded.${column}`).join(', ')}, updated_at = now()
     ${options.onlyNewer
       ? // Same fiscal year: keep a row built from full company filings, which is richer than frames.
         `where fundamentals.period_end is null or excluded.period_end > fundamentals.period_end
            or (excluded.period_end = fundamentals.period_end and fundamentals.source = 'sec-frames')`
       : ''}`,
    [rows],
  );
}

/** Refresh one company's fundamentals row from its detailed (companyfacts or FMP) annual statements. */
export async function saveFundamentalsFromStatements(symbol: string, annual: StatementPeriod[], source: string, fxToUsd = 1) {
  if (!annual.length) return;
  const scaled = fxToUsd === 1
    ? annual
    : annual.map((period) => {
        const copy: Record<string, unknown> = { ...period };
        for (const [key, value] of Object.entries(period)) {
          if (typeof value === 'number' && !['sharesDiluted', 'fiscalYear', 'fiscalQuarter', 'year'].includes(key) && !key.endsWith('Margin')) {
            copy[key] = value * fxToUsd;
          }
        }
        return copy as StatementPeriod;
      });
  await upsertFundamentals([{ symbol, ...toFundamentalsRow(scaled), source }]);
}

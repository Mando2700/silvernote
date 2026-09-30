import { route, searchParam, symbolSchema } from '@/lib/api';
import { cite, SOURCES, type CitationStyle } from '@/lib/citation';
import { statementLayout, STATEMENT_TITLES } from '@/lib/finance/statement-layout';
import type { StatementKind } from '@/lib/finance/statement-types';
import { getCompanyStatements } from '@/lib/services/statements';
import { buildWorkbook, xlsxResponse, type XlsxFormat } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';

/** Income statement, balance sheet and cash flow as a spreadsheet (oldest period on the left, like a model). */
export const GET = route(async ({ request }) => {
  const symbol = symbolSchema.parse(searchParam(request, 'symbol'));
  const frequency = searchParam(request, 'frequency') === 'quarterly' ? 'quarterly' : 'annual';
  const style = (['APA', 'Harvard', 'MLA'].includes(searchParam(request, 'style') ?? '') ? searchParam(request, 'style') : 'APA') as CitationStyle;
  const statements = await getCompanyStatements(symbol);
  if (!statements) throw new Error(`No statements for ${symbol}.`);
  const periods = [...(frequency === 'annual' ? statements.annual : statements.quarterly)].reverse();
  const isBank = periods.some((period) => typeof (period as Record<string, unknown>).netInterestIncome === 'number' && !(period as Record<string, unknown>).costOfRevenue);
  const sheets = (['income', 'balance', 'cashflow'] as StatementKind[]).map((kind) => {
    const layout = statementLayout(kind, isBank);
    return {
      name: STATEMENT_TITLES[kind],
      title: `${statements.entityName} (${symbol}) · ${STATEMENT_TITLES[kind]} · ${frequency} · ${statements.currency}${kind === 'balance' ? '' : ', period totals'}`,
      // Plain numbers (no display format) so formulas and models work on them directly.
      columns: [
        { header: 'Line item', key: 'label', width: 34 },
        ...periods.map((period) => ({ header: `${period.label}${period.periodEnd ? ` (${period.periodEnd})` : ''}`, key: period.key, width: 18, format: 'number' as XlsxFormat })),
      ],
      rows: layout
        .map((line) => {
          const row: Record<string, string | number | null> = { label: `${'  '.repeat(line.indent ?? 0)}${line.label}` };
          let any = false;
          for (const period of periods) {
            const value = (period as Record<string, unknown>)[line.key];
            row[period.key] = typeof value === 'number' ? value : null;
            if (typeof value === 'number') any = true;
          }
          return any ? row : null;
        })
        .filter((row): row is Record<string, string | number | null> => row !== null),
      notes: [`Source: ${statements.source === 'fmp' ? 'Financial Modeling Prep' : 'SEC EDGAR XBRL'} (${statements.taxonomy}), fetched ${statements.fetchedAt.slice(0, 10)}. Amounts in ${statements.currency}.`],
    };
  });
  const buffer = await buildWorkbook(sheets, [cite(SOURCES.secFacts(statements.entityName, statements.cik), style)]);
  return xlsxResponse(buffer, `${symbol}-financials-${frequency}.xlsx`);
});

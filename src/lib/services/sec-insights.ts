import 'server-only';

import { cached } from '@/lib/data/http';
import { fetchFilingText, fetchSecDocument } from '@/lib/data/providers/sec';
import { parseForm4, type InsiderTransaction } from '@/lib/finance/form4';
import { diffRiskFactors, extractRiskFactors, type RiskDiff } from '@/lib/finance/risk-factors';
import { getFilings } from '@/lib/services/market';

/** The raw XML behind a Form 4: the primary document is an XSL rendering path ("xslF345X05/form4.xml"). */
function rawXmlUrl(url: string) {
  return url.replace(/\/xsl[^/]+\//, '/');
}

/** Insider transactions from the company's latest Form 4 filings (each filing is fetched once and kept). */
export async function getInsiderTrades(symbol: string, maxFilings = 30): Promise<InsiderTransaction[]> {
  const filings = (await getFilings(symbol)).filter((filing) => filing.form === '4' || filing.form === '4/A').slice(0, maxFilings);
  const rows = await Promise.all(
    filings.map((filing) =>
      cached(`form4:${filing.accession}`, 365 * 86_400, async () => parseForm4(await fetchSecDocument(rawXmlUrl(filing.url)), { accession: filing.accession, filedAt: filing.filedAt })).catch(
        () => [] as InsiderTransaction[],
      ),
    ),
  );
  return rows.flat().sort((a, b) => b.date.localeCompare(a.date));
}

/** Net open-market buying and selling (P and S codes only) over the last `days`. */
export function summarizeInsiders(rows: InsiderTransaction[], days = 180, now = Date.now()) {
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
  const recent = rows.filter((row) => row.date >= since && row.kind !== 'other');
  const bought = recent.filter((row) => row.kind === 'buy');
  const sold = recent.filter((row) => row.kind === 'sell');
  const sum = (items: InsiderTransaction[]) => items.reduce((total, row) => total + (row.value ?? 0), 0);
  return {
    days,
    buyers: new Set(bought.map((row) => row.owner)).size,
    sellers: new Set(sold.map((row) => row.owner)).size,
    boughtValue: sum(bought),
    soldValue: sum(sold),
    netValue: sum(bought) - sum(sold),
  };
}

export type RiskFactorChanges = RiskDiff & { current: { filedAt: string; url: string }; previous: { filedAt: string; url: string } };

/** What changed in Item 1A between the two latest annual reports. */
export async function getRiskFactorChanges(symbol: string): Promise<RiskFactorChanges | null> {
  const annual = (await getFilings(symbol)).filter((filing) => filing.form === '10-K').slice(0, 2);
  if (annual.length < 2) return null;
  const [current, previous] = annual;
  return cached(`riskdiff-v2:${previous.accession}:${current.accession}`, 365 * 86_400, async () => {
    const [before, after] = await Promise.all([fetchFilingText(previous.url, 4_000_000), fetchFilingText(current.url, 4_000_000)]);
    const diff = diffRiskFactors(extractRiskFactors(before), extractRiskFactors(after));
    return {
      ...diff,
      // Keep the payload reasonable: the longest changes matter most and full text is one click away.
      added: diff.added.slice(0, 60),
      removed: diff.removed.slice(0, 60),
      modified: diff.modified.slice(0, 60),
      current: { filedAt: current.filedAt, url: current.url },
      previous: { filedAt: previous.filedAt, url: previous.url },
    };
  });
}

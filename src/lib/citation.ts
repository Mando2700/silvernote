/** Academic citations for the sources SilverNote reads, in APA 7, Harvard and MLA 9. */

export type CitationStyle = 'APA' | 'Harvard' | 'MLA';

export type Citable =
  | { kind: 'filing'; company: string; form: string; filedAt: string; periodEnd?: string | null; url: string }
  | { kind: 'fred'; seriesId: string; title: string; publisher?: string }
  | { kind: 'dataset'; author: string; title: string; publisher: string; url: string; year?: string }
  | { kind: 'web'; author: string; title: string; site: string; published?: string | null; url: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return { year, text: `${MONTHS[month - 1]} ${day}, ${year}`, dmy: `${day} ${MONTHS[month - 1]} ${year}`, mla: `${day} ${MONTHS[month - 1].slice(0, 3)}${month === 5 ? '' : '.'} ${year}` };
}

const FORM_TITLE: Record<string, string> = {
  '10-K': 'Annual report (Form 10-K)',
  '10-Q': 'Quarterly report (Form 10-Q)',
  '8-K': 'Current report (Form 8-K)',
  '20-F': 'Annual report (Form 20-F)',
  'DEF 14A': 'Definitive proxy statement (Schedule 14A)',
  '4': 'Statement of changes in beneficial ownership (Form 4)',
};

/** "Apple Inc." stays as is; "Nasdaq" becomes "Nasdaq." */
const end = (name: string) => (name.endsWith('.') ? name : `${name}.`);

export function cite(source: Citable, style: CitationStyle, accessed = new Date().toISOString().slice(0, 10)) {
  const seen = longDate(accessed);
  if (source.kind === 'filing') {
    const filed = longDate(source.filedAt);
    const title = `${FORM_TITLE[source.form] ?? `Form ${source.form}`}${source.periodEnd ? ` for the period ended ${longDate(source.periodEnd).text}` : ''}`;
    if (style === 'APA') return `${end(source.company)} (${filed.year}). *${title}*. U.S. Securities and Exchange Commission. ${source.url}`;
    if (style === 'Harvard') return `${source.company} (${filed.year}) *${title}*. Washington, DC: U.S. Securities and Exchange Commission. Available at: ${source.url} (Accessed: ${seen.dmy}).`;
    return `${end(source.company)} *${title}*. U.S. Securities and Exchange Commission, ${filed.mla}, ${source.url.replace(/^https?:\/\//, '')}. Accessed ${seen.mla}.`;
  }
  if (source.kind === 'fred') {
    const publisher = source.publisher ?? 'Federal Reserve Bank of St. Louis';
    const url = `https://fred.stlouisfed.org/series/${source.seriesId}`;
    if (style === 'APA') return `${end(publisher)} (${seen.year}). *${source.title}* [${source.seriesId}]. FRED, Federal Reserve Bank of St. Louis. Retrieved ${seen.text}, from ${url}`;
    if (style === 'Harvard') return `${publisher} (${seen.year}) *${source.title}* [${source.seriesId}]. FRED, Federal Reserve Bank of St. Louis. Available at: ${url} (Accessed: ${seen.dmy}).`;
    return `${end(publisher)} “${source.title}.” *FRED, Federal Reserve Bank of St. Louis*, ${url.replace(/^https?:\/\//, '')}. Accessed ${seen.mla}.`;
  }
  if (source.kind === 'dataset') {
    const year = source.year ?? String(seen.year);
    if (style === 'APA') return `${end(source.author)} (${year}). *${source.title}* [Data set]. ${source.publisher}. ${source.url}`;
    if (style === 'Harvard') return `${source.author} (${year}) *${source.title}* [Dataset]. ${source.publisher}. Available at: ${source.url} (Accessed: ${seen.dmy}).`;
    return `${end(source.author)} *${source.title}*. ${source.publisher}, ${year}, ${source.url.replace(/^https?:\/\//, '')}. Accessed ${seen.mla}.`;
  }
  const published = source.published ? longDate(source.published) : null;
  if (style === 'APA') return `${end(source.author)} (${published ? published.text.replace(/^(\w+) (\d+), (\d+)$/, '$3, $1 $2') : 'n.d.'}). *${source.title}*. ${source.site}. ${source.url}`;
  if (style === 'Harvard') return `${source.author} (${published?.year ?? 'no date'}) *${source.title}*. ${source.site}. Available at: ${source.url} (Accessed: ${seen.dmy}).`;
  return `${end(source.author)} “${source.title}.” *${source.site}*, ${published ? `${published.mla}, ` : ''}${source.url.replace(/^https?:\/\//, '')}. Accessed ${seen.mla}.`;
}

/** Standard data-source citations used in exports. */
export const SOURCES = {
  secFacts: (company: string, cik: string | null): Citable => ({
    kind: 'dataset',
    author: 'U.S. Securities and Exchange Commission',
    title: `${company} company facts (XBRL financial data)`,
    publisher: 'EDGAR',
    url: cik ? `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json` : 'https://www.sec.gov/edgar/search/',
  }),
  prices: (): Citable => ({ kind: 'dataset', author: 'Nasdaq, Inc.', title: 'US equity market data', publisher: 'Nasdaq', url: 'https://www.nasdaq.com/market-activity/stocks' }),
  french: (): Citable => ({ kind: 'dataset', author: 'French, K. R.', title: 'Fama/French 5 factors (2x3) [Daily] and momentum factor', publisher: 'Kenneth R. French Data Library, Tuck School of Business at Dartmouth', url: 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html' }),
};

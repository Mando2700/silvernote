import 'server-only';

import { decodeEntities } from '@/lib/data/entities';
import { normalizeSymbol } from '@/lib/data/eligibility';
import { fetchJson, fetchText, limiters } from '@/lib/data/http';
import type { Filing } from '@/lib/data/types';
import { env } from '@/lib/env';
import type { CompanyFactsPayload, XbrlFact } from '@/lib/finance/sec-standardize';

/** SEC EDGAR: free, keyless, 10 requests/second. Every request must identify the client. */

function headers() {
  return { 'User-Agent': env.secUserAgent };
}

export function padCik(cik: string | number) {
  return String(cik).replace(/\D/g, '').padStart(10, '0');
}

export async function fetchTickerMap() {
  const payload = await fetchJson<{ fields: string[]; data: Array<[number, string, string, string]> }>(
    'https://www.sec.gov/files/company_tickers_exchange.json',
    { provider: 'sec', limiter: limiters.sec, headers: headers(), timeoutMs: 30_000 },
  );
  const map = new Map<string, { cik: string; name: string; exchange: string }>();
  for (const [cik, name, ticker, exchange] of payload.data) {
    if (!ticker) continue;
    const symbol = normalizeSymbol(ticker.replace(/-/g, '.'));
    if (!map.has(symbol)) map.set(symbol, { cik: padCik(cik), name, exchange: exchange ?? '' });
  }
  return map;
}

export function fetchCompanyFacts(cik: string) {
  return fetchJson<CompanyFactsPayload>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`, {
    provider: 'sec',
    limiter: limiters.sec,
    headers: headers(),
    timeoutMs: 60_000,
  });
}

export type FrameRow = XbrlFact & { cik: number; entityName: string; loc?: string };

/** One XBRL concept for every filer in one period, e.g. Revenues for CY2025 or Assets at CY2026Q2I. */
export async function fetchFrame(taxonomy: string, tag: string, unit: string, period: string): Promise<FrameRow[]> {
  try {
    const payload = await fetchJson<{ data: FrameRow[] }>(
      `https://data.sec.gov/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`,
      { provider: 'sec', limiter: limiters.sec, headers: headers(), timeoutMs: 60_000 },
    );
    return payload.data ?? [];
  } catch (error) {
    // A concept that nobody reported for that period returns 404: treat as empty.
    if ((error as { status?: number }).status === 404) return [];
    throw error;
  }
}

type Submissions = {
  cik: string;
  name: string;
  sic?: string;
  sicDescription?: string;
  fiscalYearEnd?: string;
  website?: string;
  exchanges?: string[];
  filings?: {
    recent?: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
      /** 8-K item numbers, e.g. "2.02,9.01" (2.02 = results of operations, i.e. an earnings release). */
      items?: string[];
    };
  };
};

export async function fetchSubmissions(cik: string) {
  const payload = await fetchJson<Submissions>(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`, {
    provider: 'sec',
    limiter: limiters.sec,
    headers: headers(),
  });
  const recent = payload.filings?.recent;
  const filings: Filing[] = [];
  if (recent) {
    for (let index = 0; index < recent.accessionNumber.length && filings.length < 1000; index += 1) {
      const accession = recent.accessionNumber[index];
      const primaryDocument = recent.primaryDocument[index] ?? '';
      const cikNumber = String(Number(padCik(cik)));
      filings.push({
        form: recent.form[index],
        filedAt: recent.filingDate[index],
        reportDate: recent.reportDate[index] || null,
        accession,
        primaryDocument,
        description: recent.primaryDocDescription[index] || null,
        items: recent.items?.[index] || null,
        url: `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accession.replace(/-/g, '')}/${primaryDocument}`,
      });
    }
  }
  return {
    name: payload.name,
    sic: payload.sic ?? null,
    sicDescription: payload.sicDescription ?? null,
    fiscalYearEnd: payload.fiscalYearEnd ?? null,
    website: payload.website || null,
    filings,
  };
}

/** Plain text of a filing's primary document (HTML stripped), trimmed to a size an AI model can read. */
export async function fetchFilingText(url: string, maxChars = 120_000) {
  if (!/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(url)) throw new Error('Only EDGAR archive documents can be read.');
  const html = await fetchText(url, { provider: 'sec', limiter: limiters.sec, headers: headers(), timeoutMs: 60_000 });
  const text = decodeEntities(html
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h\d|table|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated]` : text;
}

/** Raw text of any EDGAR archive document (XML ownership forms, exhibits). */
export async function fetchSecDocument(url: string) {
  if (!/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(url)) throw new Error('Only EDGAR archive documents can be read.');
  return fetchText(url, { provider: 'sec', limiter: limiters.sec, headers: headers(), timeoutMs: 30_000 });
}

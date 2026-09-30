import 'server-only';

import { inflateRawSync } from 'node:zlib';

import { parseFrenchCsv, unzipFirst } from '@/lib/finance/analytics';

const BASE = 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp';

async function download(file: string) {
  const response = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'SilverNote research' } });
  if (!response.ok) throw new Error(`Ken French data library returned ${response.status}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  return Buffer.from(unzipFirst(zip, (data) => inflateRawSync(data))).toString('latin1');
}

/**
 * Daily Fama-French five factors plus momentum (decimals), keyed by date. Updated monthly by the
 * library with a one to two month lag.
 */
export async function fetchFrenchDaily() {
  const [five, momentum] = await Promise.all([download('F-F_Research_Data_5_Factors_2x3_daily_CSV.zip'), download('F-F_Momentum_Factor_daily_CSV.zip')]);
  const ff = parseFrenchCsv(five);
  const mom = parseFrenchCsv(momentum);
  const index = (name: string) => ff.columns.indexOf(name);
  const rows: Array<{ date: string; mktRf: number; smb: number; hml: number; rmw: number; cma: number; mom: number; rf: number }> = [];
  for (const [date, values] of ff.rows) {
    const m = mom.rows.get(date)?.[0];
    if (m === undefined) continue;
    rows.push({ date, mktRf: values[index('Mkt-RF')], smb: values[index('SMB')], hml: values[index('HML')], rmw: values[index('RMW')], cma: values[index('CMA')], mom: m, rf: values[index('RF')] });
  }
  // Only the recent decade is needed for portfolio regressions; keeps the cached payload small.
  return rows.slice(-2600);
}

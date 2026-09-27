import 'server-only';

import { fetchText, limiters } from '@/lib/data/http';

/** FRED (St. Louis Fed) CSV downloads: keyless daily series such as NASDAQCOM (1971→) or DGS3MO. */
export async function fetchFredSeries(seriesId: string, start?: string, end?: string) {
  const params = new URLSearchParams({ id: seriesId });
  if (start) params.set('cosd', start);
  if (end) params.set('coed', end);
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?${params}`, {
    provider: 'fred',
    limiter: limiters.fred,
    timeoutMs: 30_000,
  });
  const points: Array<{ date: string; value: number }> = [];
  for (const line of csv.split('\n').slice(1)) {
    const [date, raw] = line.trim().split(',');
    const value = Number(raw);
    if (date && raw && raw !== '.' && Number.isFinite(value)) points.push({ date, value });
  }
  return points;
}

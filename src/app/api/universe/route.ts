import { NextResponse } from 'next/server';

import { route } from '@/lib/api';
import { getUniverse, METRIC_KEYS } from '@/lib/services/screener';

export const dynamic = 'force-dynamic';

/** Compact column-major-ish payload: one header row, then arrays. ~6k rows stay under a megabyte gzipped. */
export const GET = route(async () => {
  const entries = await getUniverse();
  const fields = ['symbol', 'name', 'sector', 'industry', 'country', 'fiscalYear', 'scoreLabel', ...METRIC_KEYS] as const;
  const round = (value: unknown) => (typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value);
  const rows = entries.map((entry) => fields.map((field) => round((entry as Record<string, unknown>)[field] ?? null)));
  return NextResponse.json({ fields, rows, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, max-age=20' } });
});

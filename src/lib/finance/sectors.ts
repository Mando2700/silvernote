/**
 * Sector day change, computed one way everywhere (dashboard hero, sector bars, market map).
 * Market-cap weighted over the largest US listings, the same shape as the S&P 500 sector indices
 * that news and banks quote, so a sector reads the same on every screen.
 */
export const SECTOR_UNIVERSE_SIZE = 520;

export type SectorInput = { sector: string | null; marketCap: number | null; changePct: number | null };
export type SectorStat = { sector: string; marketCap: number; changePct: number | null; count: number };

/** Entries must already be ordered by market cap, largest first. */
export function sectorPerformance(entries: SectorInput[], size = SECTOR_UNIVERSE_SIZE): SectorStat[] {
  const buckets = new Map<string, { cap: number; weighted: number; count: number }>();
  for (const entry of entries.slice(0, size)) {
    if (!entry.marketCap || entry.marketCap <= 0 || entry.changePct === null) continue;
    const key = entry.sector ?? 'Other';
    const bucket = buckets.get(key) ?? { cap: 0, weighted: 0, count: 0 };
    bucket.cap += entry.marketCap;
    bucket.weighted += entry.changePct * entry.marketCap;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([sector, bucket]) => ({ sector, marketCap: bucket.cap, changePct: bucket.cap ? bucket.weighted / bucket.cap : null, count: bucket.count }))
    .sort((a, b) => b.marketCap - a.marketCap);
}

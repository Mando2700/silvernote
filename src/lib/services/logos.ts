import 'server-only';

import { q, q1 } from '@/lib/db';
import { RateLimiter } from '@/lib/data/http';
import * as finnhub from '@/lib/data/providers/finnhub';
import { normalizeLogo } from '@/lib/services/logo-normalize';

/**
 * Company logos. Each symbol is looked up once — FMP's free logo endpoint first (no key needed),
 * then the logo URL on the Finnhub profile when a key is set — and the image is stored in the
 * database. Misses are remembered too, so the sources are not asked again for a week.
 */

export type Logo = { contentType: string; data: Uint8Array; source: string };

/** Bump when normalizeLogo changes so stored tiles are rebuilt. */
const TILE_VERSION = 'tile4';
const REFRESH_AFTER_MS = 45 * 86_400_000;
const RETRY_MISSING_AFTER_MS = 7 * 86_400_000;
const MAX_BYTES = 600 * 1024;
const limiter = new RateLimiter(40, 6);
const inflight = new Map<string, Promise<Logo | null>>();

/** Raster formats only: an SVG served from this origin could run script if opened directly. */
function sniff(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') return 'image/gif';
  return null;
}

async function download(url: string, source: string): Promise<Logo | null> {
  return limiter.run(async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'follow' });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 64 || bytes.length > MAX_BYTES) return null;
      if (!sniff(bytes)) return null;
      const tile = await normalizeLogo(bytes);
      return tile ? { contentType: 'image/png', data: tile, source: `${source}:${TILE_VERSION}` } : null;
    } catch {
      return null;
    }
  });
}

async function fetchFromSources(symbol: string): Promise<Logo | null> {
  const variants = [...new Set([symbol, symbol.replace(/\./g, '-')])];
  for (const variant of variants) {
    const logo = await download(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(variant)}.png`, 'fmp');
    if (logo) return logo;
  }
  if (finnhub.finnhubEnabled()) {
    const profile = await finnhub.fetchProfile(symbol).catch(() => null);
    if (profile?.logo && /^https:\/\//.test(profile.logo)) {
      const logo = await download(profile.logo, 'finnhub');
      if (logo) return logo;
    }
  }
  return null;
}

async function load(symbol: string): Promise<Logo | null> {
  const row = await q1<{ content_type: string | null; data: Uint8Array | null; source: string; fetched_at: Date | string }>(
    'select content_type, data, source, fetched_at from public.company_logos where symbol = $1',
    [symbol],
  );
  const age = row ? Date.now() - new Date(row.fetched_at).getTime() : Infinity;
  // Raw images stored before tiles existed can be rebuilt in place; older tiles are refetched below.
  if (row?.data && row.content_type && age < REFRESH_AFTER_MS && !row.source.includes(':')) {
    // Stored before tiles were normalized: rebuild from the stored image rather than refetching.
    const tile = await normalizeLogo(row.data);
    if (tile) {
      const source = `${row.source.split(':')[0]}:${TILE_VERSION}`;
      await q('update public.company_logos set content_type = $2, data = $3, source = $4 where symbol = $1', [symbol, 'image/png', tile, source]);
      return { contentType: 'image/png', data: tile, source };
    }
  }
  if (row?.data && row.content_type && age < REFRESH_AFTER_MS && row.source.endsWith(`:${TILE_VERSION}`)) return { contentType: row.content_type, data: row.data, source: row.source };
  if (row && !row.data && age < RETRY_MISSING_AFTER_MS) return null;

  const fresh = await fetchFromSources(symbol);
  if (fresh) {
    await q(
      `insert into public.company_logos (symbol, content_type, data, source, fetched_at) values ($1, $2, $3, $4, now())
       on conflict (symbol) do update set content_type = excluded.content_type, data = excluded.data, source = excluded.source, fetched_at = now()`,
      [symbol, fresh.contentType, fresh.data, fresh.source],
    );
    return fresh;
  }
  if (row?.data && row.content_type) {
    // Keep serving the stored logo when a refresh fails.
    await q('update public.company_logos set fetched_at = now() where symbol = $1', [symbol]);
    return { contentType: row.content_type, data: row.data, source: row.source };
  }
  await q(
    `insert into public.company_logos (symbol, content_type, data, source, fetched_at) values ($1, null, null, 'none', now())
     on conflict (symbol) do update set content_type = null, data = null, source = 'none', fetched_at = now()`,
    [symbol],
  );
  return null;
}

export async function getLogo(symbol: string): Promise<Logo | null> {
  const key = symbol.toUpperCase();
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = load(key).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

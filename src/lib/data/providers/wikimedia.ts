import 'server-only';

import { fetchJson, limiters } from '@/lib/data/http';
import { env } from '@/lib/env';

/**
 * Wikidata + Wikimedia Commons: free, keyless. Wikimedia asks every client to identify itself
 * with a descriptive User-Agent that includes contact details.
 */

export function wikimediaHeaders() {
  return { 'User-Agent': `SilverNote/1.0 (${env.secUserAgent})` };
}

const options = () => ({ provider: 'wikimedia', limiter: limiters.wikimedia, headers: wikimediaHeaders(), timeoutMs: 15_000, retries: 1 });

type SparqlResult = { results: { bindings: Array<Record<string, { value: string } | undefined>> } };

async function sparql(query: string) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const payload = await fetchJson<SparqlResult>(url, { ...options(), headers: { ...wikimediaHeaders(), Accept: 'application/sparql-results+json' } });
  return payload.results.bindings;
}

const entityId = (uri: string | undefined) => uri?.match(/Q\d+$/)?.[0] ?? null;
const quote = (value: string) => `"${value.replace(/["\\]/g, '')}"`;

/** The Wikidata item for a company, by SEC CIK (exact) or else by ticker, preferring a label that matches the name. */
export async function findCompany(input: { cik: string | null; symbol: string; name: string }): Promise<string | null> {
  if (input.cik) {
    const cik = input.cik.replace(/\D/g, '').padStart(10, '0');
    const [row] = await sparql(`SELECT ?item WHERE { ?item wdt:P5531 ${quote(cik)} } LIMIT 1`);
    const id = entityId(row?.item?.value);
    if (id) return id;
  }
  const rows = await sparql(
    `SELECT DISTINCT ?item ?itemLabel WHERE { ?item p:P414 ?listing. ?listing pq:P249 ${quote(input.symbol)}. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 8`,
  );
  const firstWord = input.name.toLowerCase().split(/[\s,.]+/)[0] ?? '';
  const match = rows.find((row) => firstWord && row.itemLabel?.value.toLowerCase().startsWith(firstWord)) ?? (rows.length === 1 ? rows[0] : undefined);
  return entityId(match?.item?.value);
}

/** Buildings whose occupant is the company (e.g. a named headquarters campus). */
export async function occupiedBuildings(id: string) {
  const rows = await sparql(
    `SELECT ?building ?buildingLabel ?image WHERE { ?building wdt:P466 wd:${id}; wdt:P18 ?image. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 6`,
  );
  return rows.flatMap((row) => {
    const file = row.image?.value ? decodeURIComponent(row.image.value.split('/Special:FilePath/')[1] ?? '') : '';
    return file ? [{ label: row.buildingLabel?.value ?? '', file }] : [];
  });
}

export type Snak = { datavalue?: { value: unknown } };
export type Statement = { mainsnak: Snak; rank: 'preferred' | 'normal' | 'deprecated'; qualifiers?: Record<string, Snak[]> };
export type Entity = { id: string; labels?: { en?: { value: string } }; claims?: Record<string, Statement[]> };

export async function fetchEntities(ids: string[]): Promise<Record<string, Entity>> {
  const out: Record<string, Entity> = {};
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const payload = await fetchJson<{ entities: Record<string, Entity> }>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${batch.join('|')}`,
      options(),
    );
    Object.assign(out, payload.entities);
  }
  return out;
}

export type CommonsFile = {
  file: string;
  mime: string;
  thumbUrl: string;
  width: number;
  height: number;
  pageUrl: string;
  artist: string | null;
  license: string | null;
  description: string | null;
};

type ImageInfoPage = {
  title: string;
  missing?: string;
  imageinfo?: Array<{
    mime: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    descriptionurl: string;
    extmetadata?: Record<string, { value: string } | undefined>;
  }>;
};

/** Plain text from Commons' HTML metadata fields. */
function plainText(html: string | undefined, max: number) {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Thumbnail URLs, sizes and attribution for Commons files (by file name, without the "File:" prefix). */
export async function fetchCommonsFiles(files: string[], width = 1280): Promise<CommonsFile[]> {
  const out: CommonsFile[] = [];
  for (let index = 0; index < files.length; index += 40) {
    const titles = files.slice(index, index + 40).map((file) => `File:${file}`);
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: String(width),
      iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription',
      titles: titles.join('|'),
    });
    const payload = await fetchJson<{ query?: { pages?: Record<string, ImageInfoPage> } }>(`https://commons.wikimedia.org/w/api.php?${params}`, options());
    for (const page of Object.values(payload.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (page.missing !== undefined || !info?.thumburl) continue;
      const meta = info.extmetadata ?? {};
      out.push({
        file: page.title.replace(/^File:/, ''),
        mime: info.mime,
        thumbUrl: info.thumburl,
        width: info.thumbwidth ?? 0,
        height: info.thumbheight ?? 0,
        pageUrl: info.descriptionurl,
        artist: plainText(meta.Artist?.value, 90),
        license: plainText(meta.LicenseShortName?.value, 40),
        description: plainText(meta.ImageDescription?.value, 220),
      });
    }
  }
  return out;
}

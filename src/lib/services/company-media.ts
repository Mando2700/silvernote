import 'server-only';

import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { cached, limiters } from '@/lib/data/http';
import * as wikimedia from '@/lib/data/providers/wikimedia';
import { getSecurity } from '@/lib/services/universe';

/**
 * Freely licensed company photos (headquarters, campus, products, leadership) from Wikidata and
 * Wikimedia Commons, with the attribution each licence requires. Used by the thesis PDF export.
 */

export type MediaKind = 'headquarters' | 'building' | 'company' | 'interior' | 'night' | 'city' | 'product' | 'leadership';

export type CompanyImage = {
  id: string;
  kind: MediaKind;
  caption: string;
  description: string | null;
  credit: string | null;
  license: string | null;
  sourceUrl: string;
  width: number;
  height: number;
  /** Selected by default in the export dialog. */
  suggested: boolean;
};

export type CompanyMedia = {
  entity: string | null;
  headquarters: { address: string | null; city: string | null } | null;
  images: Array<CompanyImage & { thumbUrl: string }>;
};

const KIND_ORDER: MediaKind[] = ['headquarters', 'building', 'company', 'interior', 'night', 'city', 'product', 'leadership'];
const SUGGESTED: MediaKind[] = ['headquarters', 'building', 'company', 'interior', 'night'];
const RASTER = /^image\/(jpeg|png|webp|tiff)$/;
const MIN_WIDTH = 640;

const statements = (entity: wikimedia.Entity | undefined, property: string) => (entity?.claims?.[property] ?? []).filter((item) => item.rank !== 'deprecated');

/** Statements still in force (no end date), preferred rank first. */
function current(entity: wikimedia.Entity | undefined, property: string) {
  const live = statements(entity, property).filter((item) => !item.qualifiers?.P582?.length);
  return [...live.filter((item) => item.rank === 'preferred'), ...live.filter((item) => item.rank !== 'preferred')];
}

function itemId(snak: wikimedia.Snak | undefined) {
  const value = snak?.datavalue?.value as { id?: string } | undefined;
  return typeof value?.id === 'string' ? value.id : null;
}

function text(snak: wikimedia.Snak | undefined) {
  const value = snak?.datavalue?.value;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: string }).text);
  return null;
}

const files = (entity: wikimedia.Entity | undefined, property = 'P18') => statements(entity, property).map((item) => text(item.mainsnak)).filter((file): file is string => Boolean(file));
const label = (entity: wikimedia.Entity | undefined) => entity?.labels?.en?.value ?? null;
const fileKey = (file: string) => file.replace(/_/g, ' ').trim().toLowerCase();

async function load(symbol: string): Promise<CompanyMedia> {
  const security = await getSecurity(symbol);
  const id = await wikimedia.findCompany({ cik: security?.cik ?? null, symbol, name: security?.name ?? symbol });
  if (!id) return { entity: null, headquarters: null, images: [] };

  const [company] = Object.values(await wikimedia.fetchEntities([id]));
  const name = label(company) ?? security?.name ?? symbol;
  const hqStatements = current(company, 'P159').slice(0, 3);
  const hq = hqStatements.find((item) => item.qualifiers?.P6375?.length) ?? hqStatements[0];
  const places = hqStatements.map((item) => itemId(item.mainsnak));
  const sites = hqStatements.map((item) => itemId(item.qualifiers?.P276?.[0]));
  const products = current(company, 'P1056').map((item) => itemId(item.mainsnak)).filter((value): value is string => Boolean(value)).slice(0, 8);
  const ceo = itemId(current(company, 'P169')[0]?.mainsnak);
  const related = await wikimedia.fetchEntities([...new Set([...places, ...sites, ceo, ...products].filter((value): value is string => Boolean(value)))]);
  const buildings = await wikimedia.occupiedBuildings(id).catch(() => []);

  const candidates: Array<{ file: string; kind: MediaKind; caption: string }> = [];
  const add = (file: string | null | undefined, kind: MediaKind, caption: string) => {
    if (file) candidates.push({ file, kind, caption });
  };

  const address = text(hq?.qualifiers?.P6375?.[0]);
  const hqPlace = itemId(hq?.mainsnak);
  // The headquarters value is usually a city; occasionally it is the campus or building itself.
  const isCity = (entity: wikimedia.Entity | undefined) => Boolean(statements(entity, 'P1082').length);
  const city = isCity(related[hqPlace ?? '']) ? label(related[hqPlace ?? '']) : null;
  const siteName = sites.map((site) => label(related[site ?? ''])).find(Boolean) ?? places.map((place) => (isCity(related[place ?? '']) ? null : label(related[place ?? '']))).find(Boolean) ?? null;
  const hqCaption = `${name} headquarters${siteName ? `, ${siteName}` : ''}${city ? `, ${city}` : ''}`;
  for (const statement of hqStatements) for (const qualifier of statement.qualifiers?.P18 ?? []) add(text(qualifier), 'headquarters', hqCaption);
  for (const site of sites) for (const file of files(related[site ?? ''])) add(file, 'headquarters', hqCaption);
  for (const place of places) {
    const entity = related[place ?? ''];
    for (const file of files(entity)) add(file, isCity(entity) ? 'city' : 'headquarters', isCity(entity) ? `${label(entity)}, home of ${name}’s headquarters` : hqCaption);
  }
  for (const building of buildings) add(building.file, 'building', `${building.label || 'Offices'}, occupied by ${name}`);
  for (const file of files(company)) add(file, 'company', name);
  for (const file of files(company, 'P5775')) add(file, 'interior', `Inside ${name}`);
  for (const file of files(company, 'P3451')) add(file, 'night', `${name} at night`);
  // Lower-case labels are generic categories ("computer hardware"), not the company's own products.
  for (const product of products) {
    const productName = label(related[product]);
    if (productName && /^[A-Z0-9]/.test(productName)) for (const file of files(related[product]).slice(0, 1)) add(file, 'product', productName);
  }
  const ceoName = label(related[ceo ?? '']);
  if (ceoName) for (const file of files(related[ceo ?? '']).slice(0, 1)) add(file, 'leadership', `${ceoName}, Chief Executive Officer`);

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) if (!unique.has(fileKey(candidate.file))) unique.set(fileKey(candidate.file), candidate);
  const info = await wikimedia.fetchCommonsFiles([...unique.values()].map((candidate) => candidate.file));
  const byFile = new Map(info.map((item) => [fileKey(item.file), item]));

  const images = [...unique.values()]
    .flatMap((candidate) => {
      const file = byFile.get(fileKey(candidate.file));
      if (!file || !RASTER.test(file.mime) || file.width < MIN_WIDTH) return [];
      // The company's own image is often its campus: the photo's description names it better than the company name alone.
      const lead = file.description?.split(/(?<=[a-z)])\.\s|;\s/)[0]?.replace(/\.$/, '');
      return [
        {
          id: createHash('sha1').update(file.file).digest('hex').slice(0, 12),
          kind: candidate.kind,
          caption: candidate.kind === 'company' && lead && lead.length <= 110 ? lead : candidate.caption,
          description: file.description,
          credit: file.artist,
          license: file.license,
          sourceUrl: file.pageUrl,
          width: file.width,
          height: file.height,
          suggested: SUGGESTED.includes(candidate.kind),
          thumbUrl: file.thumbUrl,
        },
      ];
    })
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .slice(0, 14);

  return { entity: id, headquarters: address || city ? { address, city } : null, images };
}

export function getCompanyMedia(symbol: string) {
  return cached(`media:v3:${symbol.toUpperCase()}`, 14 * 86_400, () => load(symbol.toUpperCase()));
}

/** One image, re-encoded as a JPEG no wider than 1600px (the PDF renderer reads only JPEG and PNG). */
export async function getCompanyImage(symbol: string, id: string): Promise<Uint8Array | null> {
  const media = await getCompanyMedia(symbol);
  const image = media.images.find((item) => item.id === id);
  if (!image || !/^https:\/\/[a-z.]+\.wikimedia\.org\//.test(image.thumbUrl)) return null;
  const response = await limiters.wikimedia.run(() => fetch(image.thumbUrl, { headers: wikimedia.wikimediaHeaders(), signal: AbortSignal.timeout(20_000), cache: 'no-store' }));
  if (!response.ok) return null;
  const input = new Uint8Array(await response.arrayBuffer());
  if (input.length > 25 * 1024 * 1024) return null;
  const output = await sharp(input).rotate().resize({ width: 1600, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return new Uint8Array(output);
}

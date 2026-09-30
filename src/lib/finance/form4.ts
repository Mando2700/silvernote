import { XMLParser } from 'fast-xml-parser';

/** One line of a Form 4's non-derivative table (common stock bought, sold, granted, …). */
export type InsiderTransaction = {
  accession: string;
  filedAt: string;
  owner: string;
  role: string;
  date: string;
  code: string;
  /** Open-market purchase (P) or sale (S); everything else is a grant, exercise, gift or tax withholding. */
  kind: 'buy' | 'sell' | 'other';
  shares: number;
  price: number | null;
  value: number | null;
  ownedAfter: number | null;
};

export const TRANSACTION_CODES: Record<string, string> = {
  P: 'Open-market purchase',
  S: 'Open-market sale',
  A: 'Grant or award',
  M: 'Option exercise',
  F: 'Tax withholding',
  G: 'Gift',
  D: 'Disposition to issuer',
  C: 'Conversion',
  X: 'Option exercise',
};

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false });

const list = <T,>(value: T | T[] | undefined | null): T[] => (value == null ? [] : Array.isArray(value) ? value : [value]);

function num(value: unknown) {
  const raw = typeof value === 'object' && value !== null ? (value as { value?: unknown }).value : value;
  const parsed = Number(String(raw ?? '').replace(/[,$\s]/g, ''));
  return raw === undefined || raw === '' || !Number.isFinite(parsed) ? null : parsed;
}

function text(value: unknown) {
  const raw = typeof value === 'object' && value !== null ? (value as { value?: unknown }).value : value;
  return raw == null ? '' : String(raw).trim();
}

function truthy(value: unknown) {
  const raw = text(value).toLowerCase();
  return raw === '1' || raw === 'true';
}

type Owner = { reportingOwnerId?: { rptOwnerName?: unknown }; reportingOwnerRelationship?: Record<string, unknown> };

/** Parse a Form 4 (or 4/A) ownership XML into its common-stock transactions. */
export function parseForm4(xml: string, meta: { accession: string; filedAt: string }): InsiderTransaction[] {
  const doc = (parser.parse(xml) as { ownershipDocument?: Record<string, unknown> }).ownershipDocument;
  if (!doc) return [];
  const owners = list(doc.reportingOwner as Owner | Owner[]);
  const first = owners[0];
  const relation = first?.reportingOwnerRelationship ?? {};
  const role = truthy(relation.isOfficer)
    ? text(relation.officerTitle) || 'Officer'
    : truthy(relation.isDirector)
      ? 'Director'
      : truthy(relation.isTenPercentOwner)
        ? '10% owner'
        : text(relation.otherText) || 'Insider';
  const owner = owners.map((item) => text(item.reportingOwnerId?.rptOwnerName)).filter(Boolean).join(', ') || 'Unknown';
  const table = doc.nonDerivativeTable as { nonDerivativeTransaction?: unknown } | undefined;
  return list(table?.nonDerivativeTransaction as Record<string, unknown> | Record<string, unknown>[]).map((row) => {
    const coding = row.transactionCoding as Record<string, unknown> | undefined;
    const amounts = row.transactionAmounts as Record<string, unknown> | undefined;
    const post = row.postTransactionAmounts as Record<string, unknown> | undefined;
    const code = text(coding?.transactionCode).toUpperCase();
    const shares = num(amounts?.transactionShares) ?? 0;
    const price = num(amounts?.transactionPricePerShare);
    return {
      accession: meta.accession,
      filedAt: meta.filedAt,
      owner,
      role,
      date: text(row.transactionDate) || meta.filedAt,
      code,
      kind: code === 'P' ? 'buy' : code === 'S' ? 'sell' : 'other',
      shares,
      price: price && price > 0 ? price : null,
      value: price && price > 0 ? price * shares : null,
      ownedAfter: num(post?.sharesOwnedFollowingTransaction),
    };
  });
}

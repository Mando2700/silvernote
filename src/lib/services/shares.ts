import 'server-only';

import { HttpError } from '@/lib/auth';
import { memo } from '@/lib/data/http';
import { q, q1 } from '@/lib/db';
import { expiryDate, hashPasscode, newShareToken, shareStatus, type ShareStatus } from '@/lib/share/access';
import { normalizeShareOptions, type ShareExpiry, type ShareMode, type ShareOptions } from '@/lib/share/options';
import { buildShareView, type ShareSource, type ShareView } from '@/lib/share/view';
import { getHoldings, getPortfolio, getTransactions, performanceHistory, type PortfolioRow } from '@/lib/services/portfolio';

export type ShareRow = {
  id: string;
  user_id: string;
  portfolio_id: string;
  token: string;
  title: string | null;
  message: string | null;
  mode: ShareMode;
  options: ShareOptions;
  snapshot: ShareView | null;
  passcode_hash: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  view_count: number;
  last_viewed_at: Date | null;
  created_at: Date;
};

/** What the owner's list needs: no snapshot payload and no passcode hash. */
export type ShareListItem = {
  id: string;
  token: string;
  title: string | null;
  message: string | null;
  mode: ShareMode;
  options: ShareOptions;
  protected: boolean;
  status: ShareStatus;
  expires_at: Date | null;
  view_count: number;
  last_viewed_at: Date | null;
  created_at: Date;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

function toListItem(row: Omit<ShareRow, 'snapshot'>): ShareListItem {
  return {
    id: row.id,
    token: row.token,
    title: row.title,
    message: row.message,
    mode: row.mode,
    options: row.options,
    protected: Boolean(row.passcode_hash),
    status: shareStatus(row),
    expires_at: row.expires_at,
    view_count: row.view_count,
    last_viewed_at: row.last_viewed_at,
    created_at: row.created_at,
  };
}

const LIST_COLUMNS = 'id, user_id, portfolio_id, token, title, message, mode, options, passcode_hash, expires_at, revoked_at, view_count, last_viewed_at, created_at';

/** A portfolio as the public sees it needs no signed-in user: the link's token is the authority. */
async function loadSource(portfolio: PortfolioRow, withPerformance: boolean): Promise<ShareSource> {
  const { holdings, summary } = await getHoldings(portfolio);
  const performance = withPerformance
    ? await memo(`share-performance:${portfolio.id}`, 5 * 60_000, async () =>
        (await performanceHistory(await getTransactions(portfolio.id), portfolio.benchmark)).map((point) => ({ t: point.t, twr: point.twr, benchmark: point.benchmark })),
      )
    : null;
  return { name: portfolio.name, benchmark: portfolio.benchmark, cash: portfolio.cash ?? 0, fixedIncome: summary.fixedIncome, holdings, performance, asOf: Date.now() };
}

async function buildView(portfolio: PortfolioRow, options: ShareOptions, title: string | null) {
  const normalized = normalizeShareOptions(options);
  return buildShareView(await loadSource(portfolio, normalized.sections.performance), normalized, title);
}

export async function listShares(userId: string, portfolioId: string): Promise<ShareListItem[]> {
  await getPortfolio(userId, portfolioId);
  const rows = await q<Omit<ShareRow, 'snapshot'>>(`select ${LIST_COLUMNS} from public.portfolio_shares where portfolio_id = $1 and user_id = $2 order by created_at desc`, [portfolioId, userId]);
  return rows.map(toListItem);
}

export type CreateShareInput = {
  title: string | null;
  message: string | null;
  mode: ShareMode;
  options: ShareOptions;
  expires: ShareExpiry;
  passcode: string | null;
};

export async function createShare(userId: string, portfolioId: string, input: CreateShareInput): Promise<ShareListItem> {
  const portfolio = await getPortfolio(userId, portfolioId);
  const options = normalizeShareOptions(input.options);
  // A snapshot freezes the redacted view now; a live link keeps only the rules and recomputes on each visit.
  const snapshot = input.mode === 'snapshot' ? await buildView(portfolio, options, input.title) : null;
  const passcodeHash = input.passcode ? await hashPasscode(input.passcode) : null;
  const [row] = await q<Omit<ShareRow, 'snapshot'>>(
    `insert into public.portfolio_shares (user_id, portfolio_id, token, title, message, mode, options, snapshot, passcode_hash, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10) returning ${LIST_COLUMNS}`,
    [userId, portfolioId, newShareToken(), input.title, input.message, input.mode, options, snapshot, passcodeHash, expiryDate(input.expires)],
  );
  return toListItem(row);
}

export type UpdateShareInput = {
  revoked?: boolean;
  expires?: ShareExpiry;
  /** A new passcode, or null to remove it. */
  passcode?: string | null;
  title?: string | null;
  message?: string | null;
};

export async function updateShare(userId: string, portfolioId: string, shareId: string, input: UpdateShareInput): Promise<ShareListItem> {
  const current = await q1<Omit<ShareRow, 'snapshot'>>(`select ${LIST_COLUMNS} from public.portfolio_shares where id = $1 and portfolio_id = $2 and user_id = $3`, [shareId, portfolioId, userId]);
  if (!current) throw new HttpError(404, 'Link not found.');
  const passcodeHash = input.passcode === undefined ? current.passcode_hash : input.passcode ? await hashPasscode(input.passcode) : null;
  const revokedAt = input.revoked === undefined ? current.revoked_at : input.revoked ? (current.revoked_at ?? new Date()) : null;
  const expiresAt = input.expires === undefined ? current.expires_at : expiryDate(input.expires);
  const [row] = await q<Omit<ShareRow, 'snapshot'>>(
    `update public.portfolio_shares set title = $4, message = $5, passcode_hash = $6, revoked_at = $7, expires_at = $8
     where id = $1 and portfolio_id = $2 and user_id = $3 returning ${LIST_COLUMNS}`,
    [shareId, portfolioId, userId, input.title === undefined ? current.title : input.title, input.message === undefined ? current.message : input.message, passcodeHash, revokedAt, expiresAt],
  );
  return toListItem(row);
}

export async function deleteShare(userId: string, portfolioId: string, shareId: string) {
  await q('delete from public.portfolio_shares where id = $1 and portfolio_id = $2 and user_id = $3', [shareId, portfolioId, userId]);
}

export async function getShareByToken(token: string): Promise<ShareRow | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  return q1<ShareRow>('select * from public.portfolio_shares where token = $1', [token]);
}

/** What a visitor sees: the frozen view of a snapshot, or a fresh (briefly cached) view of a live link. */
export async function getShareView(share: ShareRow): Promise<ShareView | null> {
  if (share.mode === 'snapshot') return share.snapshot;
  return memo(`share-view:${share.id}`, 60_000, async () => {
    const portfolio = await q1<PortfolioRow>('select * from public.portfolios where id = $1', [share.portfolio_id]);
    return portfolio ? buildView(portfolio, share.options, share.title) : null;
  });
}

export async function recordView(shareId: string) {
  await q('update public.portfolio_shares set view_count = view_count + 1, last_viewed_at = now() where id = $1', [shareId]);
}

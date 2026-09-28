import 'server-only';

import { HttpError } from '@/lib/auth';
import { q, q1, tx } from '@/lib/db';
import { fetchFlexStatement, FlexError, parseFlexStatement, type FlexAccount } from '@/lib/data/providers/ibkr';
import { usdPerUnit } from '@/lib/data/providers/fx';
import { todayInNewYork } from '@/lib/dates';

export type BrokerConnection = {
  id: string;
  user_id: string;
  flex_token: string;
  flex_query_id: string;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
  message: string | null;
  last_attempt_at: Date | null;
  last_synced_at: Date | null;
};

export type SyncResult = { accounts: number; trades: number; positions: number; skipped: number; warnings: string[] };

const SYNC_EVERY_MS = 4 * 3_600_000;
const globalForIbkr = globalThis as unknown as { __silvernoteIbkrSyncing?: Map<string, Promise<SyncResult>> };
const syncing = (globalForIbkr.__silvernoteIbkrSyncing ??= new Map());

export function isIbkrSyncing(connectionId: string) {
  return syncing.has(connectionId);
}

export async function getIbkrConnection(userId: string) {
  return q1<BrokerConnection>(`select * from public.broker_connections where user_id = $1 and broker = 'ibkr'`, [userId]);
}

/** What the browser may see: never the token itself. */
export async function ibkrStatus(userId: string) {
  const connection = await getIbkrConnection(userId);
  if (!connection) return { connected: false as const };
  const accounts = await q<{ account_id: string; portfolio_id: string; name: string }>(
    `select a.account_id, a.portfolio_id, p.name from public.broker_accounts a join public.portfolios p on p.id = a.portfolio_id
     where a.connection_id = $1 order by a.account_id`,
    [connection.id],
  );
  return {
    connected: true as const,
    status: connection.status,
    error: connection.error,
    message: connection.message,
    queryId: connection.flex_query_id,
    tokenHint: `…${connection.flex_token.slice(-4)}`,
    lastSyncedAt: connection.last_synced_at,
    lastAttemptAt: connection.last_attempt_at,
    syncing: syncing.has(connection.id),
    accounts: accounts.map((row) => ({ accountId: row.account_id, portfolioId: row.portfolio_id, portfolioName: row.name })),
  };
}

/** Check the token and query against IBKR before saving anything, then import straight away. */
export async function connectIbkr(userId: string, token: string, queryId: string) {
  const xml = await fetchFlexStatement(token, queryId).catch((error) => {
    throw new HttpError(400, error instanceof FlexError ? error.message : `Could not reach IBKR: ${(error as Error).message}`);
  });
  const accounts = parseFlexStatement(xml);
  if (!accounts.length) throw new HttpError(400, 'The Flex Query returned no accounts. Make sure it is an Activity Flex Query in XML format.');
  const connection = await q1<BrokerConnection>(
    `insert into public.broker_connections (user_id, broker, flex_token, flex_query_id, status, error)
     values ($1, 'ibkr', $2, $3, 'pending', null)
     on conflict (user_id, broker) do update set flex_token = excluded.flex_token, flex_query_id = excluded.flex_query_id, status = 'pending', error = null, updated_at = now()
     returning *`,
    [userId, token, queryId],
  );
  return runSync(connection as BrokerConnection, accounts);
}

export async function disconnectIbkr(userId: string) {
  // Portfolios and their trades stay; only the link (and the token) is removed.
  await q(`delete from public.broker_connections where user_id = $1 and broker = 'ibkr'`, [userId]);
}

export async function syncIbkr(userId: string) {
  const connection = await getIbkrConnection(userId);
  if (!connection) throw new HttpError(404, 'Interactive Brokers is not connected.');
  return runSync(connection);
}

/** Background job: sync every connection that hasn't been tried in the last few hours. */
export async function syncDueIbkr(report: (done: number, total: number, message: string) => void) {
  const due = await dueIbkrConnections();
  let done = 0;
  for (const connection of due) {
    report(done, due.length, 'Syncing Interactive Brokers…');
    await runSync(connection).catch(() => null);
    done += 1;
  }
  report(due.length, due.length, due.length ? 'Interactive Brokers synced' : 'Nothing to sync');
}

export async function dueIbkrConnections() {
  return q<BrokerConnection>(
    `select * from public.broker_connections where broker = 'ibkr' and (last_attempt_at is null or last_attempt_at < now() - ($1::int * interval '1 millisecond'))`,
    [SYNC_EVERY_MS],
  );
}

function runSync(connection: BrokerConnection, prefetched?: FlexAccount[]) {
  const existing = syncing.get(connection.id);
  if (existing) return existing;
  const job = (async () => {
    await q('update public.broker_connections set last_attempt_at = now() where id = $1', [connection.id]);
    try {
      const accounts = prefetched ?? parseFlexStatement(await fetchFlexStatement(connection.flex_token, connection.flex_query_id));
      const result: SyncResult = { accounts: 0, trades: 0, positions: 0, skipped: 0, warnings: [] };
      for (const account of accounts) {
        const synced = await syncAccount(connection, account);
        result.accounts += 1;
        result.trades += synced.trades;
        result.positions += synced.positions;
        result.skipped += account.skipped;
        result.warnings.push(...synced.warnings);
        if (!account.hasPositions) result.warnings.push(`Add the “Open Positions” section to your Flex Query so ${account.accountId} matches IBKR exactly.`);
      }
      const message = [
        `${result.accounts} account${result.accounts === 1 ? '' : 's'}`,
        `${result.positions} position${result.positions === 1 ? '' : 's'}`,
        `${result.trades} trade${result.trades === 1 ? '' : 's'}`,
        result.skipped ? `${result.skipped} non-USD, option or short rows skipped` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      await q(`update public.broker_connections set status = 'ok', error = $2, message = $3, last_synced_at = now(), updated_at = now() where id = $1`, [
        connection.id,
        result.warnings[0] ?? null,
        message,
      ]);
      return result;
    } catch (error) {
      const message = error instanceof FlexError ? error.message : `Sync failed: ${(error as Error).message}`;
      await q(`update public.broker_connections set status = 'error', error = $2, updated_at = now() where id = $1`, [connection.id, message.slice(0, 500)]).catch(() => {});
      throw new HttpError(502, message);
    } finally {
      syncing.delete(connection.id);
    }
  })();
  syncing.set(connection.id, job);
  return job;
}

async function portfolioFor(connection: BrokerConnection, accountId: string) {
  const linked = await q1<{ portfolio_id: string }>(
    `select a.portfolio_id from public.broker_accounts a join public.portfolios p on p.id = a.portfolio_id where a.connection_id = $1 and a.account_id = $2`,
    [connection.id, accountId],
  );
  if (linked) return linked.portfolio_id;
  return tx(async (db) => {
    const [portfolio] = await db.query<{ id: string }>(`insert into public.portfolios (user_id, name, benchmark, cash) values ($1, $2, 'SPY', 0) returning id`, [
      connection.user_id,
      `IBKR ${accountId}`,
    ]);
    await db.query(
      `insert into public.broker_accounts (connection_id, user_id, account_id, portfolio_id) values ($1, $2, $3, $4)
       on conflict (connection_id, account_id) do update set portfolio_id = excluded.portfolio_id`,
      [connection.id, connection.user_id, accountId, portfolio.id],
    );
    return portfolio.id;
  });
}

/**
 * Account cash in USD: each currency's ending balance converted at today's rate, so a non-USD base
 * currency is not read as dollars. Negative balances (margin loans) are kept: they reduce net value.
 */
export async function cashInUsd(account: Pick<FlexAccount, 'cashByCurrency' | 'baseCash' | 'baseCurrency'>): Promise<{ cash: number | null; warning: string | null }> {
  const balances = Object.entries(account.cashByCurrency);
  if (balances.length) {
    let total = 0;
    for (const [currency, amount] of balances) {
      if (!amount) continue;
      const rate = await usdPerUnit(currency);
      if (rate === null) return { cash: null, warning: `No exchange rate for ${currency}, so cash was not updated.` };
      total += amount * rate;
    }
    return { cash: total, warning: null };
  }
  if (account.baseCash === null) return { cash: null, warning: null };
  const base = account.baseCurrency ?? 'USD';
  const rate = await usdPerUnit(base);
  if (rate === null) return { cash: null, warning: `No exchange rate for ${base}, so cash was not updated.` };
  return {
    cash: account.baseCash * rate,
    warning: account.baseCurrency ? null : 'The Flex Query has no per-currency cash rows; its base-currency total was read as USD.',
  };
}

async function syncAccount(connection: BrokerConnection, account: FlexAccount) {
  const portfolioId = await portfolioFor(connection, account.accountId);
  const userId = connection.user_id;
  const today = todayInNewYork();
  const asOf = account.toDate && account.toDate < today ? account.toDate : today;
  const warnings: string[] = [];
  const { cash, warning } = await cashInUsd(account);
  if (warning) warnings.push(`${account.accountId}: ${warning}`);

  // Trades are stored as executed (in the shares of their day); readers restate them for later splits.
  const trades = account.trades;

  const synced = await tx(async (db) => {
    const seen = new Set<string>();
    for (const trade of trades) {
      const key = `ibkr:trade:${trade.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await db.query(
        `insert into public.transactions (portfolio_id, user_id, symbol, side, quantity, price, fees, traded_at, note, created_at, broker_execution_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8::date, 'Synced from IBKR', $9::timestamptz, $10)
         on conflict (portfolio_id, broker_execution_id) do update set
           symbol = excluded.symbol, side = excluded.side, quantity = excluded.quantity, price = excluded.price,
           fees = excluded.fees, traded_at = excluded.traded_at, created_at = excluded.created_at`,
        [portfolioId, userId, trade.symbol, trade.side, trade.quantity, trade.price, trade.fees, trade.tradedAt, trade.executedAt, key],
      );
    }
    return seen.size;
  });

  if (account.hasPositions) {
    // Keep IBKR's positions as a snapshot: the ledger derives its balancing rows from it when read
    // (see assembleLedger), so they always match the split adjustment. Rows stored by older syncs go.
    await tx(async (db) => {
      await db.query(`update public.broker_accounts set positions = $3::jsonb, positions_as_of = $4::date where connection_id = $1 and account_id = $2`, [
        connection.id,
        account.accountId,
        JSON.stringify(account.positions),
        asOf,
      ]);
      await db.query(`delete from public.transactions where portfolio_id = $1 and broker_execution_id like 'ibkr:balance:%'`, [portfolioId]);
    });
  }
  if (cash !== null) await q('update public.portfolios set cash = $2 where id = $1', [portfolioId, cash]);
  return { trades: synced, positions: account.positions.length, warnings };
}

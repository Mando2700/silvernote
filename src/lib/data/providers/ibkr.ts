import 'server-only';

import { XMLParser } from 'fast-xml-parser';

import { fetchText, ProviderError, RateLimiter, sleep } from '@/lib/data/http';

/**
 * Interactive Brokers Flex Web Service: a read-only reporting token plus the id of an Activity
 * Flex Query. No gateway process, no browser login, no 2FA — the token alone fetches statements.
 */

const SEND_URL = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest';
const GET_URL = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement';
// IBKR rejects requests without a User-Agent and throttles each token to about one request per second.
const HEADERS = { 'User-Agent': 'SilverNote/1.0' };
const limiter = new RateLimiter(1100, 1);

export class FlexError extends ProviderError {
  constructor(
    public code: string,
    message: string,
  ) {
    super('ibkr', 0, message);
    // Shown to the user as-is, without the "ibkr:" provider prefix.
    this.message = message;
  }
}

// Codes IBKR documents for the Flex Web Service that mean "the user has to fix something".
const CREDENTIAL_CODES = new Set(['1012', '1014', '1015', '1016']);
const RETRY_CODES = new Set(['1001', '1004', '1005', '1006', '1007', '1008', '1009', '1018', '1019', '1021']);

export function isCredentialError(error: unknown) {
  return error instanceof FlexError && CREDENTIAL_CODES.has(error.code);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => ['FlexStatement', 'Trade', 'OpenPosition', 'CashReportCurrency', 'AccountInformation'].includes(name),
});

type Attrs = Record<string, string | undefined>;

function explain(code: string, message: string) {
  if (code === '1012') return 'The Flex token has expired. Generate a new one in IBKR and paste it here.';
  if (code === '1015') return 'IBKR does not recognise this Flex token. Copy it again from Flex Web Service Configuration.';
  if (code === '1014') return 'IBKR does not recognise this query id. Copy the id shown next to your Activity Flex Query.';
  if (code === '1016') return 'This Flex token is not allowed to run that query. Create the query and token under the same IBKR login.';
  return `IBKR: ${message || `error ${code}`}`;
}

function responseStatus(xml: string) {
  const doc = parser.parse(xml) as { FlexStatementResponse?: Attrs & { Status?: string; ReferenceCode?: string; Url?: string; ErrorCode?: string; ErrorMessage?: string } };
  return doc.FlexStatementResponse ?? null;
}

/** Run the query and wait for IBKR to generate the statement (usually a few seconds). */
export async function fetchFlexStatement(token: string, queryId: string): Promise<string> {
  const send = await limiter.run(() => fetchText(`${SEND_URL}?${new URLSearchParams({ t: token, q: queryId, v: '3' })}`, { provider: 'ibkr', headers: HEADERS, timeoutMs: 30_000 }));
  const sent = responseStatus(send);
  if (!sent) throw new FlexError('0', 'IBKR returned an unexpected response.');
  if (sent.Status !== 'Success' || !sent.ReferenceCode) {
    const code = String(sent.ErrorCode ?? '0');
    throw new FlexError(code, explain(code, String(sent.ErrorMessage ?? '')));
  }
  const url = typeof sent.Url === 'string' && sent.Url.startsWith('https://') ? sent.Url : GET_URL;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(attempt === 0 ? 2_000 : Math.min(15_000, 2_000 * 1.5 ** attempt));
    const body = await limiter.run(() => fetchText(`${url}?${new URLSearchParams({ t: token, q: sent.ReferenceCode as string, v: '3' })}`, { provider: 'ibkr', headers: HEADERS, timeoutMs: 60_000 }));
    if (body.includes('<FlexQueryResponse')) return body;
    const status = responseStatus(body);
    const code = String(status?.ErrorCode ?? '0');
    if (!RETRY_CODES.has(code)) throw new FlexError(code, explain(code, String(status?.ErrorMessage ?? '')));
  }
  throw new FlexError('1019', 'IBKR is still generating the statement. It will be picked up on the next sync.');
}

// ─── Statement parsing (pure) ───────────────────────────────────────────────

export type FlexTrade = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fees: number;
  tradedAt: string;
  executedAt: string;
};
export type FlexPosition = { symbol: string; quantity: number; costBasis: number; costPrice: number; markPrice: number };
export type FlexAccount = {
  accountId: string;
  fromDate: string | null;
  toDate: string | null;
  trades: FlexTrade[];
  positions: FlexPosition[];
  /** Ending cash per currency, in that currency (negative for a margin loan). */
  cashByCurrency: Record<string, number>;
  /** Ending cash across currencies in the account's base currency (`baseCurrency`, when the statement says). */
  baseCash: number | null;
  baseCurrency: string | null;
  /** False when the query has no Open Positions section, so positions can't be reconciled. */
  hasPositions: boolean;
  skipped: number;
};

const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

/** Order of a `nn/nn/yyyy` date: IBKR offers both MM/dd/yyyy and dd/MM/yyyy. */
export type SlashOrder = 'mdy' | 'dmy';

const SLASH_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function firstToken(value: string) {
  return value.trim().split(/[;,\s]/)[0];
}

function validDate(iso: string) {
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
}

/** IBKR lets users pick the date format (the default is yyyyMMdd). Slash dates need their order (see `detectSlashOrder`). */
export function parseFlexDate(value: string | undefined, order: SlashOrder = 'mdy'): string | null {
  if (!value) return null;
  const text = firstToken(value);
  let match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text) ?? /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text);
  if (match) return validDate(`${match[1]}-${match[2]}-${match[3]}`);
  match = SLASH_DATE.exec(text);
  if (match) return validDate(order === 'mdy' ? `${match[3]}-${match[1]}-${match[2]}` : `${match[3]}-${match[2]}-${match[1]}`);
  match = /^(\d{2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text);
  if (match && MONTHS[match[2].toUpperCase()]) return validDate(`${match[3].length === 2 ? `20${match[3]}` : match[3]}-${MONTHS[match[2].toUpperCase()]}-${match[1]}`);
  return null;
}

/**
 * Decide whether a statement's `nn/nn/yyyy` dates are month-first or day-first. Any field above 12
 * settles it; otherwise the order under which every trade falls inside the statement period wins.
 * Returns null when there are no slash dates, and throws when the dates can't be read either way.
 */
export function detectSlashOrder(period: { from?: string; to?: string }, dates: Array<string | undefined>): SlashOrder | null {
  const slash = [period.from, period.to, ...dates].filter((value): value is string => Boolean(value && SLASH_DATE.test(firstToken(value))));
  if (!slash.length) return null;
  let monthFirst = false;
  let dayFirst = false;
  for (const value of slash) {
    const [, a, b] = SLASH_DATE.exec(firstToken(value)) as RegExpExecArray;
    if (Number(a) > 12) dayFirst = true;
    if (Number(b) > 12) monthFirst = true;
  }
  if (monthFirst && !dayFirst) return 'mdy';
  if (dayFirst && !monthFirst) return 'dmy';
  if (!monthFirst && !dayFirst) {
    const fits = (order: SlashOrder) => {
      const from = parseFlexDate(period.from, order);
      const to = parseFlexDate(period.to, order);
      if (!from || !to || from > to) return false;
      return dates.every((value) => {
        const date = parseFlexDate(value, order);
        return !value || !date || (date >= from && date <= to);
      });
    };
    const mdy = fits('mdy');
    const dmy = fits('dmy');
    if (mdy !== dmy) return mdy ? 'mdy' : 'dmy';
  }
  throw new FlexError('0', 'The Flex Query uses a date format that can be read as either month/day or day/month. Set its date format to yyyyMMdd in IBKR (Flex Query → Delivery Configuration) and sync again.');
}

function parseFlexTime(value: string | undefined) {
  const part = value?.trim().split(/[;,\s]+/)[1]?.replace(/:/g, '') ?? '';
  return /^\d{6}$/.test(part) ? `${part.slice(0, 2)}:${part.slice(2, 4)}:${part.slice(4, 6)}` : '00:00:00';
}

function num(value: string | undefined) {
  const parsed = Number((value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** "BRK B" → "BRK.B"; anything else that doesn't look like a US ticker is skipped. */
export function toSymbol(value: string | undefined) {
  const symbol = (value ?? '').trim().toUpperCase().replace(/\s+/g, '.');
  return /^[A-Z0-9.\-]{1,16}$/.test(symbol) ? symbol : null;
}

// Only US-dollar stocks and ETFs map onto SilverNote's universe and price data.
function supported(row: Attrs) {
  return (row.assetCategory ?? 'STK') === 'STK' && (row.currency ?? 'USD') === 'USD';
}

function list<T>(value: T[] | T | undefined | ''): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseFlexStatement(xml: string): FlexAccount[] {
  const doc = parser.parse(xml) as {
    FlexQueryResponse?: {
      FlexStatements?: {
        FlexStatement?: Array<
          Attrs & { Trades?: { Trade?: Attrs[] }; OpenPositions?: { OpenPosition?: Attrs[] }; CashReport?: { CashReportCurrency?: Attrs[] }; AccountInformation?: Attrs[] }
        >;
      };
    };
  };
  const statements = list(doc.FlexQueryResponse?.FlexStatements?.FlexStatement);
  if (!doc.FlexQueryResponse) throw new FlexError('0', 'IBKR returned something that is not a Flex statement.');
  const accounts = new Map<string, FlexAccount>();

  for (const statement of statements) {
    const accountId = statement.accountId ?? 'IBKR';
    const account =
      accounts.get(accountId) ?? { accountId, fromDate: null, toDate: null, trades: [], positions: [], cashByCurrency: {}, baseCash: null, baseCurrency: null, hasPositions: false, skipped: 0 };
    const tradeRows = list(statement.Trades?.Trade);
    const order = detectSlashOrder({ from: statement.fromDate, to: statement.toDate }, tradeRows.flatMap((row) => [row.tradeDate, row.dateTime])) ?? 'mdy';
    const from = parseFlexDate(statement.fromDate, order);
    const to = parseFlexDate(statement.toDate, order);
    if (from && (!account.fromDate || from < account.fromDate)) account.fromDate = from;
    if (to && (!account.toDate || to > account.toDate)) account.toDate = to;

    for (const row of tradeRows) {
      if (row.levelOfDetail && row.levelOfDetail !== 'EXECUTION') continue;
      // Currency conversions aren't holdings; they're expected, not skipped.
      if (row.assetCategory === 'CASH') continue;
      const id = row.tradeID || row.transactionID || row.ibExecID;
      const buySell = (row.buySell ?? '').toUpperCase();
      const symbol = toSymbol(row.symbol);
      const tradedAt = parseFlexDate(row.tradeDate, order) ?? parseFlexDate(row.dateTime, order);
      const quantity = Math.abs(num(row.quantity));
      const openClose = (row.openCloseIndicator ?? '').toUpperCase();
      // Short sales and covers can't be represented by long-only average-cost bookkeeping.
      const short = (buySell === 'SELL' && openClose.includes('O')) || (buySell === 'BUY' && openClose.includes('C'));
      if (!id || !symbol || !tradedAt || !quantity || !supported(row) || buySell.includes('CA.') || short || (buySell !== 'BUY' && buySell !== 'SELL')) {
        account.skipped += 1;
        continue;
      }
      account.trades.push({
        id,
        symbol,
        side: buySell === 'BUY' ? 'buy' : 'sell',
        quantity,
        price: Math.max(0, num(row.tradePrice)),
        fees: Math.abs(num(row.ibCommission)) + Math.abs(num(row.taxes)),
        tradedAt,
        executedAt: `${tradedAt}T${parseFlexTime(row.dateTime)}Z`,
      });
    }

    if (statement.OpenPositions !== undefined) account.hasPositions = true;
    for (const row of list(statement.OpenPositions?.OpenPosition)) {
      if (row.levelOfDetail && row.levelOfDetail !== 'SUMMARY') continue;
      const symbol = toSymbol(row.symbol);
      const quantity = num(row.position);
      if (!symbol || !supported(row) || quantity <= 0) {
        if (quantity !== 0) account.skipped += 1;
        continue;
      }
      account.positions.push({ symbol, quantity, costBasis: num(row.costBasisMoney), costPrice: num(row.costBasisPrice), markPrice: num(row.markPrice) });
    }

    const cashRows = list(statement.CashReport?.CashReportCurrency);
    const base = cashRows.find((row) => row.currency === 'BASE_SUMMARY');
    if (base?.endingCash !== undefined) account.baseCash = num(base.endingCash);
    for (const row of cashRows) {
      if (!row.currency || row.currency === 'BASE_SUMMARY' || row.endingCash === undefined) continue;
      if (row.levelOfDetail && row.levelOfDetail !== 'Currency') continue;
      account.cashByCurrency[row.currency.toUpperCase()] = num(row.endingCash);
    }
    const info = list(statement.AccountInformation)[0];
    if (info?.currency) account.baseCurrency = info.currency.toUpperCase();
    accounts.set(accountId, account);
  }
  for (const account of accounts.values()) account.trades.sort((a, b) => a.executedAt.localeCompare(b.executedAt));
  return [...accounts.values()];
}

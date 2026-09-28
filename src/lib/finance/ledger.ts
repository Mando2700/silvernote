/**
 * Shared trade-ledger rules: one replay order for every consumer (average-cost holdings, tax lots,
 * performance), oversell detection, and stock-split detection against split-adjusted prices.
 * Pure functions: no I/O. Dates are ISO `YYYY-MM-DD` strings.
 */

/**
 * `trade` is a real execution. `opening` and `removal` are synthetic balancing rows (e.g. from a
 * broker sync) that bring the share count in line with the broker: an opening buys shares whose
 * real purchase predates the ledger, a removal takes shares out without a sale (transfer out,
 * corporate action), so neither is a taxable event of its own.
 */
export type TradeKind = 'trade' | 'opening' | 'removal';

export type LedgerTrade = {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  traded_at: string;
  /** Execution (or entry) time; orders trades within a day. */
  created_at?: Date | string | null;
  kind?: TradeKind;
};

const EPSILON = 1e-9;

function timeOf(value: Date | string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Replay order: trade date, then execution time when both trades have one, then buys before sells. */
export function compareTrades(a: LedgerTrade, b: LedgerTrade) {
  const byDate = a.traded_at.localeCompare(b.traded_at);
  if (byDate) return byDate;
  const ta = timeOf(a.created_at);
  const tb = timeOf(b.created_at);
  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  if (a.side !== b.side) return a.side === 'buy' ? -1 : 1;
  return 0;
}

export function sortTrades<T extends LedgerTrade>(trades: T[]) {
  return [...trades].sort(compareTrades);
}

export type Oversell<T> = { trade: T; held: number };

/** Every sell (in replay order) that sells more shares than were held at that point. */
export function findOversells<T extends LedgerTrade>(trades: T[]): Array<Oversell<T>> {
  const held = new Map<string, number>();
  const found: Array<Oversell<T>> = [];
  for (const trade of sortTrades(trades)) {
    const current = held.get(trade.symbol) ?? 0;
    if (trade.side === 'buy') {
      held.set(trade.symbol, current + trade.quantity);
      continue;
    }
    if (trade.quantity > current + 1e-6) found.push({ trade, held: Math.max(0, current) });
    held.set(trade.symbol, Math.max(0, current - trade.quantity));
  }
  return found;
}

/**
 * The first oversell that `after` introduces compared with `before` (identified by `idOf`), or null.
 * Oversells already in the ledger (e.g. imported history) don't block unrelated edits.
 */
export function newOversell<T extends LedgerTrade>(before: T[], after: T[], idOf: (trade: T) => string) {
  const existing = new Set(findOversells(before).map((entry) => idOf(entry.trade)));
  return findOversells(after).find((entry) => !existing.has(idOf(entry.trade))) ?? null;
}

// ─── Stock splits ───────────────────────────────────────────────────────────

/** A share split effective on `date` (the ex-date): one old share became `factor` new shares. */
export type Split = { date: string; factor: number };

export type DatedClose = { date: string; close: number };

/** Ratios this close to 1 are spin-off or distribution adjustments some feeds list as splits; share counts don't change. */
export function isRealSplit(split: Split) {
  return split.factor >= 1.25 || split.factor <= 0.8;
}

function closeOn(closes: DatedClose[] | undefined, date: string) {
  if (!closes?.length) return null;
  let low = 0;
  let high = closes.length - 1;
  let found: DatedClose | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (closes[mid].date <= date) {
      found = closes[mid];
      low = mid + 1;
    } else high = mid - 1;
  }
  // No usable bar within a week of the trade (not listed yet, or a gap in history).
  if (!found || Date.parse(`${date}T00:00:00Z`) - Date.parse(`${found.date}T00:00:00Z`) > 7 * 86_400_000) return null;
  return found.close > 0 ? found.close : null;
}

/**
 * Share multiplier that restates a trade in today's (split-adjusted) units, given the symbol's splits.
 *
 * Only splits on or after the trade day matter. For each, the trade is either in the units of its day
 * (entered before the split, or copied from a pre-split confirmation) or already in adjusted units
 * (backfilled later from an adjusted chart). The trade price decides: it sits near the adjusted close
 * times the outstanding split factor when raw, and near the adjusted close when already adjusted. With no
 * price history to compare, a trade entered before the split happened is raw by definition.
 */
export function splitMultiplier(
  trade: { price: number; traded_at: string; created_at?: Date | string | null },
  splits: Split[] | undefined,
  closes: DatedClose[] | undefined,
) {
  const later = (splits ?? []).filter((split) => isRealSplit(split) && split.date > trade.traded_at);
  if (!later.length) return 1;
  const factor = later.reduce((product, split) => product * split.factor, 1);
  const close = closeOn(closes, trade.traded_at);
  if (close && trade.price > 0) {
    const ratio = trade.price / close;
    const asRaw = Math.abs(Math.log(ratio / factor));
    const asAdjusted = Math.abs(Math.log(ratio));
    // Decide only when one reading is clearly better; otherwise fall through to entry time.
    if (Math.min(asRaw, asAdjusted) < Math.log(1.6) && Math.abs(asRaw - asAdjusted) > Math.log(1.2)) return asRaw < asAdjusted ? factor : 1;
  }
  const entered = timeOf(trade.created_at);
  if (entered === null) return 1;
  const enteredDay = new Date(entered).toISOString().slice(0, 10);
  return later.filter((split) => split.date > enteredDay).reduce((product, split) => product * split.factor, 1);
}

const CLEAN_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50];

/**
 * Fallback when the split history can't be loaded: a trade priced a clean split ratio away from the
 * split-adjusted close before, on and after its day predates a split. Requiring all three keeps a crash
 * or squeeze day (trade near the prior close, far from that day's close) from reading as a split.
 */
export function inferSplitMultiplier(trade: { price: number; traded_at: string }, closes: DatedClose[] | undefined) {
  if (!closes?.length || !(trade.price > 0)) return 1;
  let index = -1;
  let low = 0;
  let high = closes.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (closes[mid].date <= trade.traded_at) {
      index = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  if (index < 0 || Date.parse(`${trade.traded_at}T00:00:00Z`) - Date.parse(`${closes[index].date}T00:00:00Z`) > 7 * 86_400_000) return 1;
  const ratios = closes
    .slice(Math.max(0, index - 1), index + 2)
    .filter((bar) => bar.close > 0)
    .map((bar) => trade.price / bar.close);
  if (ratios.length < 2) return 1;
  const up = ratios[0] >= 1;
  if (ratios.some((ratio) => ratio >= 1 !== up)) return 1;
  const factor = CLEAN_RATIOS.find((candidate) => ratios.every((ratio) => Math.abs((up ? ratio : 1 / ratio) / candidate - 1) < 0.08));
  return factor ? (up ? factor : 1 / factor) : 1;
}

/**
 * Restate trades that predate a split in today's units: shares × factor, price ÷ factor (cost unchanged).
 * `splitsFor` returns null when a symbol's split history is unavailable (then prices decide).
 */
export function adjustForSplits<T extends { symbol: string; quantity: number; price: number; traded_at: string; created_at?: Date | string | null; kind?: TradeKind }>(
  trades: T[],
  splitsFor: (symbol: string) => Split[] | null | undefined,
  closesFor: (symbol: string) => DatedClose[] | undefined,
): Array<T & { split_factor: number }> {
  return trades.map((trade) => {
    const splits = splitsFor(trade.symbol);
    // Balancing rows are booked in today's units already.
    const factor =
      (trade.kind ?? 'trade') !== 'trade'
        ? 1
        : splits === null
          ? inferSplitMultiplier(trade, closesFor(trade.symbol))
          : splitMultiplier(trade, splits, closesFor(trade.symbol));
    if (Math.abs(factor - 1) < EPSILON) return { ...trade, split_factor: 1 };
    return { ...trade, quantity: trade.quantity * factor, price: trade.price / factor, split_factor: factor };
  });
}

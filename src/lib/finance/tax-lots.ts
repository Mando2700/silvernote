/**
 * Lot-level tax accounting for a trade ledger (US rules): lot relief by FIFO, LIFO or HIFO,
 * short- vs long-term holding periods, wash sales, and harvesting ideas for open lots.
 *
 * Pure functions: no I/O. Dates are ISO `YYYY-MM-DD` strings.
 */

import { sortTrades, type TradeKind } from '@/lib/finance/ledger';

export type LotMethod = 'fifo' | 'lifo' | 'hifo';
export type Term = 'short' | 'long';

export type TaxTransaction = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fees: number;
  traded_at: string;
  created_at?: Date | string | null;
  /** Synthetic rows: an `opening` lot's real purchase date is unknown; a `removal` is not a sale. */
  kind?: TradeKind;
};

export type OpenLot = {
  /** Unique per lot (a buy can split into several lots after wash-sale adjustments). */
  id: string;
  buyId: string;
  symbol: string;
  /** Actual purchase date. */
  purchased: string;
  /** Holding period start: the purchase date, moved earlier when a washed lot's holding period carries over. */
  acquired: string;
  quantity: number;
  /** Per-share basis including buy fees and any disallowed wash-sale loss. */
  costPerShare: number;
  /** Per-share disallowed loss added to this lot's basis. */
  washAdjustmentPerShare: number;
  /** Opening balance whose real purchase date predates the ledger: `acquired` is only an upper bound. */
  estimated: boolean;
};

export type Disposal = {
  saleId: string;
  buyId: string;
  symbol: string;
  acquired: string;
  sold: string;
  quantity: number;
  /** Sale proceeds net of the sale's fees (pro rata). */
  proceeds: number;
  cost: number;
  /** Proceeds − cost, before any wash-sale disallowance. */
  gain: number;
  /** Loss disallowed under the wash-sale rule (≥ 0); it moves into the replacement shares' basis. */
  washDisallowed: number;
  /** Reportable gain: gain + washDisallowed. */
  reportable: number;
  term: Term;
  holdingDays: number;
  /** Relieved from an opening balance: the acquisition date is unknown (on or before `acquired`). */
  estimated: boolean;
};

export type WashSaleEvent = {
  saleId: string;
  symbol: string;
  sold: string;
  sharesWashed: number;
  disallowed: number;
  replacements: Array<{ buyId: string; purchased: string; shares: number }>;
};

/** A sell (or removal) for more shares than the open lots held: the excess is not in `disposals`. */
export type UnmatchedSale = { saleId: string; symbol: string; sold: string; shares: number };

export type LedgerResult = {
  openLots: OpenLot[];
  disposals: Disposal[];
  washSales: WashSaleEvent[];
  unmatched: UnmatchedSale[];
};

const DAY_MS = 86_400_000;
const EPSILON = 1e-9;

export function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** First date on which a sale is long-term: the day after the one-year anniversary of `acquired`. */
export function longTermDate(acquired: string) {
  const [year, month, day] = acquired.split('-').map(Number);
  // A Feb 29 purchase has its anniversary on Feb 28.
  const anniversary = new Date(Date.UTC(year + 1, month - 1, Math.min(day, daysInMonth(year + 1, month))));
  return addDays(anniversary.toISOString().slice(0, 10), 1);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function termFor(acquired: string, sold: string): Term {
  return sold >= longTermDate(acquired) ? 'long' : 'short';
}

export function orderLots<T extends Pick<OpenLot, 'id' | 'purchased' | 'costPerShare'>>(lots: T[], method: LotMethod) {
  const sorted = [...lots];
  if (method === 'fifo') sorted.sort((a, b) => a.purchased.localeCompare(b.purchased) || a.id.localeCompare(b.id));
  else if (method === 'lifo') sorted.sort((a, b) => b.purchased.localeCompare(a.purchased) || b.id.localeCompare(a.id));
  else sorted.sort((a, b) => b.costPerShare - a.costPerShare || a.purchased.localeCompare(b.purchased));
  return sorted;
}

type Pending = { shares: number; perShare: number; carryDays: number };

/**
 * Replays the ledger lot by lot.
 *
 * Wash sales: a sale at a loss is washed to the extent the same ticker was bought within 30 days
 * before or after it (shares still held from before the sale, or bought after it). The disallowed
 * loss is added to the replacement shares' basis and the washed shares' holding period carries over.
 * Each replacement share absorbs at most one washed share. Only this ledger is checked, so trades in
 * other accounts (including IRAs) are not.
 */
export function processLedger(transactions: TaxTransaction[], method: LotMethod = 'fifo'): LedgerResult {
  // The same replay order as the holdings: date, then execution time, then buys before sells.
  const sorted = sortTrades(transactions);
  const lots = new Map<string, OpenLot[]>();
  const disposals: Disposal[] = [];
  const washSales: WashSaleEvent[] = [];
  const unmatched: UnmatchedSale[] = [];
  /** Shares of each future buy already claimed as wash-sale replacements. */
  const claimedFuture = new Map<string, number>();
  const pending = new Map<string, Pending[]>();
  /** Lot ids that already absorbed a washed loss (a replacement share is used once). */
  const usedAsReplacement = new Set<string>();
  let lotCounter = 0;
  const nextLotId = (buyId: string) => `${buyId}:${(lotCounter += 1)}`;

  for (const [index, tx] of sorted.entries()) {
    const symbolLots = lots.get(tx.symbol) ?? [];
    lots.set(tx.symbol, symbolLots);

    if (tx.side === 'buy') {
      if (tx.quantity <= EPSILON) continue;
      const basePerShare = (tx.quantity * tx.price + tx.fees) / tx.quantity;
      const estimated = tx.kind === 'opening';
      let remaining = tx.quantity;
      for (const adjustment of pending.get(tx.id) ?? []) {
        const shares = Math.min(adjustment.shares, remaining);
        if (shares <= EPSILON) continue;
        const id = nextLotId(tx.id);
        symbolLots.push({
          id,
          buyId: tx.id,
          symbol: tx.symbol,
          purchased: tx.traded_at,
          acquired: addDays(tx.traded_at, -adjustment.carryDays),
          quantity: shares,
          costPerShare: basePerShare + adjustment.perShare,
          washAdjustmentPerShare: adjustment.perShare,
          estimated,
        });
        usedAsReplacement.add(id);
        remaining -= shares;
      }
      if (remaining > EPSILON) {
        symbolLots.push({ id: nextLotId(tx.id), buyId: tx.id, symbol: tx.symbol, purchased: tx.traded_at, acquired: tx.traded_at, quantity: remaining, costPerShare: basePerShare, washAdjustmentPerShare: 0, estimated });
      }
      continue;
    }

    // Removal: shares leave without a sale (transfer out, corporate action). Relieve lots, realize nothing.
    if (tx.kind === 'removal') {
      let toRemove = tx.quantity;
      for (const lot of orderLots(symbolLots, method)) {
        if (toRemove <= EPSILON) break;
        const shares = Math.min(lot.quantity, toRemove);
        lot.quantity -= shares;
        toRemove -= shares;
      }
      for (let i = symbolLots.length - 1; i >= 0; i -= 1) if (symbolLots[i].quantity <= EPSILON) symbolLots.splice(i, 1);
      if (toRemove > 1e-6) unmatched.push({ saleId: tx.id, symbol: tx.symbol, sold: tx.traded_at, shares: toRemove });
      continue;
    }

    // Sell: relieve lots in method order.
    let toSell = tx.quantity;
    const saleDisposals: Disposal[] = [];
    for (const lot of orderLots(symbolLots, method)) {
      if (toSell <= EPSILON) break;
      const shares = Math.min(lot.quantity, toSell);
      const proceeds = shares * tx.price - (tx.fees * shares) / tx.quantity;
      const cost = shares * lot.costPerShare;
      saleDisposals.push({
        saleId: tx.id,
        buyId: lot.buyId,
        symbol: tx.symbol,
        acquired: lot.acquired,
        sold: tx.traded_at,
        quantity: shares,
        proceeds,
        cost,
        gain: proceeds - cost,
        washDisallowed: 0,
        reportable: proceeds - cost,
        term: termFor(lot.acquired, tx.traded_at),
        holdingDays: daysBetween(lot.acquired, tx.traded_at),
        estimated: lot.estimated,
      });
      lot.quantity -= shares;
      toSell -= shares;
    }
    if (toSell > 1e-6) unmatched.push({ saleId: tx.id, symbol: tx.symbol, sold: tx.traded_at, shares: toSell });
    for (let i = symbolLots.length - 1; i >= 0; i -= 1) if (symbolLots[i].quantity <= EPSILON) symbolLots.splice(i, 1);

    // Wash-sale check for each losing disposal.
    const windowStart = addDays(tx.traded_at, -30);
    const windowEnd = addDays(tx.traded_at, 30);
    const event: WashSaleEvent = { saleId: tx.id, symbol: tx.symbol, sold: tx.traded_at, sharesWashed: 0, disallowed: 0, replacements: [] };
    for (const disposal of saleDisposals) {
      if (disposal.gain >= -EPSILON) continue;
      const lossPerShare = -disposal.gain / disposal.quantity;
      let unmatched = disposal.quantity;

      // Replacement shares bought in the 30 days before the sale and still held. Unsold shares
      // from the same purchase as the losing shares are not replacements (Treas. Reg. §1.1091-1(f)).
      const priorLots = symbolLots
        // Opening balances were bought before the ledger starts, so they are never recent purchases.
        .filter((lot) => !lot.estimated && lot.purchased >= windowStart && lot.purchased <= tx.traded_at && lot.buyId !== disposal.buyId && !usedAsReplacement.has(lot.id))
        .sort((a, b) => a.purchased.localeCompare(b.purchased));
      for (const lot of priorLots) {
        if (unmatched <= EPSILON) break;
        const shares = Math.min(lot.quantity, unmatched);
        let target = lot;
        if (shares < lot.quantity - EPSILON) {
          target = { ...lot, id: nextLotId(lot.buyId), quantity: shares };
          lot.quantity -= shares;
          symbolLots.push(target);
        }
        target.costPerShare += lossPerShare;
        target.washAdjustmentPerShare += lossPerShare;
        target.acquired = addDays(target.purchased, -disposal.holdingDays);
        usedAsReplacement.add(target.id);
        unmatched -= shares;
        event.replacements.push({ buyId: target.buyId, purchased: target.purchased, shares });
      }

      // Replacement shares bought in the 30 days after the sale.
      for (const future of sorted.slice(index + 1)) {
        if (unmatched <= EPSILON || future.traded_at > windowEnd) break;
        if (future.side !== 'buy' || future.symbol !== tx.symbol || future.kind === 'opening') continue;
        const available = future.quantity - (claimedFuture.get(future.id) ?? 0);
        if (available <= EPSILON) continue;
        const shares = Math.min(available, unmatched);
        claimedFuture.set(future.id, (claimedFuture.get(future.id) ?? 0) + shares);
        const list = pending.get(future.id) ?? [];
        list.push({ shares, perShare: lossPerShare, carryDays: disposal.holdingDays });
        pending.set(future.id, list);
        unmatched -= shares;
        event.replacements.push({ buyId: future.id, purchased: future.traded_at, shares });
      }

      const washed = disposal.quantity - unmatched;
      if (washed > EPSILON) {
        disposal.washDisallowed = washed * lossPerShare;
        disposal.reportable = disposal.gain + disposal.washDisallowed;
        event.sharesWashed += washed;
        event.disallowed += disposal.washDisallowed;
      }
    }
    if (event.sharesWashed > EPSILON) washSales.push(event);
    disposals.push(...saleDisposals);
  }

  const openLots = [...lots.values()].flat().filter((lot) => lot.quantity > EPSILON);
  openLots.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.purchased.localeCompare(b.purchased));
  return { openLots, disposals, washSales, unmatched };
}

export type RealizedSummary = {
  year: number;
  shortGains: number;
  shortLosses: number;
  longGains: number;
  longLosses: number;
  washDisallowed: number;
  netShort: number;
  netLong: number;
  net: number;
  proceeds: number;
};

/** Realized results per tax year, on reportable (wash-adjusted) amounts. */
export function summarizeRealized(disposals: Disposal[]): RealizedSummary[] {
  const byYear = new Map<number, RealizedSummary>();
  for (const disposal of disposals) {
    const year = Number(disposal.sold.slice(0, 4));
    const row = byYear.get(year) ?? { year, shortGains: 0, shortLosses: 0, longGains: 0, longLosses: 0, washDisallowed: 0, netShort: 0, netLong: 0, net: 0, proceeds: 0 };
    const amount = disposal.reportable;
    if (disposal.term === 'short') {
      if (amount >= 0) row.shortGains += amount;
      else row.shortLosses += amount;
      row.netShort += amount;
    } else {
      if (amount >= 0) row.longGains += amount;
      else row.longLosses += amount;
      row.netLong += amount;
    }
    row.washDisallowed += disposal.washDisallowed;
    row.net += amount;
    row.proceeds += disposal.proceeds;
    byYear.set(year, row);
  }
  return [...byYear.values()].sort((a, b) => b.year - a.year);
}

export type TaxRates = { shortTerm: number; longTerm: number };

/** Capital loss carried into a year, kept by character (both ≤ 0). */
export type Carryover = { short: number; long: number };

const ORDINARY_OFFSET_LIMIT = 3000;

/**
 * Estimated federal tax on one year's net result. A loss carried in from earlier years joins the
 * matching term first. Losses net within each term, then across terms; a net capital loss offsets up
 * to $3,000 of ordinary income (valued at the short-term rate), short-term losses first, and the rest
 * carries forward keeping its character.
 */
export function estimateTax(summary: Pick<RealizedSummary, 'netShort' | 'netLong'>, rates: TaxRates, carryIn: Carryover = { short: 0, long: 0 }) {
  let short = summary.netShort + carryIn.short;
  let long = summary.netLong + carryIn.long;
  if (short < 0 && long > 0) {
    const offset = Math.min(-short, long);
    short += offset;
    long -= offset;
  } else if (long < 0 && short > 0) {
    const offset = Math.min(-long, short);
    long += offset;
    short -= offset;
  }
  const shortLoss = Math.min(0, short);
  const longLoss = Math.min(0, long);
  const fromShort = Math.min(-shortLoss, ORDINARY_OFFSET_LIMIT);
  const fromLong = Math.min(-longLoss, ORDINARY_OFFSET_LIMIT - fromShort);
  const deductible = -(fromShort + fromLong);
  const tax = Math.max(0, short) * rates.shortTerm + Math.max(0, long) * rates.longTerm + deductible * rates.shortTerm;
  const carryOut: Carryover = { short: shortLoss + fromShort, long: longLoss + fromLong };
  return { tax, carryforward: carryOut.short + carryOut.long, carryOut };
}

/** Tax estimates for every year in order, carrying unused losses forward from one year to the next. */
export function estimateTaxByYear<T extends Pick<RealizedSummary, 'year' | 'netShort' | 'netLong'>>(summaries: T[], rates: TaxRates) {
  const ascending = [...summaries].sort((a, b) => a.year - b.year);
  let carry: Carryover = { short: 0, long: 0 };
  const results = new Map<number, T & { tax: number; carryforward: number; carryIn: number }>();
  let previousYear: number | null = null;
  for (const summary of ascending) {
    // Years with no sales still apply the $3,000 offset to a carried loss.
    for (let year = (previousYear ?? summary.year) + 1; year < summary.year && (carry.short < 0 || carry.long < 0); year += 1) {
      carry = estimateTax({ netShort: 0, netLong: 0 }, rates, carry).carryOut;
    }
    const carryIn = carry.short + carry.long;
    const estimate = estimateTax(summary, rates, carry);
    results.set(summary.year, { ...summary, tax: estimate.tax, carryforward: estimate.carryforward, carryIn });
    carry = estimate.carryOut;
    previousYear = summary.year;
  }
  return summaries.map((summary) => results.get(summary.year) as T & { tax: number; carryforward: number; carryIn: number });
}

export type LotView = OpenLot & {
  price: number | null;
  marketValue: number | null;
  unrealized: number | null;
  term: Term;
  longTermOn: string;
  daysToLongTerm: number;
};

export function valueLots(openLots: OpenLot[], prices: Record<string, number | null | undefined>, today: string): LotView[] {
  return openLots.map((lot) => {
    const price = prices[lot.symbol] ?? null;
    const marketValue = price !== null ? price * lot.quantity : null;
    const longTermOn = longTermDate(lot.acquired);
    return {
      ...lot,
      price,
      marketValue,
      unrealized: marketValue !== null ? marketValue - lot.costPerShare * lot.quantity : null,
      term: termFor(lot.acquired, today),
      longTermOn,
      daysToLongTerm: Math.max(0, daysBetween(today, longTermOn)),
    };
  });
}

export type HarvestIdea = {
  symbol: string;
  lots: Array<{ id: string; purchased: string; quantity: number; unrealized: number; term: Term }>;
  shares: number;
  loss: number;
  shortLoss: number;
  longLoss: number;
  estimatedSavings: number;
  /** Shares bought in the last 30 days that would be kept (they would wash the loss). */
  washRiskShares: number;
  /** Earliest date the loss lots can be sold without washing against recent buys. */
  sellAfter: string | null;
  /** Don't buy the same ticker back before this date. */
  rebuyAfter: string;
};

export type WaitIdea = {
  symbol: string;
  lotId: string;
  purchased: string;
  quantity: number;
  unrealized: number;
  longTermOn: string;
  daysToLongTerm: number;
  /** Tax saved by waiting for the long-term rate. */
  savings: number;
};

/**
 * Harvesting candidates per ticker, respecting the account's lot method: a sale relieves lots in that
 * order, so the idea is the number of shares (a prefix of the relief order) whose sale realizes the
 * largest net loss. With HIFO that is usually every losing lot; with FIFO it may be none, since the
 * oldest lots would be sold first. `minLoss` hides small positions.
 */
export function harvestIdeas(lots: LotView[], rates: TaxRates, today: string, minLoss = 100, method: LotMethod = 'hifo'): HarvestIdea[] {
  const bySymbol = new Map<string, LotView[]>();
  for (const lot of lots) bySymbol.set(lot.symbol, [...(bySymbol.get(lot.symbol) ?? []), lot]);
  const ideas: HarvestIdea[] = [];
  const recentCutoff = addDays(today, -30);
  for (const [symbol, symbolLots] of bySymbol) {
    if (symbolLots.some((lot) => lot.unrealized === null)) continue;
    const order = orderLots(symbolLots, method);
    let running = 0;
    let best = 0;
    let bestCount = 0;
    order.forEach((lot, index) => {
      running += lot.unrealized ?? 0;
      if (running < best - 1e-9) {
        best = running;
        bestCount = index + 1;
      }
    });
    if (!bestCount || -best < minLoss) continue;
    const sold = order.slice(0, bestCount);
    const loss = best;
    const shortLoss = sold.filter((lot) => lot.term === 'short').reduce((sum, lot) => sum + (lot.unrealized ?? 0), 0);
    const longLoss = loss - shortLoss;
    const soldIds = new Set(sold.map((lot) => lot.id));
    // Recent purchases that stay in the account would wash the loss.
    const kept = symbolLots.filter((lot) => !soldIds.has(lot.id) && !lot.estimated && lot.purchased > recentCutoff);
    const washRiskShares = kept.reduce((sum, lot) => sum + lot.quantity, 0);
    const latestRecent = kept.map((lot) => lot.purchased).sort().at(-1) ?? null;
    ideas.push({
      symbol,
      lots: sold.map((lot) => ({ id: lot.id, purchased: lot.purchased, quantity: lot.quantity, unrealized: lot.unrealized ?? 0, term: lot.term })),
      shares: sold.reduce((sum, lot) => sum + lot.quantity, 0),
      loss,
      shortLoss,
      longLoss,
      estimatedSavings: -shortLoss * rates.shortTerm + -longLoss * rates.longTerm,
      washRiskShares,
      sellAfter: latestRecent ? addDays(latestRecent, 31) : null,
      rebuyAfter: addDays(today, 31),
    });
  }
  return ideas.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}

/** Gaining short-term lots that turn long-term soon: selling after the date is taxed at the lower rate. */
export function waitForLongTerm(lots: LotView[], rates: TaxRates, horizonDays = 60): WaitIdea[] {
  return lots
    .filter((lot) => lot.term === 'short' && (lot.unrealized ?? 0) > 0 && lot.daysToLongTerm <= horizonDays)
    .map((lot) => ({
      symbol: lot.symbol,
      lotId: lot.id,
      purchased: lot.purchased,
      quantity: lot.quantity,
      unrealized: lot.unrealized ?? 0,
      longTermOn: lot.longTermOn,
      daysToLongTerm: lot.daysToLongTerm,
      savings: (lot.unrealized ?? 0) * Math.max(0, rates.shortTerm - rates.longTerm),
    }))
    .sort((a, b) => a.daysToLongTerm - b.daysToLongTerm);
}

/** Form 8949-style CSV of the disposals (one row per lot relieved). */
export function disposalsCsv(disposals: Disposal[]) {
  const header = ['Description', 'Date acquired', 'Date sold', 'Proceeds', 'Cost basis', 'Adjustment code', 'Adjustment', 'Gain or loss', 'Term'];
  const money = (value: number) => value.toFixed(2);
  const rows = disposals.map((disposal) => [
    `${disposal.quantity.toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false })} sh ${disposal.symbol}`,
    // Form 8949 accepts VARIOUS when the acquisition date isn't known (opening balances before the ledger).
    disposal.estimated ? 'VARIOUS' : disposal.acquired,
    disposal.sold,
    money(disposal.proceeds),
    money(disposal.cost),
    disposal.washDisallowed > 0 ? 'W' : '',
    disposal.washDisallowed > 0 ? money(disposal.washDisallowed) : '',
    money(disposal.reportable),
    disposal.term === 'long' ? 'Long-term' : 'Short-term',
  ]);
  return [header, ...rows].map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')).join('\n');
}

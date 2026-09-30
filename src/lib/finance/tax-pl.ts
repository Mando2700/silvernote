/**
 * Polish capital-gains tax (PIT-38) on foreign shares:
 * - FIFO is mandatory (art. 24 ust. 10 ustawy o PIT).
 * - Every amount is converted to PLN at the NBP average (table A) rate from the last business day
 *   before the transaction date (art. 11a ust. 1) — the purchase at the purchase's rate, the sale at the sale's.
 * - 19% flat tax on the year's net income from all disposals (art. 30b).
 * - A year's loss may reduce income in the next five years, at most 50% of that loss in any one year
 *   (art. 9 ust. 3; the one-off 5M PLN option is not modelled).
 */

export type PlTrade = { id: string; symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; fees: number; traded_at: string; kind?: 'trade' | 'opening' | 'removal' };

/** PLN per 1 unit of the trade currency on the last NBP business day strictly before `date`. */
export type RateBefore = (date: string) => { rate: number; date: string } | null;

export type PlDisposal = {
  saleId: string;
  symbol: string;
  bought: string;
  sold: string;
  quantity: number;
  proceedsUsd: number;
  costUsd: number;
  buyRate: number;
  buyRateDate: string;
  sellRate: number;
  sellRateDate: string;
  proceedsPln: number;
  costPln: number;
  incomePln: number;
};

export type PlYear = { year: number; proceedsPln: number; costPln: number; incomePln: number; lossDeductionPln: number; taxBasePln: number; taxPln: number };

type Lot = { symbol: string; quantity: number; pricePerShare: number; feePerShare: number; date: string };

export const PL_TAX_RATE = 0.19;

export function computePlTax(trades: PlTrade[], rateBefore: RateBefore) {
  const sorted = [...trades].sort((a, b) => a.traded_at.localeCompare(b.traded_at) || (a.side === 'buy' ? -1 : 1));
  const lots = new Map<string, Lot[]>();
  const disposals: PlDisposal[] = [];
  const missingRates = new Set<string>();

  for (const trade of sorted) {
    const queue = lots.get(trade.symbol) ?? [];
    lots.set(trade.symbol, queue);
    if (trade.side === 'buy') {
      queue.push({ symbol: trade.symbol, quantity: trade.quantity, pricePerShare: trade.price, feePerShare: trade.quantity > 0 ? trade.fees / trade.quantity : 0, date: trade.traded_at });
      continue;
    }
    let remaining = trade.quantity;
    const saleFeePerShare = trade.quantity > 0 ? trade.fees / trade.quantity : 0;
    while (remaining > 1e-9 && queue.length) {
      const lot = queue[0];
      const take = Math.min(remaining, lot.quantity);
      lot.quantity -= take;
      remaining -= take;
      if (lot.quantity <= 1e-9) queue.shift();
      // A removal (transfer out) closes lots without being a taxable disposal.
      if (trade.kind === 'removal') continue;
      const buy = rateBefore(lot.date);
      const sell = rateBefore(trade.traded_at);
      if (!buy) missingRates.add(lot.date);
      if (!sell) missingRates.add(trade.traded_at);
      if (!buy || !sell) continue;
      const proceedsUsd = take * (trade.price - saleFeePerShare);
      const costUsd = take * (lot.pricePerShare + lot.feePerShare);
      // Costs are converted at the buy date's rate, proceeds (and sale fees) at the sale date's.
      const proceedsPln = take * trade.price * sell.rate - take * saleFeePerShare * sell.rate;
      const costPln = take * (lot.pricePerShare + lot.feePerShare) * buy.rate;
      disposals.push({
        saleId: trade.id,
        symbol: trade.symbol,
        bought: lot.date,
        sold: trade.traded_at,
        quantity: take,
        proceedsUsd,
        costUsd,
        buyRate: buy.rate,
        buyRateDate: buy.date,
        sellRate: sell.rate,
        sellRateDate: sell.date,
        proceedsPln,
        costPln,
        incomePln: proceedsPln - costPln,
      });
    }
  }

  const byYear = new Map<number, { proceeds: number; cost: number }>();
  for (const disposal of disposals) {
    const year = Number(disposal.sold.slice(0, 4));
    const entry = byYear.get(year) ?? { proceeds: 0, cost: 0 };
    entry.proceeds += disposal.proceedsPln;
    entry.cost += disposal.costPln;
    byYear.set(year, entry);
  }
  const years = [...byYear.keys()].sort();
  // Loss pool: each year's loss with how much of it is still unused.
  const losses: Array<{ year: number; amount: number; left: number }> = [];
  const result: PlYear[] = [];
  if (years.length) {
    for (let year = years[0]; year <= years[years.length - 1]; year += 1) {
      const entry = byYear.get(year) ?? { proceeds: 0, cost: 0 };
      const income = entry.proceeds - entry.cost;
      let deduction = 0;
      if (income > 0) {
        let room = income;
        for (const loss of losses) {
          if (year - loss.year > 5 || loss.left <= 0 || room <= 0) continue;
          const use = Math.min(loss.left, loss.amount * 0.5, room);
          loss.left -= use;
          room -= use;
          deduction += use;
        }
      } else if (income < 0) {
        losses.push({ year, amount: -income, left: -income });
      }
      const base = Math.max(0, Math.round(income - deduction)); // PIT rounds the base to whole złoty
      if (byYear.has(year)) {
        result.push({ year, proceedsPln: entry.proceeds, costPln: entry.cost, incomePln: income, lossDeductionPln: deduction, taxBasePln: base, taxPln: Math.round(base * PL_TAX_RATE) });
      }
    }
  }
  const unusedLosses = losses.map((loss) => ({ year: loss.year, amount: loss.amount, left: loss.left, expires: loss.year + 5 })).filter((loss) => loss.left > 0);
  return { disposals, years: result, unusedLosses, missingRates: [...missingRates].sort() };
}

/** Last entry strictly before `date` from an ascending list of NBP rates. */
export function makeRateBefore(rates: Array<{ date: string; rate: number }>): RateBefore {
  return (date) => {
    let low = 0;
    let high = rates.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (rates[mid].date < date) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (found === -1) return null;
    // More than ten days of gap means the rate list doesn't cover this date.
    if (Date.parse(date) - Date.parse(rates[found].date) > 10 * 86_400_000) return null;
    return rates[found];
  };
}

export function plDisposalsCsv(disposals: PlDisposal[]) {
  const header = ['Symbol', 'Ilość', 'Data zakupu', 'Kurs NBP zakupu', 'Data kursu zakupu', 'Data sprzedaży', 'Kurs NBP sprzedaży', 'Data kursu sprzedaży', 'Przychód PLN', 'Koszt PLN', 'Dochód PLN'];
  const rows = disposals.map((row) => [row.symbol, row.quantity, row.bought, row.buyRate, row.buyRateDate, row.sold, row.sellRate, row.sellRateDate, row.proceedsPln.toFixed(2), row.costPln.toFixed(2), row.incomePln.toFixed(2)]);
  return [header, ...rows].map((cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

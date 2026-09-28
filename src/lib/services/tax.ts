import 'server-only';

import { q, q1 } from '@/lib/db';
import { todayInNewYork } from '@/lib/dates';
import {
  estimateTaxByYear,
  harvestIdeas,
  processLedger,
  summarizeRealized,
  type TaxRates,
  valueLots,
  waitForLongTerm,
} from '@/lib/finance/tax-lots';
import { getQuotes } from '@/lib/services/market';
import { getTransactions, type PortfolioRow } from '@/lib/services/portfolio';
import { getSecuritiesBySymbols } from '@/lib/services/universe';

export const DEFAULT_TAX_RATES: TaxRates = { shortTerm: 0.32, longTerm: 0.15 };

export async function getTaxRates(userId: string): Promise<TaxRates> {
  const row = await q1<{ data: { taxShortRate?: number | null; taxLongRate?: number | null } }>('select data from public.user_settings where user_id = $1', [userId]);
  return {
    shortTerm: row?.data?.taxShortRate ?? DEFAULT_TAX_RATES.shortTerm,
    longTerm: row?.data?.taxLongRate ?? DEFAULT_TAX_RATES.longTerm,
  };
}

export async function getLedger(portfolio: PortfolioRow) {
  const transactions = await getTransactions(portfolio.id);
  return processLedger(transactions, portfolio.lot_method ?? 'fifo');
}

/**
 * Similar exposure without a wash sale: the best-scored other companies in the same industry.
 * Different companies are not "substantially identical", so buying one keeps the loss deductible.
 */
async function replacementIdeas(symbols: string[], exclude: Set<string>) {
  const securities = await getSecuritiesBySymbols(symbols);
  const result: Record<string, Array<{ symbol: string; name: string; score: number }>> = {};
  await Promise.all(
    securities.map(async (security) => {
      if (!security.industry) return;
      const rows = await q<{ symbol: string; name: string; overall: number }>(
        `select s.symbol, s.name, sc.overall from public.securities s join public.scores sc on sc.symbol = s.symbol
         where s.industry = $1 and s.symbol <> all($2::text[]) and s.listed and s.is_common
         order by sc.overall desc, s.market_cap desc nulls last limit 3`,
        [security.industry, [...exclude]],
      );
      result[security.symbol] = rows.map((row) => ({ symbol: row.symbol, name: row.name, score: row.overall }));
    }),
  );
  return result;
}

export async function getTaxReport(portfolio: PortfolioRow, userId: string) {
  const today = todayInNewYork();
  const [ledger, rates] = await Promise.all([getLedger(portfolio), getTaxRates(userId)]);
  const symbols = [...new Set(ledger.openLots.map((lot) => lot.symbol))];
  const quotes = await getQuotes(symbols);
  const prices = Object.fromEntries(symbols.map((symbol) => [symbol, quotes[symbol]?.price ?? null]));
  const lots = valueLots(ledger.openLots, prices, today);

  const years = estimateTaxByYear(summarizeRealized(ledger.disposals), rates);
  const method = portfolio.lot_method ?? 'fifo';
  const harvest = harvestIdeas(lots, rates, today, 100, method);
  const replacements = harvest.length ? await replacementIdeas(harvest.map((idea) => idea.symbol), new Set(symbols)) : {};

  const unrealized = { shortGains: 0, shortLosses: 0, longGains: 0, longLosses: 0 };
  for (const lot of lots) {
    const amount = lot.unrealized ?? 0;
    if (lot.term === 'short') {
      if (amount >= 0) unrealized.shortGains += amount;
      else unrealized.shortLosses += amount;
    } else if (amount >= 0) unrealized.longGains += amount;
    else unrealized.longLosses += amount;
  }

  const currentYear = Number(today.slice(0, 4));
  const thisYear = years.find((year) => year.year === currentYear) ?? null;
  return {
    today,
    method,
    accountType: portfolio.account_type ?? 'taxable',
    rates,
    lots,
    unrealized,
    years,
    thisYear,
    disposals: ledger.disposals.slice().reverse(),
    washSales: ledger.washSales.slice().reverse(),
    /** Sells for more shares than the ledger held: the excess is missing from realized results. */
    unmatched: ledger.unmatched,
    /** Lots from broker opening balances, whose real purchase dates (and so terms) are unknown. */
    estimatedLots: lots.filter((lot) => lot.estimated).length,
    /** Holdings without a current price: their lots have no unrealized result and no harvesting idea. */
    unpriced: symbols.filter((symbol) => prices[symbol] === null),
    harvest: harvest.map((idea) => ({ ...idea, replacements: replacements[idea.symbol] ?? [] })),
    waitForLongTerm: waitForLongTerm(lots, rates),
  };
}

import { describe, expect, it } from 'vitest';

import {
  disposalsCsv,
  estimateTax,
  estimateTaxByYear,
  harvestIdeas,
  longTermDate,
  processLedger,
  summarizeRealized,
  type TaxTransaction,
  termFor,
  valueLots,
  waitForLongTerm,
} from './tax-lots';

let counter = 0;
const tx = (side: 'buy' | 'sell', traded_at: string, quantity: number, price: number, symbol = 'ABC', fees = 0): TaxTransaction => ({
  id: `t${(counter += 1)}`,
  symbol,
  side,
  quantity,
  price,
  fees,
  traded_at,
});

describe('holding period', () => {
  it('is long-term only after the one-year anniversary', () => {
    expect(longTermDate('2024-03-15')).toBe('2025-03-16');
    expect(termFor('2024-03-15', '2025-03-15')).toBe('short');
    expect(termFor('2024-03-15', '2025-03-16')).toBe('long');
  });

  it('handles a leap-day purchase', () => {
    expect(longTermDate('2024-02-29')).toBe('2025-03-01');
  });
});

describe('lot relief', () => {
  const ledger = [tx('buy', '2023-01-10', 10, 100), tx('buy', '2024-06-01', 10, 150), tx('sell', '2024-09-01', 10, 130)];

  it('FIFO sells the oldest lot (long-term gain)', () => {
    const { disposals, openLots } = processLedger(ledger, 'fifo');
    expect(disposals).toHaveLength(1);
    expect(disposals[0].gain).toBeCloseTo(300);
    expect(disposals[0].term).toBe('long');
    expect(openLots[0].costPerShare).toBe(150);
  });

  it('LIFO sells the newest lot (short-term loss)', () => {
    const { disposals } = processLedger(ledger, 'lifo');
    expect(disposals[0].gain).toBeCloseTo(-200);
    expect(disposals[0].term).toBe('short');
  });

  it('HIFO sells the highest-cost lot and spreads fees', () => {
    const { disposals } = processLedger([tx('buy', '2024-01-02', 10, 100, 'ABC', 10), tx('buy', '2024-02-01', 10, 90), tx('sell', '2024-03-01', 15, 120, 'ABC', 15)], 'hifo');
    expect(disposals.map((d) => d.quantity)).toEqual([10, 5]);
    expect(disposals[0].cost).toBeCloseTo(1010);
    expect(disposals[0].proceeds).toBeCloseTo(1190);
    expect(disposals[1].proceeds).toBeCloseTo(595);
  });
});

describe('wash sales', () => {
  it('disallows a loss when the ticker is rebought within 30 days and moves it into the new basis', () => {
    const { disposals, openLots, washSales } = processLedger([tx('buy', '2024-01-02', 100, 50), tx('sell', '2024-03-01', 100, 40), tx('buy', '2024-03-20', 100, 42)]);
    expect(disposals[0].gain).toBeCloseTo(-1000);
    expect(disposals[0].washDisallowed).toBeCloseTo(1000);
    expect(disposals[0].reportable).toBeCloseTo(0);
    expect(washSales[0].sharesWashed).toBe(100);
    expect(openLots).toHaveLength(1);
    expect(openLots[0].costPerShare).toBeCloseTo(52);
    // 59 days of holding carry over to the replacement shares.
    expect(openLots[0].acquired).toBe('2024-01-21');
  });

  it('washes only the replaced fraction of a loss', () => {
    const { disposals, openLots } = processLedger([tx('buy', '2024-01-02', 100, 50), tx('sell', '2024-03-01', 100, 40), tx('buy', '2024-03-05', 40, 41)]);
    expect(disposals[0].washDisallowed).toBeCloseTo(400);
    expect(disposals[0].reportable).toBeCloseTo(-600);
    expect(openLots[0].costPerShare).toBeCloseTo(51);
  });

  it('counts shares bought in the 30 days before the sale that are still held', () => {
    const { disposals, openLots } = processLedger([tx('buy', '2024-01-02', 100, 50), tx('buy', '2024-02-20', 50, 42), tx('sell', '2024-03-01', 100, 40)]);
    expect(disposals[0].washDisallowed).toBeCloseTo(500);
    const replacement = openLots.find((lot) => lot.washAdjustmentPerShare > 0);
    expect(replacement?.quantity).toBe(50);
    expect(replacement?.costPerShare).toBeCloseTo(52);
  });

  it('does not treat unsold shares of the same purchase as replacements', () => {
    const { disposals } = processLedger([tx('buy', '2024-02-20', 100, 50), tx('sell', '2024-03-01', 40, 45)]);
    expect(disposals[0].washDisallowed).toBe(0);
  });

  it('ignores buys outside the window, gains, and other tickers', () => {
    const { disposals } = processLedger([
      tx('buy', '2024-01-02', 10, 50),
      tx('sell', '2024-03-01', 10, 40),
      tx('buy', '2024-04-05', 10, 41),
      tx('buy', '2024-03-05', 10, 41, 'XYZ'),
    ]);
    expect(disposals[0].washDisallowed).toBe(0);
    const gains = processLedger([tx('buy', '2024-01-02', 10, 50), tx('sell', '2024-03-01', 10, 60), tx('buy', '2024-03-05', 10, 61)]);
    expect(gains.washSales).toHaveLength(0);
  });

  it('uses each replacement share only once', () => {
    const { disposals } = processLedger([
      tx('buy', '2024-01-02', 20, 50),
      tx('sell', '2024-03-01', 10, 40),
      tx('sell', '2024-03-02', 10, 40),
      tx('buy', '2024-03-10', 10, 41),
    ]);
    expect(disposals[0].washDisallowed).toBeCloseTo(100);
    expect(disposals[1].washDisallowed).toBe(0);
  });
});

describe('summaries and ideas', () => {
  it('summarizes realized results by year and term', () => {
    const { disposals } = processLedger([tx('buy', '2022-01-03', 10, 100), tx('buy', '2024-01-03', 10, 100), tx('sell', '2024-06-03', 20, 90)], 'fifo');
    const [year] = summarizeRealized(disposals);
    expect(year.year).toBe(2024);
    expect(year.longLosses).toBeCloseTo(-100);
    expect(year.shortLosses).toBeCloseTo(-100);
    expect(year.net).toBeCloseTo(-200);
  });

  it('nets across terms and caps the ordinary-income deduction', () => {
    expect(estimateTax({ netShort: 1000, netLong: -400 }, { shortTerm: 0.3, longTerm: 0.15 }).tax).toBeCloseTo(180);
    const loss = estimateTax({ netShort: -5000, netLong: 0 }, { shortTerm: 0.3, longTerm: 0.15 });
    expect(loss.tax).toBeCloseTo(-900);
    expect(loss.carryforward).toBeCloseTo(-2000);
  });

  it('finds harvestable losses and flags recent buys that would wash them', () => {
    const { openLots } = processLedger([tx('buy', '2025-01-02', 100, 50), tx('buy', '2025-09-20', 10, 30)]);
    const lots = valueLots(openLots, { ABC: 35 }, '2025-09-27');
    const [idea] = harvestIdeas(lots, { shortTerm: 0.32, longTerm: 0.15 }, '2025-09-27');
    expect(idea.loss).toBeCloseTo(-1500);
    expect(idea.estimatedSavings).toBeCloseTo(480);
    expect(idea.washRiskShares).toBe(10);
    expect(idea.sellAfter).toBe('2025-10-21');
    expect(idea.rebuyAfter).toBe('2025-10-28');
  });

  it('suggests waiting when a gain turns long-term soon', () => {
    const { openLots } = processLedger([tx('buy', '2024-10-15', 10, 100)]);
    const [idea] = waitForLongTerm(valueLots(openLots, { ABC: 200 }, '2025-09-27'), { shortTerm: 0.35, longTerm: 0.15 });
    expect(idea.longTermOn).toBe('2025-10-16');
    expect(idea.daysToLongTerm).toBe(19);
    expect(idea.savings).toBeCloseTo(200);
  });

  it('exports a wash-sale adjusted 8949 CSV', () => {
    const { disposals } = processLedger([tx('buy', '2024-01-02', 100, 50), tx('sell', '2024-03-01', 100, 40), tx('buy', '2024-03-20', 100, 42)]);
    const csv = disposalsCsv(disposals).split('\n');
    expect(csv[1]).toBe('100 sh ABC,2024-01-02,2024-03-01,4000.00,5000.00,W,1000.00,0.00,Short-term');
  });
});

describe('ledger integrity', () => {
  it('reports shares sold beyond the open lots instead of dropping them silently', () => {
    const { disposals, unmatched } = processLedger([tx('buy', '2024-01-02', 5, 10), tx('sell', '2024-02-01', 8, 12)]);
    expect(disposals.reduce((sum, d) => sum + d.quantity, 0)).toBe(5);
    expect(unmatched).toEqual([expect.objectContaining({ shares: 3 })]);
  });

  it('replays same-day trades in execution order, like the holdings', () => {
    // Sold the old lot in the morning, bought new shares in the afternoon: LIFO must relieve the old lot.
    const sell = { ...tx('sell', '2024-06-03', 10, 120), created_at: '2024-06-03T14:00:00Z' };
    const rebuy = { ...tx('buy', '2024-06-03', 10, 121), created_at: '2024-06-03T19:00:00Z' };
    const { disposals, openLots } = processLedger([tx('buy', '2023-01-03', 10, 100), rebuy, sell], 'lifo');
    expect(disposals[0].cost).toBeCloseTo(1000);
    expect(openLots[0].costPerShare).toBeCloseTo(121);
  });

  it('removes shares for a balancing removal without realizing anything', () => {
    const removal = { ...tx('sell', '2024-05-01', 4, 999), kind: 'removal' as const };
    const { disposals, openLots, unmatched } = processLedger([tx('buy', '2024-01-02', 10, 100), removal]);
    expect(disposals).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
    expect(openLots[0].quantity).toBe(6);
  });

  it('flags opening-balance lots and exports their acquisition date as VARIOUS', () => {
    const opening = { ...tx('buy', '2024-01-01', 10, 50), kind: 'opening' as const };
    const { disposals } = processLedger([opening, tx('sell', '2024-03-01', 10, 40)]);
    expect(disposals[0].estimated).toBe(true);
    expect(disposalsCsv(disposals).split('\n')[1]).toContain(',VARIOUS,2024-03-01,');
  });

  it('never treats an opening balance as a wash-sale replacement', () => {
    const opening = { ...tx('buy', '2024-02-20', 50, 42), kind: 'opening' as const };
    const { disposals } = processLedger([tx('buy', '2024-01-02', 100, 50), opening, tx('sell', '2024-03-01', 100, 40)], 'fifo');
    expect(disposals[0].washDisallowed).toBe(0);
  });
});

describe('carryforward and lot-method-aware harvesting', () => {
  const rates = { shortTerm: 0.3, longTerm: 0.15 };

  it('carries an unused loss into later years, keeping its character', () => {
    const [y2024, y2025] = estimateTaxByYear(
      [
        { year: 2025, netShort: 5000, netLong: 0 },
        { year: 2024, netShort: -10000, netLong: 0 },
      ],
      rates,
    ).sort((a, b) => a.year - b.year);
    expect(y2024.carryforward).toBeCloseTo(-7000);
    expect(y2025.carryIn).toBeCloseTo(-7000);
    // $5,000 gain absorbed, $2,000 left: $2,000 against ordinary income, nothing carried on.
    expect(y2025.tax).toBeCloseTo(-600);
    expect(y2025.carryforward).toBeCloseTo(0);
  });

  it('keeps applying the $3,000 offset in years without sales', () => {
    const [, y2027] = estimateTaxByYear(
      [
        { year: 2024, netShort: -10000, netLong: 0 },
        { year: 2027, netShort: 0, netLong: 0 },
      ],
      rates,
    );
    // 2024 uses 3k, 2025 and 2026 use 3k each, 2027 gets the last 1k.
    expect(y2027.carryIn).toBeCloseTo(-1000);
    expect(y2027.carryforward).toBeCloseTo(0);
  });

  it('with FIFO, harvests only what a sale would actually relieve', () => {
    const { openLots } = processLedger([tx('buy', '2024-01-02', 10, 10), tx('buy', '2025-06-02', 10, 50)]);
    const lots = valueLots(openLots, { ABC: 30 }, '2025-09-27');
    // FIFO sells the $10 lot first (+$200), then the $50 lot (−$200): no net loss to harvest.
    expect(harvestIdeas(lots, { shortTerm: 0.32, longTerm: 0.15 }, '2025-09-27', 100, 'fifo')).toHaveLength(0);
    const [hifo] = harvestIdeas(lots, { shortTerm: 0.32, longTerm: 0.15 }, '2025-09-27', 100, 'hifo');
    expect(hifo.loss).toBeCloseTo(-200);
    expect(hifo.shares).toBe(10);
  });
});

describe('country rules', () => {
  it('counts a custom holding period in months, clamping month ends', () => {
    expect(longTermDate('2024-03-15', 36)).toBe('2027-03-16');
    expect(longTermDate('2024-08-31', 6)).toBe('2025-03-01');
    expect(termFor('2024-01-02', '2030-01-02', null)).toBe('short');
  });

  it('skips wash sales without a deferral rule and uses a custom window when given', () => {
    const ledger = [tx('buy', '2024-01-02', 100, 50), tx('sell', '2024-03-01', 100, 40), tx('buy', '2024-04-20', 100, 42)];
    expect(processLedger(ledger, 'fifo', { longTermMonths: null, lossDeferralDays: null }).washSales).toHaveLength(0);
    expect(processLedger(ledger, 'fifo', { longTermMonths: null, lossDeferralDays: 30 }).washSales).toHaveLength(0);
    // Spain's two-month rule reaches the April rebuy.
    const { disposals } = processLedger(ledger, 'fifo', { longTermMonths: null, lossDeferralDays: 60 });
    expect(disposals[0].washDisallowed).toBeCloseTo(1000);
  });

  it('relieves pooled average cost', () => {
    const { disposals, openLots } = processLedger([tx('buy', '2024-01-02', 10, 100), tx('buy', '2024-02-01', 10, 200), tx('sell', '2024-03-01', 10, 180)], 'average', {
      longTermMonths: null,
      lossDeferralDays: null,
    });
    expect(disposals[0].cost).toBeCloseTo(1500);
    expect(disposals[0].gain).toBeCloseTo(300);
    expect(openLots[0].costPerShare).toBeCloseTo(150);
  });

  it('carries the whole net loss forward without an ordinary-income offset', () => {
    const [year] = estimateTaxByYear([{ year: 2024, netShort: -5000, netLong: 0 }], { shortTerm: 0.26, longTerm: 0.26 }, 0);
    expect(year.tax).toBe(0);
    expect(year.carryforward).toBeCloseTo(-5000);
  });

  it('has no rebuy date or wait ideas without a deferral rule or long-term threshold', () => {
    const { openLots } = processLedger([tx('buy', '2025-01-02', 100, 50), tx('buy', '2025-09-20', 10, 30)]);
    const lots = valueLots(openLots, { ABC: 35 }, '2025-09-27', null);
    const [idea] = harvestIdeas(lots, { shortTerm: 0.3, longTerm: 0.3 }, '2025-09-27', 100, 'fifo', null);
    expect(idea.rebuyAfter).toBeNull();
    expect(idea.washRiskShares).toBe(0);
    expect(waitForLongTerm(lots, { shortTerm: 0.3, longTerm: 0.3 })).toHaveLength(0);
  });
});

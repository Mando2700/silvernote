import { describe, expect, it } from 'vitest';

import type { StatementPeriod } from '@/lib/finance/statement-types';

import { availableOn, monthEnds, pointInTimeScores } from './point-in-time';

function period(year: number, filed: string | null, revenue: number): StatementPeriod {
  return {
    key: `FY${year}`, period: 'FY', fiscalYear: year, fiscalQuarter: null, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`,
    label: `FY${year}`, currency: 'USD', filed, form: '10-K', fiscalDate: `${year}-12-31`, year,
    revenue, netIncome: revenue * 0.2, grossProfit: revenue * 0.5, operatingIncome: revenue * 0.25, operatingCashFlow: revenue * 0.25,
    capex: -revenue * 0.05, totalAssets: revenue * 2, totalEquity: revenue, totalLiabilities: revenue, currentAssets: revenue * 0.6,
    currentLiabilities: revenue * 0.4, totalDebt: revenue * 0.3, cash: revenue * 0.2, sharesDiluted: 1000, epsDiluted: revenue * 0.0002,
  };
}

const day = (iso: string) => Date.parse(`${iso}T16:00:00Z`) / 1000;

function candles(from: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.1;
    return { timestamp: day(from) + index * 86_400, open: close, high: close, low: close, close, volume: 1e6 };
  });
}

describe('point-in-time scores', () => {
  it('lists month ends with today last', () => {
    expect(monthEnds(0.25, '2025-09-27')).toEqual(['2025-06-30', '2025-07-31', '2025-08-31', '2025-09-27']);
  });

  it('dates unfiled periods 90 days after period end', () => {
    expect(availableOn(period(2024, null, 1))).toBe('2025-03-31');
    expect(availableOn(period(2024, '2025-02-14', 1))).toBe('2025-02-14');
  });

  it('only uses filings public by each date and prices up to that date', () => {
    const rows = pointInTimeScores(
      {
        symbol: 'ABC', name: 'ABC Corp', sector: 'Technology', industry: 'Software', currency: 'USD', fxToUsd: 1,
        annual: [period(2024, '2025-02-14', 2000), period(2023, '2024-02-14', 1000)],
        candles: candles('2024-01-01', 500),
        benchmark: [],
        currentMarketCap: null,
        currentPrice: null,
      },
      ['2024-01-31', '2024-06-28', '2025-01-31', '2025-03-31'],
    );
    // Jan 2024: no filing public yet and too little price history.
    expect(rows.map((row) => row.as_of)).toEqual(['2024-06-28', '2025-01-31', '2025-03-31']);
    expect(rows[0].price).toBeCloseTo(100 + 0.1 * 179, 1);
    expect(rows[0].market_cap).toBeCloseTo(rows[0].price * 1000);
    // The FY2024 filing (revenue doubled) only counts from its filing date.
    expect(rows[1].sub_scores.growth).toBe(rows[0].sub_scores.growth);
    expect(rows[2].sub_scores.growth).not.toBe(rows[1].sub_scores.growth);
    for (const row of rows) expect(row.overall).toBeGreaterThan(0);
  });

  it('restates filings in today\'s share units after a split', () => {
    const source = {
      symbol: 'ABC', name: 'ABC Corp', sector: 'Technology', industry: 'Software', currency: 'USD', fxToUsd: 1,
      annual: [period(2024, '2025-02-14', 2000)],
      candles: candles('2024-01-01', 500),
      benchmark: [],
      currentMarketCap: null,
      currentPrice: null,
    };
    const [plain] = pointInTimeScores(source, ['2025-03-31']);
    // A 4-for-1 split after the filing: the split-adjusted price is a quarter of what traded then,
    // and the filed share count is a quarter of today's. Market value must not change.
    const [split] = pointInTimeScores({ ...source, splits: [{ date: '2025-06-02', factor: 4 }] }, ['2025-03-31']);
    expect(split.market_cap).toBeCloseTo(split.price * 4000);
    expect(plain.market_cap).toBeCloseTo(plain.price * 1000);
  });
});

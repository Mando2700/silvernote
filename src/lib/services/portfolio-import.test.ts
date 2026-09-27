import { describe, expect, it } from 'vitest';

import { chooseStrongerExtraction, cleanSymbol, mergeDuplicateHoldings, sanitizeHolding, sanitizeImportResult, shouldRetryExtraction, type ExtractedHolding } from './portfolio-import';

const holding = (overrides: Partial<ExtractedHolding> = {}): ExtractedHolding => ({
  rawText: null,
  symbol: 'AAPL',
  companyName: 'Apple',
  quantity: 10,
  marketValue: 2000,
  price: 200,
  averageCost: null,
  costBasis: null,
  allocationPercent: null,
  currency: 'USD',
  confidence: 0.9,
  warnings: [],
  ...overrides,
});

const assessment = { estimatedVisibleHoldings: null, holdingsVisible: true, layout: 'table' as const, locale: null, partialScreenshot: false, portfolioCurrency: null, readable: true };

describe('cleanSymbol', () => {
  it('strips exchange prefixes, quote pairs and UI noise', () => {
    expect(cleanSymbol('NASDAQ:msft')).toBe('MSFT');
    expect(cleanSymbol('$tsla')).toBe('TSLA');
    expect(cleanSymbol('BTC-USD')).toBe('BTC');
    expect(cleanSymbol('BRK.B')).toBe('BRK.B');
    expect(cleanSymbol('  ')).toBeNull();
  });
});

describe('sanitizeHolding', () => {
  it('flags rows whose shares × price disagree with the position value and lowers confidence', () => {
    const row = sanitizeHolding({ symbol: 'NVDA', quantity: 10, price: 100, marketValue: 5000, confidence: 0.9, warnings: [] }, null);
    expect(row.warnings.some((warning) => warning.startsWith('Extracted values do not reconcile:'))).toBe(true);
    expect(row.confidence).toBeCloseTo(0.72, 5);
  });

  it('redacts account-like numbers and emails, normalizes confidence and percentages', () => {
    const row = sanitizeHolding({ symbol: 'VOO', rawText: 'Acct 12345678 me@x.com VOO', confidence: 85, allocationPercent: 250, currency: 'usd' }, 'EUR');
    expect(row.rawText).not.toContain('12345678');
    expect(row.rawText).not.toContain('me@x.com');
    expect(row.confidence).toBe(0.85);
    expect(row.allocationPercent).toBeNull();
    expect(row.currency).toBe('USD');
  });

  it('falls back to the screenshot currency', () => {
    expect(sanitizeHolding({ symbol: 'CDR' }, 'PLN').currency).toBe('PLN');
  });
});

describe('sanitizeImportResult', () => {
  it('drops rows with neither a ticker nor a name', () => {
    const result = sanitizeImportResult({ holdings: [{ quantity: 3 }, { companyName: 'Vanguard Total World' }], notes: [], ignoredSensitiveData: [], imageAssessment: assessment });
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].symbol).toBeNull();
  });
});

describe('recovery pass', () => {
  it('retries when nothing usable was found or most visible rows were missed', () => {
    expect(shouldRetryExtraction({ holdings: [], notes: [], ignoredSensitiveData: [], imageAssessment: assessment })).toBe(true);
    expect(shouldRetryExtraction({ holdings: [holding()], notes: [], ignoredSensitiveData: [], imageAssessment: { ...assessment, estimatedVisibleHoldings: 8 } })).toBe(true);
    expect(shouldRetryExtraction({ holdings: [holding(), holding({ symbol: 'MSFT' })], notes: [], ignoredSensitiveData: [], imageAssessment: { ...assessment, estimatedVisibleHoldings: 2 } })).toBe(false);
  });

  it('keeps the stronger of the two extractions', () => {
    const weak = { holdings: [holding({ quantity: null, marketValue: null, price: null })], notes: [], ignoredSensitiveData: [], imageAssessment: assessment };
    const strong = { holdings: [holding(), holding({ symbol: 'MSFT' })], notes: [], ignoredSensitiveData: [], imageAssessment: assessment };
    expect(chooseStrongerExtraction(weak, strong)).toBe(strong);
    expect(chooseStrongerExtraction(strong, weak)).toBe(strong);
  });
});

describe('mergeDuplicateHoldings', () => {
  it('collapses the same position seen in overlapping photos', () => {
    expect(mergeDuplicateHoldings([holding(), holding()])).toHaveLength(1);
  });

  it('sums separate lots and recomputes average cost', () => {
    const [merged] = mergeDuplicateHoldings([holding({ quantity: 10, costBasis: 1000, marketValue: 2000 }), holding({ quantity: 5, costBasis: 1000, marketValue: 1000 })]);
    expect(merged.quantity).toBe(15);
    expect(merged.costBasis).toBe(2000);
    expect(merged.averageCost).toBeCloseTo(133.3333, 4);
    expect(merged.warnings).toContain('Merged duplicate rows. Review shares and cost basis.');
  });
});

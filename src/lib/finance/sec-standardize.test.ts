import { describe, expect, it } from 'vitest';

import { standardizeCompanyFacts, type CompanyFactsPayload, type XbrlFact } from './sec-standardize';

const fact = (start: string | undefined, end: string, val: number, form: string, filed: string): XbrlFact => ({ start, end, val, form, filed, accn: `${form}-${end}` });

/** A calendar-year filer: two 10-Ks, and 10-Qs for 2024 reporting both the quarter and year-to-date. */
function payload(): CompanyFactsPayload {
  const revenue = [
    fact('2023-01-01', '2023-12-31', 800, '10-K', '2024-02-01'),
    fact('2024-01-01', '2024-12-31', 1000, '10-K', '2025-02-01'),
    fact('2024-01-01', '2024-03-31', 220, '10-Q', '2024-05-01'),
    fact('2024-04-01', '2024-06-30', 240, '10-Q', '2024-08-01'),
    fact('2024-01-01', '2024-06-30', 460, '10-Q', '2024-08-01'),
    fact('2024-07-01', '2024-09-30', 250, '10-Q', '2024-11-01'),
    fact('2024-01-01', '2024-09-30', 710, '10-Q', '2024-11-01'),
  ];
  const netIncome = [
    fact('2023-01-01', '2023-12-31', 70, '10-K', '2024-02-01'),
    fact('2024-01-01', '2024-12-31', 100, '10-K', '2025-02-01'),
    fact('2024-01-01', '2024-03-31', 20, '10-Q', '2024-05-01'),
    fact('2024-04-01', '2024-06-30', 25, '10-Q', '2024-08-01'),
    fact('2024-01-01', '2024-06-30', 45, '10-Q', '2024-08-01'),
    fact('2024-07-01', '2024-09-30', 30, '10-Q', '2024-11-01'),
    fact('2024-01-01', '2024-09-30', 75, '10-Q', '2024-11-01'),
  ];
  const assets = [
    fact(undefined, '2023-12-31', 4000, '10-K', '2024-02-01'),
    fact(undefined, '2024-09-30', 4800, '10-Q', '2024-11-01'),
    fact(undefined, '2024-12-31', 5000, '10-K', '2025-02-01'),
  ];
  return {
    cik: 1234,
    entityName: 'Example Corp',
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: revenue } },
        NetIncomeLoss: { units: { USD: netIncome } },
        Assets: { units: { USD: assets } },
      },
    },
  };
}

describe('standardizeCompanyFacts', () => {
  const statements = standardizeCompanyFacts(payload(), { symbol: 'EXMP' });

  it('builds annual periods newest first', () => {
    expect(statements.annual.map((period) => period.label)).toEqual(['FY24', 'FY23']);
    expect(statements.annual[0].revenue).toBe(1000);
    expect(statements.annual[0].netIncome).toBe(100);
    expect(statements.annual[0].totalAssets).toBe(5000);
    expect(statements.annual[1].revenue).toBe(800);
    expect(statements.currency).toBe('USD');
    expect(statements.cik).toBe('0000001234');
  });

  it('derives the fourth quarter from the annual figure minus nine months year-to-date', () => {
    const labels = statements.quarterly.map((period) => period.label);
    expect(labels).toEqual(['Q4 FY24', 'Q3 FY24', 'Q2 FY24', 'Q1 FY24']);
    const [q4, q3, q2, q1] = statements.quarterly;
    expect(q4.revenue).toBe(290);
    expect(q4.netIncome).toBe(25);
    expect(q4.derived).toContain('revenue');
    expect(q3.revenue).toBe(250);
    expect(q2.revenue).toBe(240);
    expect(q1.revenue).toBe(220);
    expect(q3.totalAssets).toBe(4800);
  });

  it('adds up the last four quarters into a trailing-twelve-month view', () => {
    expect(statements.ttm).not.toBeNull();
    expect(statements.ttm!.revenue).toBe(1000);
    expect(statements.ttm!.netIncome).toBe(100);
    expect(statements.ttm!.totalAssets).toBe(5000);
  });
});

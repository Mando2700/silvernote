import { describe, expect, it } from 'vitest';

import { cite } from '@/lib/citation';

describe('cite', () => {
  const filing = { kind: 'filing' as const, company: 'Apple Inc.', form: '10-K', filedAt: '2025-10-31', periodEnd: '2025-09-27', url: 'https://www.sec.gov/x.htm' };
  it('formats a 10-K in APA and Harvard', () => {
    expect(cite(filing, 'APA', '2026-09-30')).toBe('Apple Inc. (2025). *Annual report (Form 10-K) for the period ended September 27, 2025*. U.S. Securities and Exchange Commission. https://www.sec.gov/x.htm');
    expect(cite(filing, 'Harvard', '2026-09-30')).toContain('(Accessed: 30 September 2026).');
  });
  it('formats a FRED series', () => {
    expect(cite({ kind: 'fred', seriesId: 'DGS10', title: 'Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity' }, 'MLA', '2026-09-30')).toContain('fred.stlouisfed.org/series/DGS10. Accessed 30 Sep. 2026.');
  });
});

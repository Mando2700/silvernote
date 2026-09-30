import { describe, expect, it } from 'vitest';

import { diffRiskFactors, extractRiskFactors } from '@/lib/finance/risk-factors';

const para = (text: string) => `${text} ${'This risk could materially and adversely affect our business and results.'.repeat(2)}`;

describe('risk factors', () => {
  it('skips the table of contents and stops at Item 1B', () => {
    const doc = `Item 1A. Risk Factors 12\nItem 1B. Unresolved 30\n\nItem 1A. Risk Factors\n\n${para('Competition.')}\n\n${para('Supply.')}\n\nItem 1B. Unresolved Staff Comments\nNone.`;
    const section = extractRiskFactors(doc);
    expect(section).toContain('Competition.');
    expect(section).not.toContain('Unresolved Staff');
  });
  it('reports added and removed paragraphs', () => {
    const tariffs = 'Tariffs imposed on imported components from several countries raise our manufacturing costs and squeeze gross margins.';
    const ai = 'New artificial intelligence regulation in Europe may restrict how we deploy models and expose us to large fines.';
    const before = `${para('Competition.')}\n\n${tariffs}`;
    const after = `${para('Competition.')}\n\n${ai}`;
    const diff = diffRiskFactors(before, after);
    expect(diff.unchanged).toBe(1);
    expect(diff.added[0]).toContain('artificial intelligence');
    expect(diff.removed[0]).toContain('Tariffs imposed');
  });
  it('treats a reworded paragraph as modified', () => {
    const diff = diffRiskFactors(para('Competition is intense in all markets.'), para('Competition is very intense in all our markets.'));
    expect(diff.modified).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';

import { DEFAULT_SHARE_OPTIONS, normalizeShareOptions, type ShareOptions } from '@/lib/share/options';
import { buildShareView, groupSlices, shareSummaryText, weightLabel, type ShareSource } from '@/lib/share/view';

const holding = (symbol: string, marketValue: number, costBasis: number, sector: string | null = 'Technology') => ({
  symbol,
  name: `${symbol} Inc`,
  sector,
  shares: marketValue / 10,
  costBasis,
  marketValue,
  dayChange: marketValue * 0.01,
  dayChangePct: 1,
  unrealized: marketValue - costBasis,
  unrealizedPct: (marketValue - costBasis) / costBasis,
});

const DAY = 86_400;
const T0 = Date.UTC(2026, 0, 1) / 1000;

const source: ShareSource = {
  name: 'Long-term',
  benchmark: 'SPY',
  cash: 10_000,
  fixedIncome: 0,
  holdings: [holding('AAA', 40_000, 30_000), holding('BBB', 30_000, 35_000, 'Health Care'), holding('CCC', 12_000, 10_000), holding('DDD', 5_000, 4_000), holding('EEE', 3_000, 3_000, null)],
  performance: Array.from({ length: 400 }, (_, index) => ({ t: T0 + index * DAY, twr: 100 + index * 0.1, benchmark: 100 + index * 0.05 })),
  asOf: 1_700_000_000_000,
};

const options = (patch: Partial<ShareOptions> = {}): ShareOptions => ({ ...DEFAULT_SHARE_OPTIONS, ...patch });

describe('buildShareView', () => {
  it('shows no dollar amounts when amounts are hidden', () => {
    const view = buildShareView(source, options({ amounts: 'hidden', shares: true }));
    expect(view.totals.value).toBeNull();
    expect(view.totals.gain).toBeNull();
    expect(view.totals.dayChange).toBeNull();
    for (const row of view.holdings) {
      expect(row.value).toBeNull();
      expect(row.gain).toBeNull();
      expect(row.shares).toBeNull();
    }
    // Percentages survive.
    expect(view.totals.gainPct).not.toBeNull();
    expect(view.holdings[0].weight).toBeCloseTo(40_000 / 100_000);
  });

  it('never exposes share counts without exact amounts', () => {
    expect(buildShareView(source, options({ amounts: 'scaled', shares: true })).holdings.every((row) => row.shares === null)).toBe(true);
    expect(buildShareView(source, options({ amounts: 'exact', shares: true })).holdings[0].shares).toBe(4_000);
    expect(buildShareView(source, options({ amounts: 'exact', shares: false })).holdings[0].shares).toBeNull();
  });

  it('scales a portfolio to a $100K model with the same mix and returns', () => {
    const exact = buildShareView(source, options({ amounts: 'exact' }));
    const scaled = buildShareView(source, options({ amounts: 'scaled' }));
    expect(scaled.totals.value).toBeCloseTo(100_000);
    expect(scaled.holdings[0].weight).toBeCloseTo(exact.holdings[0].weight);
    expect(scaled.holdings[0].returnPct).toBeCloseTo(exact.holdings[0].returnPct as number);
    expect(scaled.holdings[0].value).toBeCloseTo(exact.holdings[0].weight * 100_000);
    expect(scaled.totals.gainPct).toBeCloseTo(exact.totals.gainPct as number);
  });

  it('scales to the model even when the real portfolio is far larger', () => {
    const big: ShareSource = { ...source, cash: 1_000_000, holdings: source.holdings.map((item) => ({ ...item, marketValue: item.marketValue * 50 })) };
    expect(buildShareView(big, options({ amounts: 'scaled' })).totals.value).toBeCloseTo(100_000);
  });

  it('hides gains, losses and performance when returns are off', () => {
    const view = buildShareView(source, options({ amounts: 'exact', returns: false }));
    expect(view.totals.gain).toBeNull();
    expect(view.totals.gainPct).toBeNull();
    expect(view.totals.dayChangePct).toBeNull();
    expect(view.performance).toBeNull();
    expect(view.sections.performance).toBe(false);
    for (const row of view.holdings) {
      expect(row.returnPct).toBeNull();
      expect(row.dayChangePct).toBeNull();
      expect(row.gain).toBeNull();
    }
  });

  it('leaves cash out of the weights when asked', () => {
    const withCash = buildShareView(source, options());
    const withoutCash = buildShareView(source, options({ cash: false }));
    expect(withCash.allocation.some((slice) => slice.kind === 'cash')).toBe(true);
    expect(withoutCash.allocation.some((slice) => slice.kind === 'cash')).toBe(false);
    expect(withoutCash.totals.cashWeight).toBeNull();
    expect(withoutCash.allocation.reduce((sum, slice) => sum + slice.weight, 0)).toBeCloseTo(1);
    expect(withCash.allocation.reduce((sum, slice) => sum + slice.weight, 0)).toBeCloseTo(1);
  });

  it('shows the top holdings and folds the rest into one row', () => {
    const view = buildShareView(source, options({ detail: 'top5' }));
    expect(view.holdings).toHaveLength(5);
    const top3 = buildShareView(source, options({ detail: 'top5', sections: { ...DEFAULT_SHARE_OPTIONS.sections } }));
    expect(top3.holdings.every((row) => row.kind === 'holding')).toBe(true);
    const many: ShareSource = { ...source, holdings: [...source.holdings, ...['FFF', 'GGG', 'HHH', 'III', 'JJJ', 'KKK', 'LLL'].map((symbol) => holding(symbol, 1_000, 900))] };
    const grouped = buildShareView(many, options({ detail: 'top10' }));
    expect(grouped.holdings).toHaveLength(11);
    expect(grouped.holdings[10]).toMatchObject({ kind: 'other', symbol: null, name: '2 other holdings' });
    expect(grouped.holdings.reduce((sum, row) => sum + row.weight, 0) + (grouped.totals.cashWeight ?? 0)).toBeCloseTo(1);
  });

  it('leaks no ticker or company name in sectors-only mode', () => {
    const view = buildShareView(source, options({ detail: 'sectors', amounts: 'exact', shares: true }));
    expect(view.holdings).toEqual([]);
    expect(view.sections.holdings).toBe(false);
    expect(view.totals.positions).toBeNull();
    const json = JSON.stringify(view);
    for (const symbol of ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']) expect(json).not.toContain(symbol);
    expect(view.allocation.every((slice) => slice.kind === 'sector' || slice.kind === 'cash')).toBe(true);
  });

  it('returns the performance window rebased to 100 with matching returns', () => {
    const view = buildShareView(source, options({ range: '3M' }));
    const performance = view.performance!;
    expect(performance.points[0].portfolio).toBeCloseTo(100);
    expect(performance.points[0].benchmark).toBeCloseTo(100);
    const last = performance.points[performance.points.length - 1];
    expect(performance.portfolioReturn).toBeCloseTo(last.portfolio / 100 - 1);
    expect(performance.portfolioReturn).toBeGreaterThan(performance.benchmarkReturn);
    // 3 months, not the whole history.
    expect(performance.points.length).toBeLessThan(120);
  });

  it('downsamples long histories', () => {
    const long: ShareSource = { ...source, performance: Array.from({ length: 3000 }, (_, index) => ({ t: T0 + index * DAY, twr: 100 + index * 0.01, benchmark: 100 + index * 0.01 })) };
    const view = buildShareView(long, options({ range: 'ALL' }));
    expect(view.performance!.points.length).toBeLessThanOrEqual(261);
    expect(view.performance!.points[view.performance!.points.length - 1].t).toBe(T0 + 2999 * DAY);
  });

  it('omits performance when there is no history', () => {
    expect(buildShareView({ ...source, performance: null }, options()).performance).toBeNull();
    expect(buildShareView({ ...source, performance: [{ t: T0, twr: 100, benchmark: 100 }] }, options()).performance).toBeNull();
  });

  it('carries the owner name only when set', () => {
    expect(buildShareView(source, options()).owner).toBeNull();
    expect(buildShareView(source, options({ owner: '  Alex  ' })).owner).toBe('Alex');
    expect(buildShareView(source, options({ owner: '   ' })).owner).toBeNull();
  });

  it('includes bonds in the mix', () => {
    const view = buildShareView({ ...source, fixedIncome: 20_000 }, options());
    expect(view.allocation.find((slice) => slice.kind === 'bonds')?.weight).toBeCloseTo(20_000 / 120_000);
    expect(view.sectors.find((row) => row.sector === 'Bonds')).toBeDefined();
  });

  it('survives an empty portfolio', () => {
    const view = buildShareView({ ...source, holdings: [], cash: 0 }, options({ amounts: 'exact' }));
    expect(view.holdings).toEqual([]);
    expect(view.allocation).toEqual([]);
    expect(view.totals.gainPct).toBeNull();
  });
});

describe('normalizeShareOptions', () => {
  it('resolves contradictions', () => {
    const normalized = normalizeShareOptions(options({ amounts: 'scaled', shares: true, returns: false, detail: 'sectors' }));
    expect(normalized.shares).toBe(false);
    expect(normalized.sections.performance).toBe(false);
    expect(normalized.sections.holdings).toBe(false);
  });
});

describe('groupSlices', () => {
  it('folds the smallest slices into one', () => {
    const slices = Array.from({ length: 12 }, (_, index) => ({ label: `S${index}`, weight: (12 - index) / 78, kind: 'holding' as const }));
    const grouped = groupSlices(slices, 8);
    expect(grouped).toHaveLength(8);
    expect(grouped[7]).toMatchObject({ label: 'Other (5)', kind: 'other' });
    expect(grouped.reduce((sum, slice) => sum + slice.weight, 0)).toBeCloseTo(1);
  });
});

describe('shareSummaryText', () => {
  it('reflects the redaction', () => {
    const hidden = shareSummaryText(buildShareView(source, options({ amounts: 'hidden' })));
    expect(hidden).not.toContain('Value:');
    expect(hidden).toContain('Total gain');
    const exact = shareSummaryText(buildShareView(source, options({ amounts: 'exact' })));
    expect(exact).toContain('Value: $100,000');
  });
});

describe('weightLabel', () => {
  it('rounds normally and floors slivers', () => {
    expect(weightLabel(0.192)).toBe('19.2%');
    expect(weightLabel(0.01)).toBe('1.0%');
    expect(weightLabel(0.0012)).toBe('0.1%');
    expect(weightLabel(0.0003)).toBe('<0.1%');
    expect(weightLabel(0)).toBe('0.0%');
  });
});

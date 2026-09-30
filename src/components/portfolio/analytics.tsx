'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { ColumnChart } from '@/components/charts/svg';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader, Segmented, Skeleton, Stat } from '@/components/ui/primitives';
import { cite, SOURCES } from '@/lib/citation';
import { exportXlsx } from '@/lib/export-client';
import { money, pct } from '@/lib/format';
import { SERIES_COLORS } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Factors = {
  portfolio: null | { alpha: number; alphaT: number; loadings: Array<{ key: string; label: string; explain: string; beta: number; t: number }>; r2: number; days: number };
  holdings: Array<{ symbol: string; weight: number; loadings: Record<string, number> | null; r2: number | null }>;
  factors: Array<{ key: string; label: string }>;
  dataThrough: string | null;
  excluded: string[];
  source: string;
};
type Attribution = {
  rows: Array<{ segment: string; portfolioWeight: number; portfolioReturn: number; benchmarkWeight: number; benchmarkReturn: number; allocation: number; selection: number; interaction: number; total: number }>;
  portfolioReturn: number;
  benchmarkReturn: number;
  active: number;
  allocation: number;
  selection: number;
  interaction: number;
  spyReturn: number | null;
  method: string;
};
type Dividends = {
  rows: Array<{ symbol: string; name: string; shares: number; annualPerShare: number | null; annualIncome: number; yield: number | null; yieldOnCost: number | null; exDividendDate: string | null }>;
  months: Array<{ month: string; income: number; symbols: string[] }>;
  annualIncome: number;
  portfolioYield: number | null;
};

const signif = (t: number) => (Math.abs(t) >= 2.58 ? '***' : Math.abs(t) >= 1.96 ? '**' : Math.abs(t) >= 1.65 ? '*' : '');

function FactorPanel({ portfolioId }: { portfolioId: string }) {
  const { data } = useSWR<Factors>(`/api/portfolios/${portfolioId}/factors`);
  if (!data) return <Skeleton className="h-64" />;
  const model = data.portfolio;
  const download = () =>
    void exportXlsx('factor-exposure', [
      {
        name: 'Portfolio',
        title: 'Fama-French 5-factor + momentum regression of daily portfolio excess returns',
        columns: [{ header: 'Factor', key: 'label' }, { header: 'Loading', key: 'beta', format: 'number' }, { header: 't-stat', key: 't', format: 'number' }],
        rows: model ? [...model.loadings.map((row) => ({ label: row.label, beta: row.beta, t: row.t })), { label: 'Alpha (annualized)', beta: model.alpha, t: model.alphaT }, { label: 'R²', beta: model.r2, t: null }] : [],
        notes: [`${model?.days ?? 0} trading days, factor data through ${data.dataThrough ?? '—'}.`],
      },
      {
        name: 'Holdings',
        columns: [{ header: 'Symbol', key: 'symbol' }, { header: 'Weight', key: 'weight', format: 'percent' }, ...data.factors.map((factor) => ({ header: factor.label, key: factor.key, format: 'number' as const })), { header: 'R²', key: 'r2', format: 'number' }],
        rows: data.holdings.map((row) => ({ symbol: row.symbol, weight: row.weight, r2: row.r2, ...(row.loadings ?? {}) })),
      },
    ], [cite(SOURCES.french(), 'APA'), cite(SOURCES.prices(), 'APA')]);
  return (
    <Panel>
      <PanelHeader
        kicker={`Fama-French 5 + momentum · ${model?.days ?? 0} days · data through ${data.dataThrough ?? '—'}`}
        title="Factor exposure"
        actions={<Button size="xs" variant="outline" icon={<Download className="size-3" />} onClick={download}>Excel</Button>}
      />
      {model ? (
        <div className="grid gap-4 px-4 pb-4 lg:grid-cols-[1fr_260px]">
          <div className="flex flex-col gap-2">
            {model.loadings.map((row) => {
              const width = Math.min(50, Math.abs(row.beta) * (row.key === 'mktRf' ? 25 : 50));
              return (
                <div key={row.key} className="grid grid-cols-[140px_1fr_90px] items-center gap-3 text-[12px]" title={row.explain}>
                  <span className="text-ink-2">{row.label}</span>
                  <div className="relative h-3">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
                    <div className={cn('absolute inset-y-0.5 rounded-xs', row.beta >= 0 ? 'bg-brand/70' : 'bg-loss-fill/70')} style={row.beta >= 0 ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }} />
                  </div>
                  <span className="num text-right">
                    {row.beta.toFixed(2)} <span className="text-faint">t {row.t.toFixed(1)}{signif(row.t)}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Alpha (annualized)" value={<span className={model.alpha >= 0 ? 'text-gain' : 'text-loss'}>{pct(model.alpha)}</span>} sub={<span className="text-muted">t {model.alphaT.toFixed(2)}{signif(model.alphaT)}</span>} />
            <Stat label="R²" value={pct(model.r2, 0)} sub={<span className="text-muted">explained by factors</span>} />
          </div>
        </div>
      ) : (
        <p className="px-4 pb-4 text-[12px] text-muted">Not enough overlapping price history to estimate factor loadings.</p>
      )}
      <p className="px-4 pb-3 text-[11px] text-faint">* p&lt;0.10 · ** p&lt;0.05 · *** p&lt;0.01. Source: {data.source}. Loadings come from today&apos;s weights replayed over the window.</p>
    </Panel>
  );
}

function AttributionPanel({ portfolioId }: { portfolioId: string }) {
  const [days, setDays] = useState<'90' | '180' | '365' | '730'>('365');
  const { data } = useSWR<Attribution>(`/api/portfolios/${portfolioId}/attribution?days=${days}`);
  return (
    <Panel>
      <PanelHeader
        kicker="Brinson-Fachler vs S&P 500 sectors"
        title="Performance attribution"
        actions={<Segmented size="xs" value={days} onChange={setDays} options={[{ value: '90', label: '3M' }, { value: '180', label: '6M' }, { value: '365', label: '1Y' }, { value: '730', label: '2Y' }]} />}
      />
      {!data ? (
        <Skeleton className="mx-4 mb-4 h-48" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 px-4 pb-3 sm:grid-cols-5">
            <Stat label="Portfolio" value={pct(data.portfolioReturn)} />
            <Stat label="Benchmark" value={pct(data.benchmarkReturn)} sub={data.spyReturn !== null ? <span className="text-muted">SPY {pct(data.spyReturn)}</span> : undefined} />
            <Stat label="Allocation" value={<span className={data.allocation >= 0 ? 'text-gain' : 'text-loss'}>{pct(data.allocation, 2)}</span>} sub={<span className="text-muted">sector bets</span>} />
            <Stat label="Selection" value={<span className={data.selection >= 0 ? 'text-gain' : 'text-loss'}>{pct(data.selection, 2)}</span>} sub={<span className="text-muted">stock picks</span>} />
            <Stat label="Interaction" value={pct(data.interaction, 2)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-y border-line text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Sector</th>
                  <th className="px-2 py-2 text-right font-medium">Weight (you / S&amp;P)</th>
                  <th className="px-2 py-2 text-right font-medium">Return (you / sector)</th>
                  <th className="px-2 py-2 text-right font-medium">Allocation</th>
                  <th className="px-2 py-2 text-right font-medium">Selection</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.segment} className="border-b border-line">
                    <td className="px-4 py-1.5 text-ink-2">{row.segment}</td>
                    <td className="num px-2 py-1.5 text-right">
                      {pct(row.portfolioWeight, 0)} / {pct(row.benchmarkWeight, 0)}
                    </td>
                    <td className="num px-2 py-1.5 text-right">
                      {row.portfolioWeight ? pct(row.portfolioReturn) : '—'} / {pct(row.benchmarkReturn)}
                    </td>
                    <td className={cn('num px-2 py-1.5 text-right', row.allocation >= 0 ? 'text-gain' : 'text-loss')}>{pct(row.allocation, 2)}</td>
                    <td className={cn('num px-2 py-1.5 text-right', row.selection >= 0 ? 'text-gain' : 'text-loss')}>{pct(row.selection, 2)}</td>
                    <td className={cn('num px-4 py-1.5 text-right font-medium', row.total >= 0 ? 'text-gain' : 'text-loss')}>{pct(row.total, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[11px] text-faint">{data.method}</p>
        </>
      )}
    </Panel>
  );
}

function DividendPanel({ portfolioId }: { portfolioId: string }) {
  const { data } = useSWR<Dividends>(`/api/portfolios/${portfolioId}/dividends`);
  if (!data) return <Skeleton className="h-56" />;
  const payers = data.rows.filter((row) => row.annualIncome > 0);
  return (
    <Panel>
      <PanelHeader kicker="Indicated annual dividends" title="Dividend income" />
      <div className="grid grid-cols-2 gap-4 px-4 pb-3 sm:grid-cols-3">
        <Stat label="Next 12 months" value={money(data.annualIncome)} />
        <Stat label="Portfolio yield" value={data.portfolioYield === null ? '—' : pct(data.portfolioYield, 2)} />
        <Stat label="Payers" value={`${payers.length} of ${data.rows.length}`} />
      </div>
      <div className="grid gap-4 px-4 pb-4 lg:grid-cols-2">
        <ColumnChart categories={data.months.map((month) => new Date(`${month.month}-15`).toLocaleDateString('en-US', { month: 'short' }))} series={[{ label: 'Estimated income', values: data.months.map((month) => month.income), color: SERIES_COLORS[1] }]} format={(value) => `$${value.toFixed(0)}`} height={180} />
        <div className="max-h-[200px] overflow-auto">
          {payers.map((row) => (
            <div key={row.symbol} className="flex items-center justify-between border-t border-line py-1.5 text-[12px]">
              <span>
                <span className="font-mono font-semibold text-ink">{row.symbol}</span> <span className="text-muted">{row.exDividendDate ? `ex ${row.exDividendDate}` : ''}</span>
              </span>
              <span className="num">
                {money(row.annualIncome)} <span className="text-faint">· {row.yield === null ? '—' : pct(row.yield, 2)} · YoC {row.yieldOnCost === null ? '—' : pct(row.yieldOnCost, 2)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="px-4 pb-3 text-[11px] text-faint">Monthly timing assumes quarterly payments on each company&apos;s last ex-dividend cycle; amounts are before withholding tax.</p>
    </Panel>
  );
}

export function AnalyticsPanel({ portfolioId }: { portfolioId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <FactorPanel portfolioId={portfolioId} />
      <AttributionPanel portfolioId={portfolioId} />
      <DividendPanel portfolioId={portfolioId} />
    </div>
  );
}

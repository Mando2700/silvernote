'use client';

import { Download } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { EmptyState, Panel, PanelHeader, Skeleton, Stat } from '@/components/ui/primitives';
import { downloadFrom } from '@/lib/export-client';
import { cn } from '@/lib/utils';

type Report = {
  years: Array<{ year: number; proceedsPln: number; costPln: number; incomePln: number; lossDeductionPln: number; taxBasePln: number; taxPln: number }>;
  disposals: Array<{ saleId: string; symbol: string; bought: string; sold: string; quantity: number; buyRate: number; buyRateDate: string; sellRate: number; sellRateDate: string; proceedsPln: number; costPln: number; incomePln: number }>;
  unusedLosses: Array<{ year: number; amount: number; left: number; expires: number }>;
  missingRates: string[];
};

const pln = (value: number) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 }).format(value);

/** Polish PIT-38 view: FIFO lots in PLN at NBP D-1 rates, 19% on the year's net income. */
export function PolishTaxPanel({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading } = useSWR<Report>(`/api/portfolios/${portfolioId}/tax?jurisdiction=PL`);
  if (isLoading && !data) return <Skeleton className="h-72" />;
  if (!data?.years.length) return <EmptyState title="No disposals yet" body="Sales will appear here converted to PLN at the NBP rate from the business day before each trade, ready for PIT-38." />;
  const latest = data.years[data.years.length - 1];
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          kicker="PIT-38 · FIFO · kurs NBP z dnia poprzedzającego"
          title={`Rok podatkowy ${latest.year}`}
          actions={
            <Button size="xs" variant="outline" icon={<Download className="size-3" />} onClick={() => void downloadFrom(`/api/portfolios/${portfolioId}/tax?jurisdiction=PL&format=csv&year=${latest.year}`, `PIT-38-${latest.year}.csv`)}>
              CSV {latest.year}
            </Button>
          }
        />
        <div className="grid grid-cols-2 gap-4 px-4 pb-4 sm:grid-cols-5">
          <Stat label="Przychód (poz. 22)" value={pln(latest.proceedsPln)} />
          <Stat label="Koszty (poz. 23)" value={pln(latest.costPln)} />
          <Stat label={latest.incomePln >= 0 ? 'Dochód' : 'Strata'} value={<span className={latest.incomePln >= 0 ? 'text-gain' : 'text-loss'}>{pln(latest.incomePln)}</span>} />
          <Stat label="Podstawa po stratach" value={pln(latest.taxBasePln)} sub={latest.lossDeductionPln ? <span className="text-muted">−{pln(latest.lossDeductionPln)} straty</span> : undefined} />
          <Stat label="Podatek 19%" value={pln(latest.taxPln)} />
        </div>
        {data.missingRates.length ? <p className="px-4 pb-3 text-[11.5px] text-warning">No NBP rate found for: {data.missingRates.join(', ')}. Those trades are left out.</p> : null}
      </Panel>
      <Panel>
        <PanelHeader title="By year" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="border-y border-line text-left text-[11px] text-muted">
                <th className="px-4 py-2 font-medium">Year</th>
                <th className="px-2 py-2 text-right font-medium">Proceeds</th>
                <th className="px-2 py-2 text-right font-medium">Costs</th>
                <th className="px-2 py-2 text-right font-medium">Income</th>
                <th className="px-2 py-2 text-right font-medium">Loss used</th>
                <th className="px-4 py-2 text-right font-medium">Tax 19%</th>
              </tr>
            </thead>
            <tbody>
              {[...data.years].reverse().map((year) => (
                <tr key={year.year} className="border-b border-line">
                  <td className="px-4 py-1.5">{year.year}</td>
                  <td className="num px-2 py-1.5 text-right">{pln(year.proceedsPln)}</td>
                  <td className="num px-2 py-1.5 text-right">{pln(year.costPln)}</td>
                  <td className={cn('num px-2 py-1.5 text-right', year.incomePln >= 0 ? 'text-gain' : 'text-loss')}>{pln(year.incomePln)}</td>
                  <td className="num px-2 py-1.5 text-right">{year.lossDeductionPln ? pln(year.lossDeductionPln) : '—'}</td>
                  <td className="num px-4 py-1.5 text-right">{pln(year.taxPln)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.unusedLosses.length ? (
          <p className="px-4 py-2 text-[11.5px] text-muted">
            Losses to carry forward: {data.unusedLosses.map((loss) => `${loss.year}: ${pln(loss.left)} left (up to ${pln(loss.amount / 2)} a year, until ${loss.expires})`).join('; ')}.
          </p>
        ) : null}
      </Panel>
      <Panel>
        <PanelHeader kicker="Each FIFO lot matched to a sale" title="Disposals" />
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="border-y border-line text-left text-[11px] text-muted">
                <th className="px-4 py-2 font-medium">Symbol</th>
                <th className="px-2 py-2 text-right font-medium">Qty</th>
                <th className="px-2 py-2 font-medium">Bought · NBP</th>
                <th className="px-2 py-2 font-medium">Sold · NBP</th>
                <th className="px-2 py-2 text-right font-medium">Proceeds</th>
                <th className="px-2 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 text-right font-medium">Income</th>
              </tr>
            </thead>
            <tbody>
              {[...data.disposals].reverse().map((row, index) => (
                <tr key={`${row.saleId}-${index}`} className="border-b border-line">
                  <td className="px-4 py-1.5 font-mono font-semibold">{row.symbol}</td>
                  <td className="num px-2 py-1.5 text-right">{row.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                  <td className="num px-2 py-1.5 text-muted">
                    {row.bought} · {row.buyRate.toFixed(4)} ({row.buyRateDate})
                  </td>
                  <td className="num px-2 py-1.5 text-muted">
                    {row.sold} · {row.sellRate.toFixed(4)} ({row.sellRateDate})
                  </td>
                  <td className="num px-2 py-1.5 text-right">{pln(row.proceedsPln)}</td>
                  <td className="num px-2 py-1.5 text-right">{pln(row.costPln)}</td>
                  <td className={cn('num px-4 py-1.5 text-right', row.incomePln >= 0 ? 'text-gain' : 'text-loss')}>{pln(row.incomePln)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] leading-relaxed text-faint">
          Estimate for PIT-38 (and PIT/ZG for foreign income). Dividends are not in the trade ledger: declare them separately (19% minus the US withholding, usually 15% with a W-8BEN). Check against your broker&apos;s annual statement before filing.
        </p>
      </Panel>
    </div>
  );
}

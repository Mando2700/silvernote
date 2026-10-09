'use client';

import { AlertTriangle, CalendarClock, Download, Leaf, Scale } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Delta } from '@/components/motion/delta';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Select, Skeleton } from '@/components/ui/primitives';
import { StatTile } from '@/components/ui/stat-tile';
import { Button } from '@/components/ui/button';
import { api, revalidate } from '@/lib/client';
import { taxRulesFor } from '@/lib/finance/tax-rules';
import { money, pct, price, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type Term = 'short' | 'long';
type Lot = {
  id: string;
  symbol: string;
  purchased: string;
  acquired: string;
  quantity: number;
  costPerShare: number;
  washAdjustmentPerShare: number;
  price: number | null;
  marketValue: number | null;
  unrealized: number | null;
  term: Term;
  longTermOn: string | null;
  daysToLongTerm: number | null;
  estimated: boolean;
};
type Year = {
  year: number;
  shortGains: number;
  shortLosses: number;
  longGains: number;
  longLosses: number;
  washDisallowed: number;
  netShort: number;
  netLong: number;
  net: number;
  proceeds: number;
  tax: number;
  carryforward: number;
  carryIn: number;
};
type Disposal = { saleId: string; buyId: string; symbol: string; acquired: string; sold: string; quantity: number; proceeds: number; cost: number; gain: number; washDisallowed: number; reportable: number; term: Term; holdingDays: number; estimated: boolean };
type Harvest = {
  symbol: string;
  lots: Array<{ id: string; purchased: string; quantity: number; unrealized: number; term: Term }>;
  shares: number;
  loss: number;
  shortLoss: number;
  longLoss: number;
  estimatedSavings: number;
  washRiskShares: number;
  sellAfter: string | null;
  rebuyAfter: string | null;
  replacements: Array<{ symbol: string; name: string; score: number }>;
};
type Wait = { symbol: string; lotId: string; purchased: string; quantity: number; unrealized: number; longTermOn: string | null; daysToLongTerm: number | null; savings: number };
type WashSale = { saleId: string; symbol: string; sold: string; sharesWashed: number; disallowed: number; replacements: Array<{ buyId: string; purchased: string; shares: number }> };
type Report = {
  today: string;
  jurisdiction: string;
  method: 'fifo' | 'lifo' | 'hifo' | 'average';
  accountType: 'taxable' | 'tax_deferred' | 'tax_free';
  rates: { shortTerm: number; longTerm: number };
  lots: Lot[];
  unrealized: { shortGains: number; shortLosses: number; longGains: number; longLosses: number };
  years: Year[];
  thisYear: Year | null;
  disposals: Disposal[];
  washSales: WashSale[];
  harvest: Harvest[];
  waitForLongTerm: Wait[];
  unmatched: Array<{ saleId: string; symbol: string; sold: string; shares: number }>;
  estimatedLots: number;
  unpriced: string[];
};

const METHOD_LABEL: Record<Report['method'], string> = { fifo: 'FIFO', lifo: 'LIFO', hifo: 'HIFO', average: 'Average cost' };

const METHOD_HELP: Record<Report['method'], string> = {
  fifo: 'First in, first out: sells the oldest shares first (the usual default).',
  lifo: 'Last in, first out: sells the newest shares first.',
  hifo: 'Highest cost first: sells the most expensive shares first, usually the smallest taxable gain.',
  average: 'Every share of a holding carries the same pooled average cost.',
};

/** "one year", "three years", "six months". */
function holdingPeriod(months: number) {
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const [count, unit] = months % 12 === 0 ? [months / 12, 'year'] : [months, 'month'];
  return `${words[count] ?? count} ${unit}${count === 1 ? '' : 's'}`;
}

function TermBadge({ term }: { term: Term }) {
  return <Badge tone={term === 'long' ? 'brand' : 'neutral'}>{term === 'long' ? 'Long' : 'Short'}</Badge>;
}

function RateInput({ label, value, onSave }: { label: string; value: number; onSave: (value: number) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = async () => {
    if (draft === null) return;
    const parsed = Number(draft) / 100;
    setDraft(null);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0.7 || Math.abs(parsed - value) < 1e-9) return;
    await onSave(parsed);
  };
  return (
    <Field label={label}>
      <div className="relative">
        <Input
          inputMode="decimal"
          value={draft ?? (value * 100).toFixed(1).replace(/\.0$/, '')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
          className="pr-7"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] text-muted">%</span>
      </div>
    </Field>
  );
}

export function TaxPanel({ portfolioId, onPortfolioChanged }: { portfolioId: string; onPortfolioChanged: () => void }) {
  const { data, isLoading, mutate } = useSWR<Report>(`/api/portfolios/${portfolioId}/tax`);
  const [yearFilter, setYearFilter] = useState<string>('');
  const [lotFilter, setLotFilter] = useState<'all' | 'gains' | 'losses'>('all');

  const years = data?.years ?? [];
  const selectedYear = yearFilter || String(years[0]?.year ?? '');
  const disposals = useMemo(() => (data?.disposals ?? []).filter((disposal) => !selectedYear || disposal.sold.startsWith(`${selectedYear}-`)), [data, selectedYear]);
  const lots = useMemo(
    () => (data?.lots ?? []).filter((lot) => lotFilter === 'all' || (lotFilter === 'gains' ? (lot.unrealized ?? 0) >= 0 : (lot.unrealized ?? 0) < 0)),
    [data, lotFilter],
  );

  const updatePortfolio = async (patch: Record<string, string>) => {
    try {
      await api(`/api/portfolios/${portfolioId}`, { method: 'PATCH', body: patch });
      await mutate();
      onPortfolioChanged();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const saveRate = (key: 'taxShortRate' | 'taxLongRate') => async (value: number) => {
    try {
      await api('/api/settings', { method: 'PUT', body: { [key]: value } });
      await mutate();
      void revalidate('/api/settings');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  if (isLoading && !data) return <Skeleton className="h-72" />;
  if (!data) return null;

  const rules = taxRulesFor(data.jurisdiction);
  const isUs = rules.code === 'US';
  /** Whether the holding period changes the rate (otherwise every lot is "short" and one rate applies). */
  const terms = rules.longTermMonths !== null;
  const deferral = rules.lossDeferralName ?? 'Wash sale';
  const taxed = data.accountType === 'taxable';
  const harvestTotal = data.harvest.reduce((sum, idea) => sum + idea.loss, 0);
  const harvestSavings = data.harvest.reduce((sum, idea) => sum + idea.estimatedSavings, 0);
  const thisYear = data.thisYear;
  const currentYear = Number(data.today.slice(0, 4));

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          kicker={`Lot-level cost basis · ${rules.name} rules`}
          title="Tax settings"
          actions={
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="size-3.5" />}
              disabled={!data.disposals.length}
              onClick={() => {
                const link = document.createElement('a');
                link.href = `/api/portfolios/${portfolioId}/tax?format=csv${selectedYear ? `&year=${selectedYear}` : ''}`;
                link.download = '';
                link.click();
              }}
            >
              {rules.form} CSV{selectedYear ? ` · ${selectedYear}` : ''}
            </Button>
          }
        />
        <div className={cn('grid gap-3 px-4 pb-4', terms ? 'md:grid-cols-[1.3fr_1fr_0.6fr_0.6fr]' : 'md:grid-cols-[1.3fr_1fr_0.6fr]')}>
          <Field label="Account" hint={taxed ? 'Gains and losses are taxed when realized.' : 'Trades inside this account are not taxed; figures are for reference.'}>
            <Select value={data.accountType} onChange={(event) => void updatePortfolio({ account_type: event.target.value })}>
              <option value="taxable">Taxable brokerage</option>
              <option value="tax_deferred">{isUs ? 'Tax-deferred (Traditional IRA, 401k)' : 'Tax-deferred (pension account)'}</option>
              <option value="tax_free">{isUs ? 'Tax-free (Roth IRA, HSA)' : 'Tax-free (tax-sheltered savings account)'}</option>
            </Select>
          </Field>
          {rules.costBasis === 'choice' ? (
            <Field label="Lot relief method" hint={METHOD_HELP[data.method]}>
              <Segmented
                value={data.method}
                onChange={(method) => void updatePortfolio({ lot_method: method })}
                options={[
                  { value: 'fifo', label: 'FIFO' },
                  { value: 'lifo', label: 'LIFO' },
                  { value: 'hifo', label: 'HIFO' },
                ]}
              />
            </Field>
          ) : (
            <Field label="Cost basis method" hint={`${METHOD_HELP[data.method]} Required in ${rules.name}.`}>
              <div className="flex h-8 items-center">
                <Badge tone="neutral">{METHOD_LABEL[data.method]}</Badge>
              </div>
            </Field>
          )}
          {terms ? (
            <>
              <RateInput label="Short-term rate" value={data.rates.shortTerm} onSave={saveRate('taxShortRate')} />
              <RateInput label="Long-term rate" value={data.rates.longTerm} onSave={saveRate('taxLongRate')} />
            </>
          ) : (
            <RateInput label="Tax rate" value={data.rates.shortTerm} onSave={saveRate('taxShortRate')} />
          )}
        </div>
        <p className="mx-4 mb-4 text-[11.5px] leading-relaxed text-muted">{rules.note}</p>
        {!taxed ? (
          <div className="mx-4 mb-4 flex items-center gap-2 rounded-sm border border-line bg-surface-1 px-3 py-2 text-[12px] text-muted">
            <Scale className="size-3.5 shrink-0" />
            This is a tax-advantaged account: no capital-gains tax and no harvesting.
            {rules.lossDeferralDays !== null ? ` Buying back here after selling at a loss in a taxable account may still trigger the ${deferral.toLowerCase()} rule.` : ''}
          </div>
        ) : null}
        {data.unmatched.length || data.estimatedLots || data.unpriced.length ? (
          <div className="mx-4 mb-4 flex flex-col gap-1 rounded-sm border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-ink-2">
            {data.unmatched.map((sale) => (
              <span key={sale.saleId}>
                {sale.symbol} sale on {shortDate(sale.sold)} sold {sale.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} more shares than the ledger held; those shares are missing from the realized results. Add the missing buy.
              </span>
            ))}
            {data.estimatedLots ? (
              <span>
                {data.estimatedLots} lot{data.estimatedLots === 1 ? '' : 's'} come from broker opening balances. Their real purchase dates predate the synced history, so dates{terms ? ' (and short/long-term)' : ''} are estimates and the CSV reports them as VARIOUS. Check them against your broker’s cost-basis statement.
              </span>
            ) : null}
            {data.unpriced.length ? <span>No current price for {data.unpriced.join(', ')}: unrealized results and harvesting ideas leave them out.</span> : null}
          </div>
        ) : null}
      </Panel>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {terms ? (
          <>
            <StatTile label={`Realized ${currentYear} · short-term`} value={<Delta value={thisYear?.netShort ?? 0} kind="money" digits={0} className="text-[17px]" />} sub={<span className="text-muted">Taxed at {pct(data.rates.shortTerm, 0)}</span>} hint={`Net of losses${rules.lossDeferralDays !== null ? `, after ${deferral.toLowerCase()} adjustments` : ''}`} />
            <StatTile label={`Realized ${currentYear} · long-term`} value={<Delta value={thisYear?.netLong ?? 0} kind="money" digits={0} className="text-[17px]" />} sub={<span className="text-muted">Taxed at {pct(data.rates.longTerm, 0)}</span>} hint={`Held more than ${holdingPeriod(rules.longTermMonths ?? 12)}`} />
          </>
        ) : (
          <>
            <StatTile label={`Realized gains ${currentYear}`} value={<Delta value={(thisYear?.shortGains ?? 0) + (thisYear?.longGains ?? 0)} kind="money" digits={0} className="text-[17px]" />} sub={<span className="text-muted">Taxed at {pct(data.rates.shortTerm, 0)}</span>} />
            <StatTile label={`Realized losses ${currentYear}`} value={<Delta value={(thisYear?.shortLosses ?? 0) + (thisYear?.longLosses ?? 0)} kind="money" digits={0} className="text-[17px]" />} sub={<span className="text-muted">Net {money(thisYear?.net ?? 0, { digits: 0 })}</span>} hint={rules.lossDeferralDays !== null ? `After ${deferral.toLowerCase()} adjustments` : undefined} />
          </>
        )}
        <StatTile
          label={`Estimated tax ${currentYear}`}
          value={taxed ? money(thisYear?.tax ?? 0, { digits: 0 }) : '—'}
          sub={
            thisYear?.washDisallowed ? (
              <span className="text-muted">{money(thisYear.washDisallowed, { digits: 0 })} of losses deferred</span>
            ) : (
              <span className="text-muted">{isUs ? 'Federal, before other income' : 'Before allowances'}</span>
            )
          }
          hint={
            rules.ordinaryOffset
              ? `Losses net within and across terms; up to ${money(rules.ordinaryOffset, { digits: 0 })} of net loss offsets ordinary income`
              : 'Losses offset gains; unused losses carry forward'
          }
        />
        <StatTile
          label="Harvestable losses"
          value={<Delta value={harvestTotal} kind="money" digits={0} className="text-[17px]" />}
          sub={<span className="text-muted">≈ {money(harvestSavings, { digits: 0 })} tax saved</span>}
          hint="Unrealized losses in open lots, valued at your rates"
        />
      </div>
      {terms ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile label="Unrealized short-term gains" value={<Delta value={data.unrealized.shortGains} kind="money" digits={0} className="text-[17px]" />} />
          <StatTile label="Unrealized short-term losses" value={<Delta value={data.unrealized.shortLosses} kind="money" digits={0} className="text-[17px]" />} />
          <StatTile label="Unrealized long-term gains" value={<Delta value={data.unrealized.longGains} kind="money" digits={0} className="text-[17px]" />} />
          <StatTile label="Unrealized long-term losses" value={<Delta value={data.unrealized.longLosses} kind="money" digits={0} className="text-[17px]" />} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Unrealized gains" value={<Delta value={data.unrealized.shortGains} kind="money" digits={0} className="text-[17px]" />} />
          <StatTile label="Unrealized losses" value={<Delta value={data.unrealized.shortLosses} kind="money" digits={0} className="text-[17px]" />} />
        </div>
      )}

      {taxed && (data.harvest.length || data.waitForLongTerm.length) ? (
        <div className={cn('grid gap-4', terms && 'xl:grid-cols-[1.5fr_1fr]')}>
          <Panel>
            <PanelHeader kicker="Sell losers to offset gains" title="Tax-loss harvesting" actions={<Leaf className="size-4 text-muted" />} />
            {data.harvest.length ? (
              <div className="flex flex-col divide-y divide-line border-t border-line">
                {data.harvest.map((idea) => (
                  <div key={idea.symbol} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <CompanyLogo symbol={idea.symbol} size="xs" />
                        <Link href={`/company/${idea.symbol}`} className="font-mono text-[12.5px] font-semibold text-ink hover:text-white">
                          {idea.symbol}
                        </Link>
                        <span className="text-[12px] text-muted">
                          Sell {idea.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh
                          {data.method === 'average' ? '' : ` (${METHOD_LABEL[data.method]} relieves ${idea.lots.length === 1 ? 'this lot' : `these ${idea.lots.length} lots`})`}
                          {terms ? (
                            <>
                              {' · '}
                              {idea.shortLoss ? `${money(idea.shortLoss, { digits: 0 })} short` : ''}
                              {idea.shortLoss && idea.longLoss ? ' · ' : ''}
                              {idea.longLoss ? `${money(idea.longLoss, { digits: 0 })} long` : ''}
                            </>
                          ) : null}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                        {idea.rebuyAfter ? <span>Don’t rebuy {idea.symbol} before {shortDate(idea.rebuyAfter)}</span> : null}
                        {idea.washRiskShares > 0 && idea.sellAfter ? (
                          <span className="flex items-center gap-1 text-warning">
                            <AlertTriangle className="size-3" />
                            {idea.washRiskShares.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh bought in the last {rules.lossDeferralDays} days would defer this loss — sell after {shortDate(idea.sellAfter)}, or sell them too
                          </span>
                        ) : null}
                      </div>
                      {idea.replacements.length ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                          Keep the exposure with:
                          {idea.replacements.map((replacement) => (
                            <Link key={replacement.symbol} href={`/company/${replacement.symbol}`} title={`${replacement.name} · Score ${replacement.score}`} className="rounded-xs border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:border-white/20 hover:text-ink">
                              {replacement.symbol} <span className="text-faint">{replacement.score}</span>
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <Delta value={idea.loss} kind="money" digits={0} className="text-[14px]" />
                      <div className="text-[11.5px] text-muted">≈ {money(idea.estimatedSavings, { digits: 0 })} saved</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 pb-4 text-[12.5px] text-muted">No open lot has a loss worth harvesting.</p>
            )}
          </Panel>
          {terms ? (
          <Panel>
            <PanelHeader kicker="Short-term gains about to turn long-term" title="Worth waiting for" actions={<CalendarClock className="size-4 text-muted" />} />
            {data.waitForLongTerm.length ? (
              <div className="flex flex-col divide-y divide-line border-t border-line">
                {data.waitForLongTerm.map((idea) => (
                  <div key={idea.lotId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-ink">{idea.symbol}</span>
                        <span className="text-[11.5px] text-muted">
                          {idea.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh from {shortDate(idea.purchased)}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-muted">
                        Long-term on {shortDate(idea.longTermOn ?? '')} · {idea.daysToLongTerm} days
                      </div>
                    </div>
                    <div className="text-right">
                      <Delta value={idea.unrealized} kind="money" digits={0} className="text-[12.5px]" />
                      <div className="text-[11.5px] text-gain">wait saves {money(idea.savings, { digits: 0 })}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 pb-4 text-[12.5px] text-muted">No short-term gains turn long-term in the next 60 days.</p>
            )}
          </Panel>
          ) : null}
        </div>
      ) : null}

      <Panel>
        <PanelHeader
          kicker={`${data.lots.length} open lots · ${METHOD_LABEL[data.method]}`}
          title="Tax lots"
          actions={
            <Segmented
              size="xs"
              value={lotFilter}
              onChange={setLotFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'gains', label: 'Gains' },
                { value: 'losses', label: 'Losses' },
              ]}
            />
          }
        />
        {lots.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12.5px]">
              <thead>
                <tr className="border-y border-line bg-surface-1 text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Holding</th>
                  <th className="px-3 py-2 font-medium">Bought</th>
                  <th className="px-3 py-2 text-right font-medium">Shares</th>
                  <th className="px-3 py-2 text-right font-medium">Cost / share</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">Unrealized</th>
                  {terms ? (
                    <>
                      <th className="px-3 py-2 font-medium">Term</th>
                      <th className="px-3 py-2 font-medium">Long-term on</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id} className="border-b border-line">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <CompanyLogo symbol={lot.symbol} size="xs" />
                        <span className="font-mono text-[12px] font-semibold text-ink">{lot.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-2">
                      {shortDate(lot.purchased)}
                      {lot.washAdjustmentPerShare > 0 ? (
                        <span className="ml-1.5" title={`${deferral} replacement: +${price(lot.washAdjustmentPerShare)}/sh basis, holding period from ${shortDate(lot.acquired)}`}>
                          <Badge tone="warning">W</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="num px-3 py-2 text-right text-ink-2">{lot.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{price(lot.costPerShare)}</td>
                    <td className="num px-3 py-2 text-right text-ink">{money(lot.marketValue, { digits: 0 })}</td>
                    <td className="px-3 py-2 text-right">
                      <Delta value={lot.unrealized} kind="money" digits={0} className="justify-end text-[12px]" />
                    </td>
                    {terms ? (
                      <>
                        <td className="px-3 py-2">
                          <TermBadge term={lot.term} />
                        </td>
                        <td className="px-3 py-2 text-[12px] text-muted">{lot.term === 'long' || !lot.longTermOn ? '—' : `${shortDate(lot.longTermOn)} · ${lot.daysToLongTerm}d`}</td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No open lots" body="Buys you record appear here as tax lots." />
        )}
      </Panel>

      <Panel>
        <PanelHeader
          kicker={rules.lossDeferralDays !== null ? `Reportable figures include ${deferral.toLowerCase()} adjustments` : 'Reportable gains and losses'}
          title="Realized gains"
          actions={
            years.length ? (
              <Select value={selectedYear} onChange={(event) => setYearFilter(event.target.value)} className="w-28">
                {years.map((year) => (
                  <option key={year.year} value={year.year}>
                    {year.year}
                  </option>
                ))}
              </Select>
            ) : null
          }
        />
        {years.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12.5px]">
                <thead>
                  <tr className="border-y border-line bg-surface-1 text-right text-[11px] text-muted">
                    <th className="px-4 py-2 text-left font-medium">Year</th>
                    {terms ? (
                      <>
                        <th className="px-3 py-2 font-medium">Short gains</th>
                        <th className="px-3 py-2 font-medium">Short losses</th>
                        <th className="px-3 py-2 font-medium">Long gains</th>
                        <th className="px-3 py-2 font-medium">Long losses</th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-2 font-medium">Gains</th>
                        <th className="px-3 py-2 font-medium">Losses</th>
                      </>
                    )}
                    {rules.lossDeferralDays !== null ? <th className="px-3 py-2 font-medium">Deferred</th> : null}
                    <th className="px-3 py-2 font-medium">Net</th>
                    <th className="px-3 py-2 font-medium">Est. tax</th>
                    <th className="px-4 py-2 font-medium">Carryforward</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => (
                    <tr
                      key={year.year}
                      onClick={() => setYearFilter(String(year.year))}
                      className={cn('num cursor-pointer border-b border-line text-right hover:bg-white/[0.025]', String(year.year) === selectedYear && 'bg-white/[0.03]')}
                    >
                      <td className="px-4 py-2 text-left font-medium text-ink">{year.year}</td>
                      {terms ? (
                        <>
                          <td className="px-3 py-2 text-ink-2">{money(year.shortGains, { digits: 0 })}</td>
                          <td className="px-3 py-2 text-ink-2">{money(year.shortLosses, { digits: 0 })}</td>
                          <td className="px-3 py-2 text-ink-2">{money(year.longGains, { digits: 0 })}</td>
                          <td className="px-3 py-2 text-ink-2">{money(year.longLosses, { digits: 0 })}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-ink-2">{money(year.shortGains + year.longGains, { digits: 0 })}</td>
                          <td className="px-3 py-2 text-ink-2">{money(year.shortLosses + year.longLosses, { digits: 0 })}</td>
                        </>
                      )}
                      {rules.lossDeferralDays !== null ? <td className="px-3 py-2 text-muted">{year.washDisallowed ? money(year.washDisallowed, { digits: 0 }) : '—'}</td> : null}
                      <td className="px-3 py-2">
                        <Delta value={year.net} kind="money" digits={0} className="justify-end text-[12px]" />
                      </td>
                      <td className="px-3 py-2 text-ink">{taxed ? money(year.tax, { digits: 0 }) : '—'}</td>
                      <td className="px-4 py-2 text-muted" title={year.carryIn ? `${money(year.carryIn, { digits: 0 })} carried in from earlier years` : undefined}>
                        {year.carryforward ? money(year.carryforward, { digits: 0 }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-1 text-left text-[11px] text-muted">
                    <th className="px-4 py-2 font-medium">Sold {selectedYear}</th>
                    <th className="px-3 py-2 font-medium">Acquired</th>
                    <th className="px-3 py-2 text-right font-medium">Shares</th>
                    <th className="px-3 py-2 text-right font-medium">Proceeds</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                    {rules.lossDeferralDays !== null ? <th className="px-3 py-2 text-right font-medium">{isUs ? 'Wash adj.' : 'Deferred'}</th> : null}
                    <th className="px-3 py-2 text-right font-medium">Gain / loss</th>
                    {terms ? <th className="px-4 py-2 font-medium">Term</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {disposals.map((disposal, index) => (
                    <tr key={`${disposal.saleId}-${disposal.buyId}-${index}`} className="border-b border-line">
                      <td className="px-4 py-2">
                        <span className="font-mono text-[12px] font-semibold text-ink">{disposal.symbol}</span>
                        <span className="ml-2 text-ink-2">{shortDate(disposal.sold)}</span>
                      </td>
                      <td className="px-3 py-2 text-ink-2">{disposal.estimated ? `Various (by ${shortDate(disposal.acquired)})` : shortDate(disposal.acquired)}</td>
                      <td className="num px-3 py-2 text-right text-ink-2">{disposal.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                      <td className="num px-3 py-2 text-right text-ink-2">{money(disposal.proceeds, { digits: 2 })}</td>
                      <td className="num px-3 py-2 text-right text-ink-2">{money(disposal.cost, { digits: 2 })}</td>
                      {rules.lossDeferralDays !== null ? <td className="num px-3 py-2 text-right text-warning">{disposal.washDisallowed ? `W ${money(disposal.washDisallowed, { digits: 2 })}` : ''}</td> : null}
                      <td className="px-3 py-2 text-right">
                        <Delta value={disposal.reportable} kind="money" digits={2} className="justify-end text-[12px]" />
                      </td>
                      {terms ? (
                        <td className="px-4 py-2">
                          <TermBadge term={disposal.term} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="Nothing realized yet" body={terms ? 'Sales appear here lot by lot, split into short- and long-term.' : 'Sales appear here lot by lot.'} />
        )}
      </Panel>

      {data.washSales.length ? (
        <Panel>
          <PanelHeader kicker="Losses deferred into replacement shares" title={isUs ? 'Wash sales' : `${deferral} rule`} />
          <div className="flex flex-col divide-y divide-line border-t border-line">
            {data.washSales.map((event) => (
              <div key={event.saleId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12.5px]">
                <div>
                  <span className="font-mono font-semibold text-ink">{event.symbol}</span>
                  <span className="ml-2 text-ink-2">
                    sold {shortDate(event.sold)} · {event.sharesWashed.toLocaleString('en-US', { maximumFractionDigits: 4 })} sh washed by buys on{' '}
                    {[...new Set(event.replacements.map((replacement) => shortDate(replacement.purchased)))].join(', ')}
                  </span>
                </div>
                <span className="num text-warning">{money(event.disallowed, { digits: 2 })} disallowed → added to basis</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {isUs ? (
        <p className="px-1 text-[11px] leading-relaxed text-faint">
          Planning estimates, not tax advice. Wash sales are checked only within this portfolio, not across your other accounts or IRAs; options, dividends, return of capital,
          corporate actions and state tax are not modeled. Confirm figures against your broker’s 1099-B.
        </p>
      ) : (
        <p className="px-1 text-[11px] leading-relaxed text-faint">
          Planning estimates, not tax advice. Figures are in each holding’s trading currency; {rules.name} taxes them in local currency at the official exchange rate on each trade date,
          which this view doesn’t convert. Annual allowances, income-dependent bands, loss-carryforward limits, dividends, corporate actions and local surcharges are not modeled.
          {rules.lossDeferralDays !== null ? ` The ${deferral.toLowerCase()} rule is checked only within this portfolio.` : ''} Confirm figures against your broker’s annual tax statement.
        </p>
      )}
    </div>
  );
}

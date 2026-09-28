'use client';

import { ChevronRight, Info } from 'lucide-react';
import { motion } from 'motion/react';
import { Fragment, useMemo, useState } from 'react';
import useSWR from 'swr';

import { ColumnChart, LineChart, ScrollReveal, StackedColumns, Waterfall, type WaterfallStep } from '@/components/charts/svg';
import { Sparkline } from '@/components/motion/sparkline';
import { Badge, EmptyState, Panel, PanelHeader, Segmented, Skeleton, Tabs } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/overlay';
import { compactNumber, isNum, pct, relativeTime, signedPct } from '@/lib/format';
import { FEATURED, statementLayout, STATEMENT_TITLES, type LineDef } from '@/lib/finance/statement-layout';
import type { Frequency, LineItemKey, StandardizedStatements, StatementKind, StatementPeriod } from '@/lib/finance/statement-types';
import { luminance } from '@/lib/theme';
import { cn } from '@/lib/utils';

type View = 'visual' | 'table' | 'compare';

function value(period: StatementPeriod | undefined | null, key: LineItemKey): number | null {
  const raw = period?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function currencyPrefix(currency: string) {
  return currency === 'USD' ? '$' : `${currency} `;
}

export function formatLine(amount: number | null, def: Pick<LineDef, 'format'>, currency: string) {
  if (!isNum(amount)) return '—';
  switch (def.format) {
    case 'percent':
      return pct(amount, 1);
    case 'perShare':
      return `${amount < 0 ? '−' : ''}${currencyPrefix(currency)}${Math.abs(amount).toFixed(2)}`;
    case 'shares':
      return compactNumber(amount, 2);
    default:
      return `${amount < 0 ? '−' : ''}${currencyPrefix(currency)}${compactNumber(Math.abs(amount), Math.abs(amount) >= 1e9 ? 2 : 1)}`;
  }
}

function change(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Year-over-year comparator: previous fiscal year, or the same quarter a year earlier. */
function priorPeriod(periods: StatementPeriod[], period: StatementPeriod) {
  if (period.fiscalQuarter) return periods.find((item) => item.fiscalYear === period.fiscalYear - 1 && item.fiscalQuarter === period.fiscalQuarter) ?? null;
  return periods.find((item) => item.fiscalYear === period.fiscalYear - 1 && !item.fiscalQuarter) ?? null;
}

function ChangeChip({ delta, def, isMargin = false }: { delta: number | null; def: LineDef; isMargin?: boolean }) {
  if (delta === null || !Number.isFinite(delta)) return <span className="text-[11px] text-faint">—</span>;
  const better = def.better ?? 'higher';
  const good = better === 'neutral' ? null : better === 'higher' ? delta > 0 : delta < 0;
  const tone = good === null || delta === 0 ? 'text-muted' : good ? 'text-gain' : 'text-loss';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const text = isMargin ? `${sign}${Math.abs(delta * 100).toFixed(1)} pts` : `${sign}${Math.abs(delta * 100).toFixed(Math.abs(delta) >= 1 ? 0 : 1)}%`;
  return <span className={cn('num text-[11px] font-medium', tone)}>{text}</span>;
}

function summarySentence(kind: StatementKind, period: StatementPeriod, prior: StatementPeriod | null, currency: string) {
  const money = (amount: number | null) => formatLine(amount, { format: 'money' }, currency);
  const parts: string[] = [];
  if (kind === 'income') {
    const revenue = value(period, 'revenue');
    const growth = change(revenue, value(prior, 'revenue'));
    if (revenue !== null) parts.push(`${period.label} revenue ${growth === null ? 'was' : growth >= 0 ? `grew ${(growth * 100).toFixed(1)}% to` : `fell ${Math.abs(growth * 100).toFixed(1)}% to`} ${money(revenue)}`);
    const margin = value(period, 'netMargin');
    const priorMargin = value(prior, 'netMargin');
    if (margin !== null) {
      const delta = priorMargin !== null ? (margin - priorMargin) * 100 : null;
      parts.push(`net margin ${pct(margin)}${delta !== null ? ` (${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pts)` : ''}`);
    }
  } else if (kind === 'balance') {
    const cash = value(period, 'cash');
    const debt = value(period, 'totalDebt');
    const equity = value(period, 'totalEquity');
    if (cash !== null || debt !== null) {
      const net = (debt ?? 0) - (cash ?? 0);
      parts.push(net <= 0 ? `A net cash position of ${money(-net)}` : `Net debt of ${money(net)}`);
    }
    if (equity !== null) parts.push(`shareholders’ equity of ${money(equity)}`);
  } else {
    const fcf = value(period, 'freeCashFlow');
    const ocf = value(period, 'operatingCashFlow');
    if (ocf !== null) parts.push(`${period.label} operating cash flow of ${money(ocf)}`);
    if (fcf !== null) parts.push(`free cash flow of ${money(fcf)}${isNum(value(period, 'fcfMargin')) ? ` (${pct(value(period, 'fcfMargin'))} of revenue)` : ''}`);
    const returned = Math.abs(value(period, 'dividendsPaid') ?? 0) + Math.abs(value(period, 'buybacks') ?? 0);
    if (returned > 0) parts.push(`${money(returned)} returned to shareholders`);
  }
  if (!parts.length) return null;
  const sentence = parts.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

// ─── Visual views ───────────────────────────────────────────────────────────

function KpiCard({ def, periods, period, currency, onOpen }: { def: LineDef; periods: StatementPeriod[]; period: StatementPeriod; currency: string; onOpen: () => void }) {
  const current = value(period, def.key);
  const prior = priorPeriod(periods, period);
  const history = [...periods].reverse().map((item) => value(item, def.key)).filter((item): item is number => item !== null);
  return (
    <button onClick={onOpen} className="group flex flex-col gap-1.5 rounded-sm border border-line bg-surface-1 p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] text-muted">{def.label}</span>
        <ChevronRight className="size-3 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <span className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{formatLine(current, def, currency)}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="flex items-center gap-1 text-[10.5px] text-faint">
          <ChangeChip delta={change(current, value(prior, def.key))} def={def} /> YoY
        </span>
        <Sparkline values={history.slice(-12)} width={64} height={20} area={false} strokeWidth={1.25} color="#cdd4de" />
      </div>
    </button>
  );
}

function incomeCascade(period: StatementPeriod, isBank: boolean): WaterfallStep[] {
  if (isBank) {
    return [
      { label: 'Net interest inc.', value: value(period, 'netInterestIncome'), kind: 'start' },
      { label: 'Non-interest inc.', value: value(period, 'nonInterestIncome'), kind: 'delta' },
      { label: 'Revenue', value: value(period, 'revenue'), kind: 'total' },
      { label: 'Credit provision', value: isNum(value(period, 'provisionForCreditLosses')) ? -Math.abs(value(period, 'provisionForCreditLosses') as number) : null, kind: 'delta' },
      { label: 'Non-interest exp.', value: isNum(value(period, 'nonInterestExpense')) ? -Math.abs(value(period, 'nonInterestExpense') as number) : null, kind: 'delta' },
      { label: 'Pre-tax', value: value(period, 'pretaxIncome'), kind: 'total' },
      { label: 'Tax', value: isNum(value(period, 'taxExpense')) ? -(value(period, 'taxExpense') as number) : null, kind: 'delta' },
      { label: 'Net income', value: value(period, 'netIncome'), kind: 'total', emphasis: true },
    ];
  }
  const revenue = value(period, 'revenue');
  const gross = value(period, 'grossProfit');
  const operating = value(period, 'operatingIncome');
  const pretax = value(period, 'pretaxIncome');
  const net = value(period, 'netIncome');
  const rnd = value(period, 'researchAndDevelopment');
  const sga = value(period, 'sellingGeneralAdministrative');
  const steps: WaterfallStep[] = [{ label: 'Revenue', value: revenue, kind: 'start' }];
  if (revenue !== null && gross !== null) {
    steps.push({ label: 'Cost of revenue', value: gross - revenue, kind: 'delta' });
    steps.push({ label: 'Gross profit', value: gross, kind: 'total' });
  }
  const opBase = gross ?? revenue;
  if (opBase !== null && operating !== null) {
    let remainder = operating - opBase;
    if (rnd !== null) {
      steps.push({ label: 'R&D', value: -Math.abs(rnd), kind: 'delta' });
      remainder += Math.abs(rnd);
    }
    if (sga !== null) {
      steps.push({ label: 'SG&A', value: -Math.abs(sga), kind: 'delta' });
      remainder += Math.abs(sga);
    }
    if (Math.abs(remainder) > Math.abs(opBase) * 0.002) steps.push({ label: rnd !== null || sga !== null ? 'Other opex' : 'Operating costs', value: remainder, kind: 'delta' });
    steps.push({ label: 'Operating income', value: operating, kind: 'total' });
  }
  if (operating !== null && pretax !== null) {
    steps.push({ label: 'Interest & other', value: pretax - operating, kind: 'delta' });
    steps.push({ label: 'Pre-tax income', value: pretax, kind: 'total' });
  }
  if (pretax !== null && net !== null) steps.push({ label: 'Tax & other', value: net - pretax, kind: 'delta' });
  steps.push({ label: 'Net income', value: net, kind: 'total', emphasis: true });
  return steps;
}

function cashBridge(period: StatementPeriod): WaterfallStep[] {
  const ocf = value(period, 'operatingCashFlow');
  const capex = value(period, 'capex');
  const fcf = value(period, 'freeCashFlow');
  const dividends = value(period, 'dividendsPaid');
  const buybacks = value(period, 'buybacks');
  const acquisitions = value(period, 'acquisitions');
  const debt = (value(period, 'debtIssued') ?? 0) + (value(period, 'debtRepaid') ?? 0);
  const netChange = value(period, 'netChangeInCash');
  const steps: WaterfallStep[] = [
    { label: 'Operating CF', value: ocf, kind: 'start' },
    { label: 'Capex', value: capex !== null ? -Math.abs(capex) : null, kind: 'delta' },
    { label: 'Free cash flow', value: fcf, kind: 'total', emphasis: true },
  ];
  let accounted = fcf ?? 0;
  if (dividends) {
    steps.push({ label: 'Dividends', value: -Math.abs(dividends), kind: 'delta' });
    accounted -= Math.abs(dividends);
  }
  if (buybacks) {
    steps.push({ label: 'Buybacks', value: -Math.abs(buybacks), kind: 'delta' });
    accounted -= Math.abs(buybacks);
  }
  if (acquisitions) {
    steps.push({ label: 'Acquisitions', value: -Math.abs(acquisitions), kind: 'delta' });
    accounted -= Math.abs(acquisitions);
  }
  if (debt) {
    steps.push({ label: 'Net borrowing', value: debt, kind: 'delta' });
    accounted += debt;
  }
  if (netChange !== null) {
    const other = netChange - accounted;
    if (Math.abs(other) > Math.abs(ocf ?? 1) * 0.002) steps.push({ label: 'Other flows', value: other, kind: 'delta' });
    steps.push({ label: 'Change in cash', value: netChange, kind: 'total' });
  }
  return steps;
}

type Segment = { label: string; amount: number; color: string };

function EquationColumn({ title, segments, total, currency }: { title: string; segments: Segment[]; total: number; currency: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">{title}</span>
        <span className="num text-[12px] text-ink-2">{formatLine(total, { format: 'money' }, currency)}</span>
      </div>
      <div className="flex h-56 flex-col-reverse gap-[2px] overflow-hidden rounded-sm">
        {segments.map((segment, index) => {
          const share = total > 0 ? segment.amount / total : 0;
          return (
            <motion.div
              key={segment.label}
              className="group relative flex min-h-0 items-center justify-between rounded-[2px] px-2"
              style={{ background: segment.color }}
              initial={{ height: 0 }}
              animate={{ height: `${share * 100}%` }}
              transition={{ duration: 0.8, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
              title={`${segment.label}: ${formatLine(segment.amount, { format: 'money' }, currency)} (${pct(share)})`}
            >
              {share > 0.075 ? (
                <>
                  <span className={cn('truncate text-[10.5px] font-medium', luminance(segment.color) > 0.4 ? 'text-[#0b0c0f]' : 'text-white/90')}>{segment.label}</span>
                  <span className={cn('num text-[10.5px]', luminance(segment.color) > 0.4 ? 'text-[#0b0c0f]/75' : 'text-white/80')}>{pct(share, 0)}</span>
                </>
              ) : null}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function BalanceEquation({ period, currency, isBank }: { period: StatementPeriod; currency: string; isBank: boolean }) {
  const v = (key: LineItemKey) => Math.max(0, value(period, key) ?? 0);
  const totalAssets = v('totalAssets');
  const totalLiabilities = v('totalLiabilities');
  const equity = value(period, 'totalEquity') ?? totalAssets - totalLiabilities;
  if (!totalAssets) return null;
  const assetParts: Segment[] = isBank
    ? [
        { label: 'Cash', amount: v('cash'), color: '#3987e5' },
        { label: 'Loans', amount: v('loans'), color: '#c98500' },
        { label: 'Securities', amount: v('longTermInvestments'), color: '#d55181' },
      ]
    : [
        { label: 'Cash & investments', amount: v('cash') + v('shortTermInvestments'), color: '#3987e5' },
        { label: 'Receivables', amount: v('receivables'), color: '#c98500' },
        { label: 'Inventory', amount: v('inventory'), color: '#d55181' },
        { label: 'PP&E', amount: v('propertyPlantEquipment'), color: '#9085e9' },
        { label: 'Goodwill & intangibles', amount: v('goodwill') + v('intangibleAssets'), color: '#199e70' },
      ];
  const assetKnown = assetParts.reduce((sum, part) => sum + part.amount, 0);
  if (totalAssets - assetKnown > 0) assetParts.push({ label: 'Other assets', amount: totalAssets - assetKnown, color: '#3a3f49' });
  const liabilityParts: Segment[] = [];
  const debt = v('totalDebt');
  const deposits = isBank ? v('deposits') : 0;
  if (deposits) liabilityParts.push({ label: 'Deposits', amount: deposits, color: '#d55181' });
  if (debt) liabilityParts.push({ label: 'Debt', amount: debt, color: '#9085e9' });
  const otherLiabilities = Math.max(0, totalLiabilities - debt - deposits);
  if (otherLiabilities) liabilityParts.push({ label: 'Other liabilities', amount: otherLiabilities, color: '#3a3f49' });
  if (equity > 0) liabilityParts.push({ label: 'Equity', amount: equity, color: '#cdd4de' });
  const fundingTotal = liabilityParts.reduce((sum, part) => sum + part.amount, 0);
  return (
    <div className="flex items-stretch gap-4">
      <EquationColumn title="What it owns" segments={assetParts} total={totalAssets} currency={currency} />
      <div className="flex items-center pt-6 font-mono text-[18px] text-faint">=</div>
      <EquationColumn title="How it’s funded" segments={liabilityParts} total={fundingTotal} currency={currency} />
    </div>
  );
}

function VisualView({
  kind,
  periods,
  period,
  currency,
  isBank,
  frequency,
  onOpenLine,
}: {
  kind: StatementKind;
  periods: StatementPeriod[];
  period: StatementPeriod;
  currency: string;
  isBank: boolean;
  frequency: Frequency;
  onOpenLine: (def: LineDef) => void;
}) {
  const layout = statementLayout(kind, isBank);
  const featured = FEATURED[kind]
    .map((key) => layout.find((def) => def.key === key))
    .filter((def): def is LineDef => Boolean(def) && value(period, (def as LineDef).key) !== null)
    .slice(0, 5);
  const chronological = [...periods].reverse().slice(-(frequency === 'annual' ? 10 : 12));
  const categories = chronological.map((item) => item.label);
  const money = (amount: number) => formatLine(amount, { format: 'money' }, currency);
  const series = (key: LineItemKey) => chronological.map((item) => value(item, key));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {featured.map((def) => (
          <KpiCard key={def.key} def={def} periods={periods} period={period} currency={currency} onOpen={() => onOpenLine(def)} />
        ))}
      </div>

      {kind === 'income' ? (
        <>
          <div className="rounded-sm border border-line bg-surface-1 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-ink">Profit cascade · {period.label}</span>
              <span className="text-[11px] text-faint">From revenue to net income</span>
            </div>
            <ScrollReveal>
              <Waterfall steps={incomeCascade(period, isBank)} format={money} height={250} />
            </ScrollReveal>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-sm border border-line bg-surface-1 p-4">
              <div className="mb-3 text-[12.5px] font-medium text-ink">Revenue and net income</div>
              <ScrollReveal>
                <ColumnChart categories={categories} series={[{ label: 'Revenue', values: series('revenue') }, { label: 'Net income', values: series('netIncome') }]} format={money} />
              </ScrollReveal>
            </div>
            <div className="rounded-sm border border-line bg-surface-1 p-4">
              <div className="mb-3 text-[12.5px] font-medium text-ink">Margins</div>
              <ScrollReveal>
                <LineChart
                  categories={categories}
                  series={
                    isBank
                      ? [{ label: 'Net margin', values: series('netMargin') }]
                      : [
                          { label: 'Gross', values: series('grossMargin') },
                          { label: 'Operating', values: series('operatingMargin') },
                          { label: 'Net', values: series('netMargin') },
                        ]
                  }
                  format={(amount) => pct(amount, 0)}
                  height={220}
                  zeroLine
                />
              </ScrollReveal>
            </div>
          </div>
        </>
      ) : null}

      {kind === 'balance' ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
            <div className="rounded-sm border border-line bg-surface-1 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-ink">Balance sheet equation · {period.label}</span>
                <span className="text-[11px] text-faint">Assets = liabilities + equity</span>
              </div>
              <BalanceEquation period={period} currency={currency} isBank={isBank} />
            </div>
            <div className="grid content-start gap-2 sm:grid-cols-2">
              {[
                { label: 'Current ratio', value: isNum(value(period, 'currentAssets')) && isNum(value(period, 'currentLiabilities')) ? `${((value(period, 'currentAssets') as number) / (value(period, 'currentLiabilities') as number)).toFixed(2)}×` : '—', hint: 'Current assets ÷ current liabilities' },
                { label: 'Debt to equity', value: isNum(value(period, 'totalDebt')) && (value(period, 'totalEquity') ?? 0) > 0 ? `${((value(period, 'totalDebt') as number) / (value(period, 'totalEquity') as number)).toFixed(2)}×` : '—', hint: 'Total debt ÷ shareholders’ equity' },
                { label: 'Equity / assets', value: isNum(value(period, 'totalEquity')) && value(period, 'totalAssets') ? pct((value(period, 'totalEquity') as number) / (value(period, 'totalAssets') as number)) : '—', hint: 'Share of the balance sheet funded by owners' },
                { label: 'Net debt', value: formatLine(value(period, 'netDebt'), { format: 'money' }, currency), hint: 'Total debt minus cash; negative is net cash' },
              ].map((item) => (
                <div key={item.label} className="rounded-sm border border-line bg-surface-1 p-3">
                  <div className="text-[11.5px] text-muted">{item.label}</div>
                  <div className="mt-1 text-[17px] font-semibold text-ink">{item.value}</div>
                  <div className="mt-1 text-[10.5px] text-faint">{item.hint}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-sm border border-line bg-surface-1 p-4">
              <div className="mb-3 text-[12.5px] font-medium text-ink">Funding mix over time</div>
              <ScrollReveal>
                <StackedColumns
                  categories={categories}
                  normalize
                  segments={[
                    { label: 'Debt', values: series('totalDebt'), color: '#9085e9' },
                    { label: 'Other liabilities', values: chronological.map((item) => Math.max(0, (value(item, 'totalLiabilities') ?? 0) - (value(item, 'totalDebt') ?? 0))), color: '#3a3f49' },
                    { label: 'Equity', values: chronological.map((item) => Math.max(0, value(item, 'totalEquity') ?? 0)), color: '#cdd4de' },
                  ]}
                  format={money}
                />
              </ScrollReveal>
            </div>
            <div className="rounded-sm border border-line bg-surface-1 p-4">
              <div className="mb-3 text-[12.5px] font-medium text-ink">Cash vs. debt</div>
              <ScrollReveal>
                <ColumnChart categories={categories} series={[{ label: 'Cash', values: series('cash') }, { label: 'Total debt', values: series('totalDebt') }]} format={money} />
              </ScrollReveal>
            </div>
          </div>
        </>
      ) : null}

      {kind === 'cashflow' ? (
        <>
          <div className="rounded-sm border border-line bg-surface-1 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-ink">Where the cash went · {period.label}</span>
              <span className="text-[11px] text-faint">Operating cash → free cash flow → uses</span>
            </div>
            <ScrollReveal>
              <Waterfall steps={cashBridge(period)} format={money} height={250} />
            </ScrollReveal>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-sm border border-line bg-surface-1 p-4">
              <div className="mb-3 text-[12.5px] font-medium text-ink">Operating cash flow, capex and FCF</div>
              <ScrollReveal>
                <ColumnChart
                  categories={categories}
                  series={[
                    { label: 'Operating CF', values: series('operatingCashFlow') },
                    { label: 'Capex', values: chronological.map((item) => (isNum(value(item, 'capex')) ? Math.abs(value(item, 'capex') as number) : null)) },
                    { label: 'Free cash flow', values: series('freeCashFlow') },
                  ]}
                  format={money}
                />
              </ScrollReveal>
            </div>
            <div className="rounded-sm border border-line bg-surface-1 p-4">
              <div className="mb-3 text-[12.5px] font-medium text-ink">Shareholder returns</div>
              <ScrollReveal>
                <StackedColumns
                  categories={categories}
                  segments={[
                    { label: 'Dividends', values: chronological.map((item) => Math.abs(value(item, 'dividendsPaid') ?? 0)), color: '#3987e5' },
                    { label: 'Buybacks', values: chronological.map((item) => Math.abs(value(item, 'buybacks') ?? 0)), color: '#cdd4de' },
                  ]}
                  format={money}
                />
              </ScrollReveal>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── Table & compare views ─────────────────────────────────────────────────

function StatementTable({
  layout,
  periods,
  columns,
  currency,
  onOpenLine,
  compare = false,
}: {
  layout: LineDef[];
  periods: StatementPeriod[];
  columns: StatementPeriod[];
  currency: string;
  onOpenLine: (def: LineDef) => void;
  compare?: boolean;
}) {
  const rows = layout.filter((def) => columns.some((period) => value(period, def.key) !== null));
  return (
    <div className="overflow-x-auto rounded-sm border border-line">
      <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-surface-1">
            <th className="sticky left-0 z-10 bg-surface-1 px-3 py-2 text-left font-medium text-muted">Line item</th>
            {columns.map((period) => (
              <th key={period.key} className="px-3 py-2 text-right font-mono text-[11px] font-medium text-muted">
                {period.label}
                <div className="text-[9.5px] font-normal text-faint">{period.periodEnd}</div>
              </th>
            ))}
            {!compare ? <th className="px-3 py-2 text-right font-medium text-muted">YoY</th> : null}
            {!compare ? <th className="px-3 py-2 text-right font-medium text-muted">Trend</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((def) => {
            const latest = columns[0];
            const prior = latest ? priorPeriod(periods, latest) : null;
            const history = [...periods].reverse().map((period) => value(period, def.key)).filter((item): item is number => item !== null);
            return (
              <Fragment key={def.key}>
                {def.section ? (
                  <tr>
                    <td colSpan={columns.length + 3} className="bg-surface-2 px-3 pt-3 pb-1 font-mono text-[10px] tracking-[0.12em] text-brand-soft uppercase">
                      {def.section}
                    </td>
                  </tr>
                ) : null}
                <tr onClick={() => onOpenLine(def)} className="group cursor-pointer border-t border-line hover:bg-white/[0.025]">
                  <td className={cn('sticky left-0 z-10 bg-surface-2 px-3 py-1.5 group-hover:bg-[#13161b]', def.primary ? 'font-semibold text-ink' : 'text-ink-2')} style={{ paddingLeft: 12 + (def.indent ?? 0) * 14 }}>
                    {def.label}
                    {periods.some((period) => period.derived?.includes(def.key)) ? <span className="ml-1.5 align-middle text-[9px] text-faint" title="Some quarters are derived from year-to-date filings">◆</span> : null}
                  </td>
                  {columns.map((period, index) => {
                    const amount = value(period, def.key);
                    const next = columns[index + 1];
                    const delta = compare && next ? (def.format === 'percent' ? (amount !== null && value(next, def.key) !== null ? (amount as number) - (value(next, def.key) as number) : null) : change(amount, value(next, def.key))) : null;
                    return (
                      <td key={period.key} className={cn('num px-3 py-1.5 text-right', def.primary ? 'font-semibold text-ink' : 'text-ink-2', amount !== null && amount < 0 && 'text-muted')}>
                        {formatLine(amount, def, currency)}
                        {compare && next ? (
                          <div>
                            <ChangeChip delta={delta} def={def} isMargin={def.format === 'percent'} />
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                  {!compare ? (
                    <td className="px-3 py-1.5 text-right">
                      <ChangeChip
                        delta={def.format === 'percent' ? (value(latest, def.key) !== null && value(prior, def.key) !== null ? (value(latest, def.key) as number) - (value(prior, def.key) as number) : null) : change(value(latest, def.key), value(prior, def.key))}
                        def={def}
                        isMargin={def.format === 'percent'}
                      />
                    </td>
                  ) : null}
                  {!compare ? (
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end">
                        <Sparkline values={history.slice(-12)} width={72} height={18} area={false} strokeWidth={1.2} color={def.primary ? '#cdd4de' : '#858a95'} />
                      </div>
                    </td>
                  ) : null}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Growth = { text: string; note: string };

/**
 * Multi-year growth for a line. Compounding is an annual idea, so it reads annual statements even when the
 * table shows quarters; companies with too few annual filings fall back to the same quarter N years earlier.
 * Margins get the change in points; a base at or below zero has no CAGR, so the change is shown instead.
 */
function lineGrowth(def: LineDef, statements: StandardizedStatements, years: number): Growth {
  const pick = (periods: StatementPeriod[]) => {
    const end = periods.find((period) => value(period, def.key) !== null);
    if (!end) return null;
    const start = periods.find((period) => period.fiscalYear === end.fiscalYear - years && period.fiscalQuarter === end.fiscalQuarter && value(period, def.key) !== null);
    return start ? { end, start } : null;
  };
  const pair = pick(statements.annual) ?? pick(statements.quarterly);
  if (!pair) {
    const available = statements.annual.filter((period) => value(period, def.key) !== null).length;
    return { text: 'n/a', note: available ? `Only ${available} year${available === 1 ? '' : 's'} reported` : 'Not reported' };
  }
  const latest = value(pair.end, def.key) as number;
  const base = value(pair.start, def.key) as number;
  const note = `${pair.start.label} → ${pair.end.label}`;
  if (def.format === 'percent') {
    const delta = latest - base;
    return { text: `${delta >= 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(1)} pts`, note };
  }
  // Outflows and losses are stored negative: when both ends are negative, compound the magnitude.
  if ((latest > 0 && base > 0) || (latest < 0 && base < 0)) {
    return { text: signedPct((Math.abs(latest) / Math.abs(base)) ** (1 / years) - 1, 1), note: latest < 0 ? `${note} · size of outflow` : note };
  }
  return { text: formatLine(latest - base, def, statements.currency).replace(/^(?!−)/, '+'), note: `${note} · change (no CAGR across zero)` };
}

function LineDetail({ def, statements, frequency, onClose }: { def: LineDef | null; statements: StandardizedStatements; frequency: Frequency; onClose: () => void }) {
  const periods = frequency === 'annual' ? statements.annual : statements.quarterly;
  const chronological = [...periods].reverse();
  const values = def ? chronological.map((period) => value(period, def.key)) : [];
  const latest = def ? (periods.map((period) => value(period, def.key)).find((item) => item !== null) ?? null) : null;
  const growth = def ? ([3, 5] as const).map((years) => ({ years, ...lineGrowth(def, statements, years) })) : [];
  return (
    <Drawer open={Boolean(def)} onClose={onClose} title={def?.label} width={520}>
      {def ? (
        <div className="flex flex-col gap-4 p-4">
          <p className="text-[12.5px] leading-relaxed text-ink-2">{def.meaning}</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-sm border border-line bg-surface-1 p-2.5">
              <div className="text-[11px] text-muted">Latest</div>
              <div className="mt-0.5 text-[15px] font-semibold text-ink">{formatLine(latest, def, statements.currency)}</div>
            </div>
            {growth.map((item) => (
              <div key={item.years} className="rounded-sm border border-line bg-surface-1 p-2.5">
                <div className="text-[11px] text-muted">{item.years}-year {def.format === 'percent' ? 'change' : 'CAGR'}</div>
                <div className="mt-0.5 text-[15px] font-semibold text-ink">{item.text}</div>
                <div className="mt-0.5 truncate text-[10px] text-faint" title={item.note}>{item.note}</div>
              </div>
            ))}
          </div>
          <ColumnChart
            categories={chronological.map((period) => period.label)}
            series={[{ label: def.label, values }]}
            format={(amount) => formatLine(amount, def, statements.currency)}
            height={240}
            highlightLast
          />
          <div className="overflow-hidden rounded-sm border border-line">
            <table className="w-full text-[12px]">
              <tbody>
                {[...chronological].reverse().map((period) => (
                  <tr key={period.key} className="border-t border-line first:border-0">
                    <td className="px-3 py-1.5 font-mono text-[11px] text-muted">{period.label}</td>
                    <td className="px-3 py-1.5 text-[11px] text-faint">{period.periodEnd}</td>
                    <td className="num px-3 py-1.5 text-right text-ink">{formatLine(value(period, def.key), def, statements.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

export function Financials({ symbol, isBank }: { symbol: string; isBank: boolean }) {
  const { data, isLoading } = useSWR<StandardizedStatements>(`/api/company/${symbol}/statements`);
  const [kind, setKind] = useState<StatementKind>('income');
  const [frequency, setFrequency] = useState<Frequency>('annual');
  const [view, setView] = useState<View>('visual');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const [detail, setDetail] = useState<LineDef | null>(null);

  const periods = useMemo(() => (data ? (frequency === 'annual' ? data.annual : data.quarterly) : []), [data, frequency]);
  const period = periods.find((item) => item.key === selectedKey) ?? periods[0];
  const layout = statementLayout(kind, isBank);
  const currency = data?.currency ?? 'USD';

  if (isLoading && !data) {
    return (
      <Panel className="p-4">
        <Skeleton className="mb-3 h-6 w-64" />
        <Skeleton className="h-72 w-full" />
      </Panel>
    );
  }
  if (!data || (!data.annual.length && !data.quarterly.length)) {
    return (
      <Panel>
        <EmptyState icon={<Info className="size-4" />} title="No financial statements available" body="This company has no structured XBRL filings with the SEC (common for funds, SPACs and some foreign issuers). Add an FMP key in Settings to fill gaps." />
      </Panel>
    );
  }

  const compareColumns = compareKeys.length ? periods.filter((item) => compareKeys.includes(item.key)) : periods.slice(0, 3);
  const prior = period ? priorPeriod(periods, period) : null;
  const sentence = period ? summarySentence(kind, period, prior, currency) : null;

  return (
    <Panel>
      <PanelHeader
        kicker={`Source: ${data.source === 'sec' ? 'SEC XBRL filings' : data.source === 'fmp' ? 'Financial Modeling Prep' : 'SEC frames'} · updated ${relativeTime(data.fetchedAt)}`}
        title="Financial statements"
        actions={
          <Segmented
            value={frequency}
            onChange={(next) => {
              setFrequency(next);
              setSelectedKey(null);
              setCompareKeys([]);
            }}
            options={[
              { value: 'annual', label: 'Annual' },
              { value: 'quarterly', label: 'Quarterly' },
            ]}
          />
        }
      >
        {currency !== 'USD' ? <Badge tone="outline" className="mt-2">Figures in {currency} as reported</Badge> : null}
      </PanelHeader>

      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line px-4">
        <Tabs
          value={kind}
          onChange={setKind}
          tabs={(['income', 'balance', 'cashflow'] as const).map((item) => ({ value: item, label: STATEMENT_TITLES[item] }))}
        />
        <Segmented
          size="xs"
          value={view}
          onChange={setView}
          options={[
            { value: 'visual', label: 'Visual' },
            { value: 'table', label: 'Table' },
            { value: 'compare', label: 'Compare' },
          ]}
        />
      </div>

      <div className="flex flex-col gap-4 p-4">
        {frequency === 'quarterly' && !periods.length ? (
          <EmptyState title="No quarterly filings" body="This company files annually (for example a 20-F filer)." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-muted">{view === 'compare' ? 'Compare periods' : frequency === 'annual' ? 'Fiscal year' : 'Quarter'}</span>
              {periods.slice(0, frequency === 'annual' ? 10 : 12).map((item) => {
                const active = view === 'compare' ? compareColumns.some((column) => column.key === item.key) : item.key === period?.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      if (view === 'compare') {
                        setCompareKeys((keys) => {
                          const base = keys.length ? keys : compareColumns.map((column) => column.key);
                          return base.includes(item.key) ? base.filter((key) => key !== item.key) : [...base, item.key].slice(-5);
                        });
                      } else {
                        setSelectedKey(item.key);
                      }
                    }}
                    className={cn(
                      'h-6 rounded-xs border px-2 font-mono text-[11px] transition-colors',
                      active ? 'border-brand/60 bg-brand-wash text-ink shadow-[0_0_12px_-4px_rgba(205,212,222,0.48)]' : 'border-line text-muted hover:border-line-strong hover:text-ink-2',
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {sentence && view !== 'compare' ? <p className="text-[13px] leading-relaxed text-ink-2">{sentence}</p> : null}

            {view === 'visual' && period ? (
              <VisualView kind={kind} periods={periods} period={period} currency={currency} isBank={isBank} frequency={frequency} onOpenLine={setDetail} />
            ) : null}
            {view === 'table' ? <StatementTable layout={layout} periods={periods} columns={periods.slice(0, frequency === 'annual' ? 8 : 10)} currency={currency} onOpenLine={setDetail} /> : null}
            {view === 'compare' ? (
              <StatementTable
                layout={layout}
                periods={periods}
                columns={[...compareColumns].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))}
                currency={currency}
                onOpenLine={setDetail}
                compare
              />
            ) : null}
            {frequency === 'quarterly' && periods.some((item) => item.derived?.length) ? (
              <p className="text-[11px] text-faint">◆ Fourth quarters and some cash-flow quarters are derived from annual and year-to-date filings.</p>
            ) : null}
          </>
        )}
      </div>
      <LineDetail def={detail} statements={data} frequency={frequency} onClose={() => setDetail(null)} />
    </Panel>
  );
}

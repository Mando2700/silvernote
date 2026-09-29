'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { TweenedColumnChart as ColumnChart } from '@/components/learn/animated-charts';
import { AskGrok, DataState, Readout, Slider, TickerPicker, Widget } from '@/components/learn/blocks';
import { useDcfInputs, usePeers } from '@/components/learn/hooks';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Segmented } from '@/components/ui/primitives';
import { applyLever, fade, runDcf, sensitivity, solveForPerShare, waccFromInputs, type DcfAssumptions } from '@/lib/finance/dcf';
import { money, multiple, pct, price as fmtPrice, signedPct } from '@/lib/format';
import type { DcfInputs } from '@/lib/services/dcf';
import { cn } from '@/lib/utils';

const YEARS = 5;

/** The platform's default DCF for a company, with a few levers exposed. */
function baseAssumptions(data: DcfInputs, levers: { growth: number; margin: number; wacc: number; terminal: number }): DcfAssumptions {
  const d = data.defaults;
  return {
    baseRevenue: data.baseRevenue ?? 0,
    growth: fade(levers.growth, levers.terminal, YEARS),
    ebitMargin: fade(d.ebitMargin, levers.margin, YEARS),
    taxRate: d.taxRate,
    daPctRevenue: d.daPct,
    capexPctRevenue: d.capexPct,
    nwcPctRevenue: d.nwcPct,
    sbcPctRevenue: d.sbcPct,
    deductSbc: true,
    wacc: levers.wacc,
    terminalGrowth: levers.terminal,
    midYear: true,
    cash: data.bridge.cash,
    debt: data.bridge.debt,
    leases: data.bridge.leases ?? 0,
    includeLeases: true,
    minorityInterest: data.bridge.minorityInterest ?? 0,
    preferredStock: data.bridge.preferredStock ?? 0,
    shares: data.bridge.shares ?? 0,
  };
}

function defaultWacc(data: DcfInputs) {
  const debt = data.bridge.debt * (data.fxToUsd ?? 1);
  return waccFromInputs({
    riskFree: data.market.riskFree,
    beta: data.market.beta,
    equityRiskPremium: data.market.equityRiskPremium,
    preTaxCostOfDebt: data.market.costOfDebt,
    taxRate: data.defaults.taxRate,
    marketCap: data.marketCap ?? 0,
    debt,
  }).wacc;
}

function Unsupported({ data, isLoading, error }: { data: DcfInputs | null; isLoading: boolean; error: unknown }) {
  if (data?.financial) return <DataState empty="This is a bank or insurer: debt is its raw material, so an enterprise DCF doesn’t apply. Value it on P/B and ROE instead — try another company." height={260} />;
  return <DataState loading={isLoading} error={error} empty="Not enough filed financials to build a DCF for this ticker." height={260} />;
}

// ─── DCF lab ────────────────────────────────────────────────────────────────

export function DcfLab() {
  const [symbol, setSymbol] = useState('MSFT');
  const { data, isLoading, error } = useDcfInputs(symbol);
  const ready = data && !data.financial && data.baseRevenue && data.bridge.shares ? data : null;
  return (
    <Widget
      kicker={`Live data · ${symbol}${ready?.baseLabel ? ` · base ${ready.baseLabel}` : ''}`}
      title="Value a real company in four levers"
      actions={
        <Link href={`/company/${symbol}?tab=dcf`} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-ink">
          Full model <ArrowUpRight className="size-3" />
        </Link>
      }
      footer="Everything else — tax rate, D&A, capex, working capital, stock comp, the EV-to-equity bridge — comes from the company’s filings, exactly as in the full DCF tab."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['MSFT', 'COST', 'NKE', 'ADBE', 'HD']} />
      </div>
      {ready ? <DcfLabBody key={symbol} data={ready} /> : <Unsupported data={data} isLoading={isLoading} error={error} />}
    </Widget>
  );
}

function DcfLabBody({ data }: { data: DcfInputs }) {
  const wacc0 = defaultWacc(data);
  const growth0 = Math.max(-0.1, Math.min(0.4, data.defaults.analystGrowth[0] ?? data.defaults.firstYearGrowth));
  const [growth, setGrowth] = useState(Math.round(growth0 * 200) / 200);
  const [margin, setMargin] = useState(Math.round(data.defaults.targetMargin * 200) / 200);
  const [wacc, setWacc] = useState(Math.round(wacc0 * 400) / 400);
  const [terminal, setTerminal] = useState(0.025);
  const assumptions = baseAssumptions(data, { growth, margin, wacc, terminal });
  const result = runDcf(assumptions);
  const fx = data.fxToUsd ?? 1;
  const perShareUsd = result.perShare !== null ? result.perShare * fx : null;
  const upside = perShareUsd !== null && data.price ? perShareUsd / data.price - 1 : null;
  const fmt = (value: number) => money(value * fx, { compact: true });
  const waccs = [-0.01, -0.005, 0, 0.005, 0.01].map((shift) => wacc + shift);
  const growths = [-0.01, -0.005, 0, 0.005, 0.01].map((shift) => terminal + shift);
  const grid = sensitivity(assumptions, waccs, growths);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-4">
          <Slider label="Year-1 revenue growth" value={growth} min={-0.1} max={0.4} step={0.005} onChange={setGrowth} format={(v) => pct(v, 1)} hint={`Fades to terminal growth by year 5. Seed: ${data.forecasts.growthSeed}.`} />
          <Slider label="Year-5 EBIT margin" value={margin} min={-0.05} max={0.6} step={0.005} onChange={setMargin} format={(v) => pct(v, 1)} hint={`Today ${pct(data.defaults.ebitMargin, 1)}`} />
          <Slider label="WACC" value={wacc} min={0.05} max={0.14} step={0.0025} onChange={setWacc} format={(v) => pct(v, 2)} hint={`CAPM default ${pct(wacc0, 2)} (β ${data.market.beta.toFixed(2)}, 10y ${pct(data.market.riskFree, 2)})`} />
          <Slider label="Terminal growth" value={terminal} min={0} max={0.04} step={0.0025} onChange={setTerminal} format={(v) => pct(v, 2)} hint="Never above long-run nominal GDP (~4%)." />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Readout label="Value per share" value={perShareUsd !== null ? `$${fmtPrice(perShareUsd)}` : '—'} tone="brand" sub={result.error ?? undefined} />
            <Readout label="Price" value={data.price ? `$${fmtPrice(data.price)}` : '—'} />
            <Readout label="Upside" value={upside !== null ? signedPct(upside, 1) : '—'} tone={upside === null ? undefined : upside >= 0 ? 'gain' : 'loss'} />
            <Readout label="Terminal value share" value={pct(result.terminalShare, 0)} sub={result.impliedExitMultiple ? `≈ ${multiple(result.impliedExitMultiple, 1)} EBITDA exit` : undefined} />
          </div>
          <ColumnChart
            height={190}
            categories={result.years.map((year) => `Y${year.year}`)}
            format={(value) => fmt(value)}
            series={[
              { label: 'Free cash flow', values: result.years.map((year) => year.fcf), color: 'var(--color-series-1)' },
              { label: 'Present value', values: result.years.map((year) => year.presentValue), color: 'var(--color-series-4)' },
            ]}
          />
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted">
              <span>Enterprise value {fmt(result.enterpriseValue)}</span>
              <span>Equity value {fmt(result.equityValue)}</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-4">
              <div className="h-full bg-series-1 transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, (result.pvForecast / Math.max(1, result.enterpriseValue)) * 100)}%` }} title="PV of the 5-year forecast" />
              <div className="h-full bg-series-4 transition-[width] duration-300 ease-out" style={{ width: `${Math.max(0, result.terminalShare * 100)}%` }} title="PV of the terminal value" />
            </div>
            <div className="mt-1 flex gap-4 text-[11px] text-ink-2">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-series-1" />Years 1–5 {fmt(result.pvForecast)}</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-series-4" />Terminal {fmt(result.pvTerminal)}</span>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[12px] text-ink-2">Sensitivity: value per share by WACC (rows) and terminal growth (columns)</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-separate border-spacing-0.5 text-center font-mono text-[11.5px]">
            <thead>
              <tr>
                <th className="text-left text-[10.5px] font-normal text-faint">WACC \ g</th>
                {growths.map((g) => (
                  <th key={g} className={cn('font-normal', Math.abs(g - terminal) < 1e-9 ? 'text-ink' : 'text-muted')}>{pct(g, 1)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, i) => (
                <tr key={waccs[i]}>
                  <td className={cn('text-left', i === 2 ? 'text-ink' : 'text-muted')}>{pct(waccs[i], 2)}</td>
                  {row.map((value, j) => {
                    const usd = value !== null ? value * fx : null;
                    const diff = usd !== null && data.price ? usd / data.price - 1 : null;
                    return (
                      <td
                        key={j}
                        className={cn('rounded-xs px-2 py-1.5 transition-colors duration-300', i === 2 && j === 2 ? 'ring-1 ring-brand/60' : '')}
                        style={{ background: diff === null ? 'transparent' : diff >= 0 ? `color-mix(in srgb, var(--color-gain-fill) ${Math.min(55, 8 + diff * 60)}%, transparent)` : `color-mix(in srgb, var(--color-loss-fill) ${Math.min(55, 8 - diff * 60)}%, transparent)` }}
                      >
                        {usd !== null ? fmtPrice(usd) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">Green cells are above today’s price, red below. Notice how much one point of WACC moves the answer compared with year-1 growth.</p>
      </div>
    </div>
  );
}

// ─── WACC builder ───────────────────────────────────────────────────────────

export function WaccBuilder() {
  const [symbol, setSymbol] = useState('KO');
  const { data, isLoading, error } = useDcfInputs(symbol);
  return (
    <Widget
      kicker={`Live data · ${symbol}`}
      title="Build a discount rate from market inputs"
      actions={<AskGrok symbol={symbol} prompt={`Estimate ${symbol}'s WACC. Is its regression beta a good measure of its risk, and what equity risk premium and cost of debt would you use? Show the math.`} />}
      footer="Beta is the stock’s 2-year daily regression on the S&P 500; the risk-free rate is today’s 10-year Treasury (FRED); cost of debt is interest expense over debt."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['KO', 'NVDA', 'T', 'TSLA', 'PG']} />
      </div>
      {data && !data.financial && data.marketCap ? <WaccBody key={symbol} data={data} /> : <Unsupported data={data} isLoading={isLoading} error={error} />}
    </Widget>
  );
}

function WaccBody({ data }: { data: DcfInputs }) {
  const [riskFree, setRiskFree] = useState(Math.round(data.market.riskFree * 400) / 400);
  const [beta, setBeta] = useState(Math.round(data.market.beta * 20) / 20);
  const [premium, setPremium] = useState(0.05);
  const [costOfDebt, setCostOfDebt] = useState(Math.round(data.market.costOfDebt * 400) / 400);
  const [tax, setTax] = useState(Math.round(data.defaults.taxRate * 100) / 100);
  const debt = data.bridge.debt * (data.fxToUsd ?? 1);
  const result = waccFromInputs({ riskFree, beta, equityRiskPremium: premium, preTaxCostOfDebt: costOfDebt, taxRate: tax, marketCap: data.marketCap ?? 0, debt });
  const equityWeight = 1 - result.debtWeight;

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-4">
        <Slider label="Risk-free rate (10y)" value={riskFree} min={0.01} max={0.07} step={0.0025} onChange={setRiskFree} format={(v) => pct(v, 2)} />
        <Slider label="Beta" value={beta} min={0.3} max={2.5} step={0.05} onChange={setBeta} format={(v) => v.toFixed(2)} hint={data.market.rawBeta !== null ? `Regression: ${data.market.rawBeta.toFixed(2)}` : undefined} />
        <Slider label="Equity risk premium" value={premium} min={0.03} max={0.08} step={0.0025} onChange={setPremium} format={(v) => pct(v, 2)} hint="Damodaran’s implied US ERP has mostly run 4–6%." />
        <Slider label="Pre-tax cost of debt" value={costOfDebt} min={0.02} max={0.12} step={0.0025} onChange={setCostOfDebt} format={(v) => pct(v, 2)} />
        <Slider label="Tax rate" value={tax} min={0} max={0.35} step={0.01} onChange={setTax} format={(v) => pct(v, 0)} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-md border border-line bg-surface-1 p-4 font-mono text-[13px] leading-7 text-ink-2">
          <div>
            Cost of equity = {pct(riskFree, 2)} + {beta.toFixed(2)} × {pct(premium, 2)} = <span className="font-semibold text-ink">{pct(result.costOfEquity, 2)}</span>
          </div>
          <div>
            After-tax cost of debt = {pct(costOfDebt, 2)} × (1 − {pct(tax, 0)}) = <span className="font-semibold text-ink">{pct(result.afterTaxDebt, 2)}</span>
          </div>
          <div>
            WACC = {pct(equityWeight, 0)} × {pct(result.costOfEquity, 2)} + {pct(result.debtWeight, 0)} × {pct(result.afterTaxDebt, 2)} = <span className="text-[15px] font-semibold text-brand-bright">{pct(result.wacc, 2)}</span>
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11.5px] text-muted">
            <span>Equity {money(data.marketCap, { compact: true })} ({pct(equityWeight, 0)})</span>
            <span>Debt {money(debt, { compact: true })} ({pct(result.debtWeight, 0)})</span>
          </div>
          <div className="flex h-8 overflow-hidden rounded-md">
            <div className="grid place-items-center bg-series-1/80 text-[11px] font-medium text-white transition-[width] duration-300" style={{ width: `${equityWeight * 100}%` }}>
              {equityWeight > 0.15 ? pct(result.costOfEquity, 1) : ''}
            </div>
            <div className="grid place-items-center bg-series-2/80 text-[11px] font-medium text-white transition-[width] duration-300" style={{ width: `${result.debtWeight * 100}%` }}>
              {result.debtWeight > 0.12 ? pct(result.afterTaxDebt, 1) : ''}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Readout label="Cost of equity" value={pct(result.costOfEquity, 2)} />
          <Readout label="After-tax debt" value={pct(result.afterTaxDebt, 2)} />
          <Readout label="WACC" value={pct(result.wacc, 2)} tone="brand" />
        </div>
      </div>
    </div>
  );
}

// ─── Reverse DCF ────────────────────────────────────────────────────────────

export function ReverseDcfSolver() {
  const [symbol, setSymbol] = useState('NVDA');
  const { data, isLoading, error } = useDcfInputs(symbol);
  const ready = data && !data.financial && data.baseRevenue && data.bridge.shares && data.price ? data : null;
  return (
    <Widget
      kicker={`Live data · ${symbol}`}
      title="What is the market assuming?"
      actions={<AskGrok symbol={symbol} prompt={`Run a reverse DCF on ${symbol}: what revenue growth and margins does today's price imply over the next five years, and how does that compare with its history, guidance and base rates for companies of its size?`} />}
      footer="Solved with the same DCF engine as the company DCF tab. Base rates: very few companies above $10B of revenue have sustained 20%+ growth for five years."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['NVDA', 'TSLA', 'KO', 'INTC', 'COST']} />
      </div>
      {ready ? <ReverseBody key={symbol} data={ready} /> : <Unsupported data={data} isLoading={isLoading} error={error} />}
    </Widget>
  );
}

function ReverseBody({ data }: { data: DcfInputs }) {
  const [wacc, setWacc] = useState(Math.round(defaultWacc(data) * 400) / 400);
  const [lever, setLever] = useState<'growth' | 'margin'>('growth');
  const terminal = 0.025;
  const fx = data.fxToUsd ?? 1;
  const priceLocal = (data.price as number) / fx;
  const base = baseAssumptions(data, { growth: data.defaults.firstYearGrowth, margin: data.defaults.targetMargin, wacc, terminal });
  // Solve on a flat growth path so "implied growth" reads as one number.
  const flat: DcfAssumptions = { ...base, growth: Array(YEARS).fill(0) };
  const solved = lever === 'growth' ? solveForPerShare(flat, priceLocal, 'growth') : solveForPerShare(base, priceLocal, 'margin');
  const history = data.history.filter((row) => row.revenue !== null);
  const cagr = data.defaults.cagr3;
  const lastMargin = data.defaults.ebitMargin;
  const check = solved !== null ? runDcf(lever === 'growth' ? applyLever(flat, 'growth', solved) : applyLever(base, 'margin', solved)) : null;
  const implied = solved;
  const reference = lever === 'growth' ? cagr : lastMargin;
  const gap = implied !== null && reference !== null ? implied - reference : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-4">
        <Segmented
          value={lever}
          onChange={setLever}
          options={[
            { value: 'growth', label: 'Solve for growth' },
            { value: 'margin', label: 'Solve for margin' },
          ]}
        />
        <Slider label="WACC" value={wacc} min={0.06} max={0.13} step={0.0025} onChange={setWacc} format={(v) => pct(v, 2)} hint="Higher WACC → more growth needed." />
        <div className="text-[12px] leading-relaxed text-muted">
          {lever === 'growth'
            ? `Holding margins on their default path (today ${pct(data.defaults.ebitMargin, 1)} → ${pct(data.defaults.targetMargin, 1)}), what constant revenue growth for five years justifies $${fmtPrice(data.price)}?`
            : `Holding the default growth path, what year-5 EBIT margin justifies $${fmtPrice(data.price)}?`}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          <Readout label={lever === 'growth' ? 'Implied growth / yr' : 'Implied year-5 margin'} value={implied !== null ? pct(implied, 1) : 'out of range'} tone="brand" sub={check?.perShare ? `check: $${fmtPrice(check.perShare * fx)}` : undefined} />
          <Readout label={lever === 'growth' ? '3-yr revenue CAGR' : 'Margin today'} value={pct(reference, 1)} />
          <Readout label="Gap" value={gap !== null ? `${gap >= 0 ? '+' : '−'}${(Math.abs(gap) * 100).toFixed(1)} pts` : '—'} tone={gap === null ? undefined : gap > 0.05 ? 'loss' : gap < -0.02 ? 'gain' : undefined} sub={gap === null ? undefined : gap > 0.05 ? 'market expects acceleration' : gap < -0.02 ? 'market expects a slowdown' : 'priced near history'} />
        </div>
        {lever === 'growth' ? (
          <ColumnChart
            height={200}
            highlightLast
            categories={[...history.map((row) => row.label), ...(implied !== null ? ['Implied'] : [])]}
            format={(value) => pct(value, 0)}
            series={[
              {
                label: 'Revenue growth',
                values: [
                  ...history.map((row, index) => (index > 0 && history[index - 1].revenue ? (row.revenue as number) / (history[index - 1].revenue as number) - 1 : null)),
                  ...(implied !== null ? [implied] : []),
                ],
              },
            ]}
          />
        ) : (
          <ColumnChart
            height={200}
            highlightLast
            categories={[...history.map((row) => row.label), ...(implied !== null ? ['Implied Y5'] : [])]}
            format={(value) => pct(value, 0)}
            series={[{ label: 'EBIT margin', values: [...history.map((row) => row.ebitMargin), ...(implied !== null ? [implied] : [])] }]}
          />
        )}
        <p className="text-[12px] leading-relaxed text-ink-2">
          {implied === null
            ? 'No value in the search range reaches the price — the market is pricing something the model can’t express (or the company is valued on assets, not cash flows).'
            : gap !== null && gap > 0.05
              ? `The price needs ${pct(implied, 1)} a year — well above what the company has delivered. A long needs a specific reason to believe it will beat that.`
              : gap !== null && gap < -0.02
                ? `The price only needs ${pct(implied, 1)} — below its track record. If the business holds up, expectations are beatable; ask what the market fears.`
                : `The price needs roughly what the company has already been doing. The debate is about duration and margins, not a heroic forecast.`}
        </p>
      </div>
    </div>
  );
}

// ─── Comps & football field ─────────────────────────────────────────────────

type MultipleKey = 'pe' | 'evEbitda' | 'ps' | 'pfcf';
const MULTIPLES: Array<{ key: MultipleKey; label: string; ev: boolean }> = [
  { key: 'pe', label: 'P/E', ev: false },
  { key: 'evEbitda', label: 'EV/EBITDA', ev: true },
  { key: 'ps', label: 'P/S', ev: false },
  { key: 'pfcf', label: 'P/FCF', ev: false },
];

function quartiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return { q1: at(0.25), median: at(0.5), q3: at(0.75) };
}

export function CompsLab() {
  const [symbol, setSymbol] = useState('CAT');
  const peers = usePeers(symbol);
  const dcf = useDcfInputs(symbol);
  const subject = peers.data?.subject ?? null;
  const list = useMemo(() => peers.data?.peers ?? [], [peers.data]);
  const price = subject?.price ?? null;

  const rows = useMemo(() => {
    if (!subject || !price) return [];
    const netDebt = dcf.data ? (dcf.data.bridge.debt - dcf.data.bridge.cash) * (dcf.data.fxToUsd ?? 1) : null;
    const shares = subject.marketCap && price ? subject.marketCap / price : null;
    return MULTIPLES.map((config) => {
      const own = subject[config.key];
      const values = list.map((peer) => peer[config.key]).filter((value): value is number => typeof value === 'number' && value > 0 && value < 200);
      // Two peers is thin but still a range; fewer isn't.
      if (!own || own <= 0 || values.length < 2) return { ...config, own, stats: null, range: null };
      const stats = quartiles(values);
      let implied: (multiple: number) => number | null;
      if (!config.ev) implied = (m) => price * (m / own);
      else if (netDebt !== null && shares && subject.marketCap) {
        const ev = subject.marketCap + netDebt;
        const ebitda = ev / own;
        implied = (m) => (m * ebitda - netDebt) / shares;
      } else implied = () => null;
      const low = implied(stats.q1);
      const mid = implied(stats.median);
      const high = implied(stats.q3);
      return { ...config, own, stats, range: low !== null && mid !== null && high !== null ? { low, mid, high } : null };
    });
  }, [subject, price, list, dcf.data]);

  const dcfValue = useMemo(() => {
    const data = dcf.data;
    if (!data || data.financial || !data.baseRevenue || !data.bridge.shares) return null;
    const wacc = defaultWacc(data);
    const low = runDcf(baseAssumptions(data, { growth: data.defaults.firstYearGrowth, margin: data.defaults.targetMargin, wacc: wacc + 0.01, terminal: 0.02 })).perShare;
    const mid = runDcf(baseAssumptions(data, { growth: data.defaults.firstYearGrowth, margin: data.defaults.targetMargin, wacc, terminal: 0.025 })).perShare;
    const high = runDcf(baseAssumptions(data, { growth: data.defaults.firstYearGrowth, margin: data.defaults.targetMargin, wacc: wacc - 0.01, terminal: 0.03 })).perShare;
    const fx = data.fxToUsd ?? 1;
    return low !== null && mid !== null && high !== null ? { low: low * fx, mid: mid * fx, high: high * fx } : null;
  }, [dcf.data]);

  const bars = [
    ...rows.filter((row) => row.range).map((row) => ({ label: `${row.label} (peer IQR)`, ...row.range! })),
    ...(dcfValue ? [{ label: 'DCF (WACC ±1pt)', ...dcfValue }] : []),
  ];
  const axisMax = Math.max(price ?? 0, ...bars.map((bar) => bar.high)) * 1.08;
  const axisMin = Math.max(0, Math.min(price ?? Infinity, ...bars.map((bar) => bar.low)) * 0.85);
  const at = (value: number) => ((value - axisMin) / Math.max(1e-9, axisMax - axisMin)) * 100;

  return (
    <Widget
      kicker={`Live data · ${symbol} vs ${list.length} peers`}
      title="Comps table and football field"
      actions={
        <Link href={`/company/${symbol}?tab=peers`} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-ink">
          Edit peers <ArrowUpRight className="size-3" />
        </Link>
      }
      footer="Each bar is the share price implied by the peers’ 25th–75th percentile multiple, with the median marked. EV multiples go through the net-debt bridge; equity multiples scale the price directly."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['CAT', 'PEP', 'CRM', 'MCD', 'HD']} />
      </div>
      {!subject || !price ? (
        <DataState loading={peers.isLoading} error={peers.error} empty="No peer data for this ticker." height={260} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead className="bg-surface-1 text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Company</th>
                  <th className="px-3 py-2 text-right font-medium">Mkt cap</th>
                  {MULTIPLES.map((config) => (
                    <th key={config.key} className="px-3 py-2 text-right font-medium">{config.label}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Rev growth</th>
                  <th className="px-3 py-2 text-right font-medium">Op margin</th>
                </tr>
              </thead>
              <tbody className="num">
                {[subject, ...list].map((row, index) => (
                  <tr key={row.symbol} className={cn('border-t border-line', index === 0 && 'bg-brand-wash')}>
                    <td className="px-3 py-1.5">
                      <Link href={`/company/${row.symbol}`} className="flex items-center gap-2 hover:text-ink">
                        <CompanyLogo symbol={row.symbol} size="xs" />
                        <span className="font-mono text-ink">{row.symbol}</span>
                        <span className="max-w-40 truncate text-muted">{row.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right text-ink-2">{money(row.marketCap, { compact: true })}</td>
                    {MULTIPLES.map((config) => (
                      <td key={config.key} className="px-3 py-1.5 text-right text-ink-2">{row[config.key] && (row[config.key] as number) > 0 ? multiple(row[config.key], 1) : '—'}</td>
                    ))}
                    <td className="px-3 py-1.5 text-right text-ink-2">{pct(row.revenueGrowth, 1)}</td>
                    <td className="px-3 py-1.5 text-right text-ink-2">{pct(row.operatingMargin, 1)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line-strong bg-surface-1 text-ink">
                  <td className="px-3 py-1.5 font-medium">Peer median</td>
                  <td />
                  {rows.map((row) => (
                    <td key={row.key} className="px-3 py-1.5 text-right font-medium">{row.stats ? multiple(row.stats.median, 1) : '—'}</td>
                  ))}
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
          {bars.length ? (
            <div>
              <div className="mb-2 text-[12px] text-ink-2">Football field — implied value per share</div>
              <div className="relative flex flex-col gap-2.5 pt-1 pb-6">
                {bars.map((bar) => (
                  <div key={bar.label} className="grid grid-cols-[150px_1fr] items-center gap-3">
                    <span className="truncate text-[11.5px] text-muted">{bar.label}</span>
                    <div className="relative h-6">
                      <div
                        className="absolute inset-y-0 rounded-xs bg-gradient-to-r from-series-1/40 to-series-1/70"
                        style={{ left: `${at(bar.low)}%`, width: `${Math.max(0.8, at(bar.high) - at(bar.low))}%` }}
                      />
                      <div className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${at(bar.mid)}%` }} />
                      <span className="num absolute top-1/2 -translate-y-1/2 pr-1.5 text-[10.5px] text-muted" style={{ right: `${100 - at(bar.low)}%` }}>${fmtPrice(bar.low)}</span>
                      <span className="num absolute top-1/2 -translate-y-1/2 pl-1.5 text-[10.5px] text-muted" style={{ left: `${at(bar.high)}%` }}>${fmtPrice(bar.high)}</span>
                    </div>
                  </div>
                ))}
                <div className="pointer-events-none absolute top-0 bottom-0 grid grid-cols-[150px_1fr] gap-3" style={{ left: 0, right: 0 }}>
                  <span />
                  <div className="relative">
                    <div className="absolute top-0 bottom-4 w-px bg-brand-bright shadow-[0_0_8px_var(--color-ion)]" style={{ left: `${at(price)}%` }} />
                    <span className="num absolute bottom-0 -translate-x-1/2 text-[10.5px] font-medium text-brand-bright" style={{ left: `${at(price)}%` }}>
                      Price ${fmtPrice(price)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Widget>
  );
}

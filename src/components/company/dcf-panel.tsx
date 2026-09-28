'use client';

import { RotateCcw } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Skeleton, Stat, Switch } from '@/components/ui/primitives';
import { applyLever, fade, runDcf, sensitivity, solveForPerShare, waccFromInputs, type DcfAssumptions, type DcfYear, type SolveLever } from '@/lib/finance/dcf';
import { compactNumber, multiple, pct, price } from '@/lib/format';
import type { DcfInputs } from '@/lib/services/dcf';
import { cn } from '@/lib/utils';

const YEARS = 5;

type HistoryYear = DcfInputs['history'][number];

/** Everything the user can edit. Rates are stored as fractions (0.08 = 8%). */
type Model = {
  growth: number[];
  ebitMargin: number[];
  taxRate: number;
  daPct: number;
  capexPct: number;
  nwcPct: number;
  sbcPct: number;
  deductSbc: boolean;
  riskFree: number;
  beta: number;
  equityRiskPremium: number;
  costOfDebt: number;
  useWaccOverride: boolean;
  waccOverride: number;
  terminalGrowth: number;
  midYear: boolean;
  includeLeases: boolean;
  cash: number;
  debt: number;
  leases: number;
  minorityInterest: number;
  preferredStock: number;
  shares: number;
};

function defaultModel(data: DcfInputs): Model {
  const d = data.defaults;
  const terminal = d.terminalGrowth;
  // Analyst growth for the years it covers, then a straight fade to terminal growth.
  const analyst = d.analystGrowth.slice(0, YEARS);
  const tail = fade(analyst.at(-1) ?? d.firstYearGrowth, terminal, YEARS - analyst.length + 1).slice(analyst.length ? 1 : 0);
  const growth = [...analyst, ...tail].slice(0, YEARS);
  return {
    growth,
    ebitMargin: fade(d.ebitMargin, d.targetMargin, YEARS),
    taxRate: d.taxRate,
    daPct: d.daPct,
    capexPct: d.capexPct,
    nwcPct: d.nwcPct,
    sbcPct: d.sbcPct,
    deductSbc: true,
    riskFree: data.market.riskFree,
    beta: data.market.beta,
    equityRiskPremium: data.market.equityRiskPremium,
    costOfDebt: data.market.costOfDebt,
    useWaccOverride: false,
    waccOverride: 0.09,
    terminalGrowth: terminal,
    midYear: true,
    includeLeases: true,
    cash: data.bridge.cash,
    debt: data.bridge.debt,
    leases: data.bridge.leases ?? 0,
    minorityInterest: data.bridge.minorityInterest ?? 0,
    preferredStock: data.bridge.preferredStock ?? 0,
    shares: data.bridge.shares ?? 0,
  };
}

type Scenario = 'bear' | 'base' | 'bull';
const SCENARIOS: Array<{ value: Scenario; label: string }> = [
  { value: 'bear', label: 'Bear' },
  { value: 'base', label: 'Base' },
  { value: 'bull', label: 'Bull' },
];
/** Edited scenarios for one company; a scenario without a saved model uses its defaults. */
type Saved = { active: Scenario; models: Partial<Record<Scenario, Model>> };

/**
 * Defaults per scenario. Bear halves the growth above terminal and trims 3 points off the final-year margin;
 * bull adds 40% to the growth above terminal and 5 points to the final-year margin.
 */
function scenarioModel(data: DcfInputs, scenario: Scenario): Model {
  const base = defaultModel(data);
  if (scenario === 'base') return base;
  const [growthScale, marginShift] = scenario === 'bear' ? [0.5, -0.03] : [1.4, 0.05];
  const t = base.terminalGrowth;
  return {
    ...base,
    growth: base.growth.map((growth) => (growth > t ? t + (growth - t) * growthScale : growth)),
    ebitMargin: base.ebitMargin.map((margin, index) => margin + (marginShift * index) / (YEARS - 1)),
  };
}

// Bump the version when the default assumptions change so stale saved models are not reused.
const storageKey = (symbol: string) => `silvernote:dcf:v3:${symbol}`;
const isModel = (value: unknown): value is Model => Array.isArray((value as Model | null)?.growth) && (value as Model).growth.length === YEARS;

function loadSaved(symbol: string): Saved {
  const empty: Saved = { active: 'base', models: {} };
  try {
    const raw = window.localStorage.getItem(storageKey(symbol));
    if (raw) {
      const parsed = JSON.parse(raw) as Saved;
      const models = Object.fromEntries(Object.entries(parsed.models ?? {}).filter(([key, model]) => SCENARIOS.some((s) => s.value === key) && isModel(model)));
      return { active: SCENARIOS.some((s) => s.value === parsed.active) ? parsed.active : 'base', models };
    }
    // One-model format from before scenarios: it becomes the base case.
    const legacy = JSON.parse(window.localStorage.getItem(`silvernote:dcf:v2:${symbol}`) ?? 'null') as unknown;
    return isModel(legacy) ? { active: 'base', models: { base: legacy } } : empty;
  } catch {
    return empty;
  }
}

function storeSaved(symbol: string, saved: Saved) {
  try {
    window.localStorage.setItem(storageKey(symbol), JSON.stringify(saved));
  } catch {
    // storage unavailable: scenarios just aren't remembered
  }
}

/** Runs the model: discount rate, DCF result and the assumptions it used. */
function evaluate(data: DcfInputs, model: Model) {
  const capital = waccFromInputs({
    riskFree: model.riskFree,
    beta: model.beta,
    equityRiskPremium: model.equityRiskPremium,
    preTaxCostOfDebt: model.costOfDebt,
    taxRate: model.taxRate,
    // Market cap is in USD; convert to the reporting currency so the weights line up with debt.
    marketCap: (data.marketCap ?? 0) / (data.fxToUsd ?? 1),
    debt: model.debt,
  });
  const wacc = model.useWaccOverride ? model.waccOverride : capital.wacc;
  const assumptions: DcfAssumptions = {
    baseRevenue: data.baseRevenue ?? 0,
    growth: model.growth,
    ebitMargin: model.ebitMargin,
    taxRate: model.taxRate,
    daPctRevenue: model.daPct,
    capexPctRevenue: model.capexPct,
    nwcPctRevenue: model.nwcPct,
    sbcPctRevenue: model.sbcPct,
    deductSbc: model.deductSbc,
    wacc,
    terminalGrowth: model.terminalGrowth,
    midYear: model.midYear,
    cash: model.cash,
    debt: model.debt,
    leases: model.leases,
    includeLeases: model.includeLeases,
    minorityInterest: model.minorityInterest,
    preferredStock: model.preferredStock,
    shares: model.shares,
  };
  return { capital, wacc, assumptions, result: runDcf(assumptions) };
}

/**
 * Text input bound to a number: keeps the user's draft while typing and follows the value when it changes
 * from outside (e.g. "Reset to defaults").
 */
function DraftInput({
  value,
  onChange,
  format,
  parse,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  parse: (typed: number) => number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(() => ({ source: value, text: format(value) }));
  const text = draft.source === value ? draft.text : format(value);
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          const typed = Number(event.target.value);
          const valid = event.target.value.trim() !== '' && Number.isFinite(typed);
          const next = valid ? parse(typed) : value;
          setDraft({ source: next, text: event.target.value });
          if (valid) onChange(next);
        }}
        className={cn('text-right font-mono tabular-nums', suffix && 'pr-6')}
      />
      {suffix ? <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-faint">{suffix}</span> : null}
    </div>
  );
}

type InputProps = { value: number; onChange: (value: number) => void };
/** Edits a percentage while the model stores a fraction. */
const PctInput = (props: InputProps) => <DraftInput {...props} format={(v) => (v * 100).toFixed(1)} parse={(v) => v / 100} suffix="%" />;
/** Money in millions of the reporting currency. */
const MillionsInput = (props: InputProps) => <DraftInput {...props} format={(v) => (v / 1e6).toFixed(0)} parse={(v) => v * 1e6} suffix="M" />;
const NumberInput = ({ digits = 2, ...props }: InputProps & { digits?: number }) => <DraftInput {...props} format={(v) => v.toFixed(digits)} parse={(v) => v} />;

/** Switch with a visible label. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[12px] text-ink-2">
      <Switch checked={checked} onChange={onChange} label={label} />
      {label}
    </span>
  );
}

/** Type a target final-year margin and fade every year toward it, starting from the current year-1 margin. */
function FadeMarginControl({ onApply }: { onApply: (target: number) => void }) {
  const [text, setText] = useState('');
  const apply = () => {
    const target = Number(text);
    if (text.trim() !== '' && Number.isFinite(target)) onApply(target / 100);
  };
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
      Fade margin to
      <Input
        inputMode="decimal"
        placeholder="year 5 %"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && apply()}
        className="h-6 w-16 text-right font-mono text-[11.5px] tabular-nums"
      />
      <Button size="xs" variant="ghost" onClick={apply} disabled={text.trim() === '' || !Number.isFinite(Number(text))}>
        Apply
      </Button>
    </span>
  );
}

const cell = 'px-3 py-1.5 text-right font-mono tabular-nums';

const revenueGrowth = (previous: number | null | undefined, current: number | null | undefined) =>
  previous && current ? current / previous - 1 : null;

export function DcfPanel({ symbol }: { symbol: string }) {
  const { data, isLoading } = useSWR<DcfInputs>(`/api/company/${symbol}/dcf`);
  // Scenario edits; until the user changes something, the saved scenarios (or the defaults) are used.
  const [edits, setEdits] = useState<{ symbol: string; saved: Saved } | null>(null);
  const stored = useMemo(() => (data ? loadSaved(symbol) : null), [data, symbol]);
  const saved = (edits?.symbol === symbol ? edits.saved : stored) ?? { active: 'base' as Scenario, models: {} };
  const active = saved.active;
  const model = saved.models[active] ?? (data ? scenarioModel(data, active) : null);
  const edited = Boolean(saved.models[active]);

  const commit = (next: Saved) => {
    storeSaved(symbol, next);
    setEdits({ symbol, saved: next });
  };
  const update = (patch: Partial<Model>) => {
    if (!model) return;
    commit({ ...saved, models: { ...saved.models, [active]: { ...model, ...patch } } });
  };
  const setYear = (key: 'growth' | 'ebitMargin', index: number, value: number) => {
    if (!model) return;
    const next = [...model[key]];
    next[index] = value;
    update({ [key]: next } as Partial<Model>);
  };
  const reset = () => {
    const models = { ...saved.models };
    delete models[active];
    commit({ ...saved, models });
  };

  const computed = useMemo(() => {
    if (!data || !model || !data.baseRevenue) return null;
    const { capital, wacc, assumptions, result } = evaluate(data, model);
    const waccs = [-0.01, -0.005, 0, 0.005, 0.01].map((delta) => wacc + delta);
    const growths = [-0.01, -0.005, 0, 0.005, 0.01].map((delta) => model.terminalGrowth + delta);
    // Reverse DCF: what the current price implies, holding everything else in this scenario fixed.
    const target = data.price && data.fxToUsd ? data.price / data.fxToUsd : null;
    const implied = target
      ? { margin: solveForPerShare(assumptions, target, 'margin'), growth: solveForPerShare(assumptions, target, 'growth') }
      : null;
    return { capital, wacc, result, waccs, growths, implied, grid: sensitivity(assumptions, waccs, growths) };
  }, [data, model]);

  // Value per share (USD) of every scenario, for the summary strip.
  const scenarioValues = useMemo(() => {
    if (!data?.baseRevenue) return null;
    return SCENARIOS.map(({ value, label }) => {
      const scenarioModelValue = saved.models[value] ?? scenarioModel(data, value);
      const perShare = evaluate(data, scenarioModelValue).result.perShare;
      return { value, label, usd: perShare === null || !data.fxToUsd ? null : perShare * data.fxToUsd, edited: Boolean(saved.models[value]) };
    });
  }, [data, saved.models]);

  if (isLoading && !data) return <Skeleton className="h-[640px] w-full" />;
  if (!data || !data.baseRevenue) {
    return (
      <Panel>
        <EmptyState title="Not enough data for a DCF" body="This company has no revenue history in its filings yet. Try the Financials tab to refresh its statements." />
      </Panel>
    );
  }
  if (data.fxToUsd === null) {
    return (
      <Panel>
        <EmptyState
          title={`No ${data.currency} exchange rate right now`}
          body={`${data.name} reports in ${data.currency}. Without a current rate its value per share can't be compared with the US dollar price, so the DCF is paused. Try again shortly.`}
        />
      </Panel>
    );
  }
  if (!model || !computed) return <Skeleton className="h-[640px] w-full" />;

  const { result, capital, wacc, implied } = computed;
  // Writes a solved lever back into the scenario so the forecast table shows the path the price implies.
  const applyImplied = (lever: SolveLever, value: number) => {
    const next = applyLever({ growth: model.growth, ebitMargin: model.ebitMargin } as DcfAssumptions, lever, value);
    update({ growth: next.growth, ebitMargin: next.ebitMargin });
  };
  const fx = data.fxToUsd ?? 1;
  const perShareUsd = result.perShare !== null ? result.perShare * fx : null;
  const upside = perShareUsd !== null && perShareUsd > 0 && data.price ? perShareUsd / data.price - 1 : null;
  const m = (value: number | null | undefined) => (value === null || value === undefined ? '—' : compactNumber(value));
  const foreign = data.currency !== 'USD';

  return (
    <div className="flex flex-col gap-4">
      {/* Result */}
      <Panel>
        <PanelHeader
          kicker="Discounted cash flow"
          title={`${data.name} intrinsic value`}
          actions={
            <div className="flex items-center gap-2">
              <Segmented size="xs" value={active} onChange={(next) => commit({ ...saved, active: next })} options={SCENARIOS} />
              <Button size="xs" variant="ghost" onClick={reset} disabled={!edited}>
                <RotateCcw className="size-3.5" /> Reset {active}
              </Button>
            </div>
          }
        />
        <div className="grid grid-cols-2 gap-4 px-4 pb-4 sm:grid-cols-5">
          <Stat label="Value per share" value={result.error ? '—' : price(perShareUsd)} sub={result.error ? <span className="text-loss">{result.error}</span> : foreign ? <span className="text-muted">USD, from {data.currency}</span> : null} />
          <Stat label="Current price" value={price(data.price)} />
          <Stat
            label="Upside / downside"
            value={<span className={cn(upside !== null && (upside >= 0 ? 'text-gain' : 'text-loss'))}>{upside === null ? '—' : `${upside >= 0 ? '+' : ''}${pct(upside)}`}</span>}
          />
          <Stat label="Enterprise value" value={m(result.enterpriseValue)} sub={<span className="text-muted">{data.currency}</span>} />
          <Stat label="Terminal value share" value={pct(result.terminalShare)} sub={<span className="text-muted">Implied exit {multiple(result.impliedExitMultiple)} EBITDA</span>} />
        </div>
        <div className="grid gap-4 border-t border-line px-4 py-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">Scenarios</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
              {scenarioValues?.map((scenario) => {
                const up = scenario.usd !== null && scenario.usd > 0 && data.price ? scenario.usd / data.price - 1 : null;
                return (
                  <button
                    key={scenario.value}
                    type="button"
                    onClick={() => commit({ ...saved, active: scenario.value })}
                    className={cn('flex items-baseline gap-1.5 text-left', scenario.value === active ? 'text-ink' : 'text-muted hover:text-ink-2')}
                  >
                    <span>{scenario.label}{scenario.edited ? '*' : ''}</span>
                    <span className="font-mono tabular-nums">{price(scenario.usd)}</span>
                    {up !== null ? <span className={cn('font-mono text-[11px] tabular-nums', up >= 0 ? 'text-gain' : 'text-loss')}>{up >= 0 ? '+' : ''}{pct(up)}</span> : null}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-faint">Bear halves growth above terminal and trims margins 3 pts; bull lifts growth 40% and margins 5 pts. * edited</p>
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">What the price implies</p>
            {implied ? (
              <div className="flex flex-col gap-1 text-[12.5px]">
                <ImpliedRow
                  label={`Year ${YEARS} EBIT margin`}
                  value={implied.margin}
                  current={model.ebitMargin.at(-1) ?? 0}
                  format={(v) => pct(v)}
                  onApply={() => implied.margin !== null && applyImplied('margin', implied.margin)}
                />
                <ImpliedRow
                  label="Growth, every year"
                  value={implied.growth}
                  current={0}
                  format={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`}
                  onApply={() => implied.growth !== null && applyImplied('growth', implied.growth)}
                />
                <p className="text-[11px] text-faint">Each solved on its own, holding the rest of this scenario fixed. Apply writes it into the forecast.</p>
              </div>
            ) : (
              <p className="text-[12px] text-muted">No current price to solve against.</p>
            )}
          </div>
        </div>
        {data.financial || data.defaults.targetMargin !== data.defaults.ebitMargin ? (
          <div className="flex flex-col gap-1 border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
            {data.financial ? (
              <p>
                <span className="text-loss">Financial company.</span> A free-cash-flow-to-the-firm model treats debt as financing, but for banks and insurers
                deposits and borrowings are the business itself. Treat this value as rough; a dividend or excess-return model fits better.
              </p>
            ) : null}
            {data.defaults.targetMargin !== data.defaults.ebitMargin ? (
              <p>
                Operating margin is negative today ({pct(data.defaults.ebitMargin)}), so the default fades it to {pct(data.defaults.targetMargin)} by year {YEARS}{' '}
                ({data.history.some((year) => (year.ebitMargin ?? 0) > 0) ? 'its historical average' : 'a generic mature margin'}). Edit the margins to change the path.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {/* Forecast table */}
      <Panel className="overflow-hidden">
        <PanelHeader
          kicker="Forecast"
          title="Free cash flow to the firm"
          actions={
            <div className="flex items-center gap-2">
              <FadeMarginControl onApply={(target) => update({ ebitMargin: fade(model.ebitMargin[0] ?? target, target, YEARS) })} />
              <Badge tone="outline">Growth seeded from {data.forecasts.growthSeed}</Badge>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-surface-1">
                <th className="sticky left-0 z-10 bg-surface-1 px-3 py-2 text-left font-medium whitespace-nowrap text-muted">{data.currency}</th>
                {data.history.map((year) => (
                  <th key={year.label} className="px-3 py-2 text-right font-mono text-[11px] font-medium text-faint">{year.label}</th>
                ))}
                <th className="px-3 py-2 text-right font-mono text-[11px] font-medium text-muted">Base {data.baseLabel}</th>
                {result.years.map((year) => (
                  <th key={year.year} className="px-3 py-2 text-right font-mono text-[11px] font-medium text-brand-soft">Year {year.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="sticky left-0 bg-surface-1 px-3 py-1.5 whitespace-nowrap text-ink-2">Revenue</td>
                {data.history.map((year) => <td key={year.label} className={cn(cell, 'text-faint')}>{m(year.revenue)}</td>)}
                <td className={cell}>{m(data.baseRevenue)}</td>
                {result.years.map((year) => <td key={year.year} className={cell}>{m(year.revenue)}</td>)}
              </tr>
              <tr className="border-t border-line">
                <td className="sticky left-0 bg-surface-1 px-3 py-1.5 whitespace-nowrap text-ink-2">Revenue growth</td>
                {data.history.map((year, index) => (
                  <td key={year.label} className={cn(cell, 'text-faint')}>{pct(revenueGrowth(data.history[index - 1]?.revenue, year.revenue))}</td>
                ))}
                <td className={cn(cell, 'text-faint')}>{pct(revenueGrowth(data.history.at(-1)?.revenue, data.baseRevenue))}</td>
                {model.growth.map((value, index) => (
                  <td key={index} className="px-1.5 py-1"><PctInput value={value} onChange={(next) => setYear('growth', index, next)} /></td>
                ))}
              </tr>
              <tr className="border-t border-line">
                <td className="sticky left-0 bg-surface-1 px-3 py-1.5 whitespace-nowrap text-ink-2">EBIT margin</td>
                {data.history.map((year) => <td key={year.label} className={cn(cell, 'text-faint')}>{pct(year.ebitMargin)}</td>)}
                <td className={cell} />
                {model.ebitMargin.map((value, index) => (
                  <td key={index} className="px-1.5 py-1"><PctInput value={value} onChange={(next) => setYear('ebitMargin', index, next)} /></td>
                ))}
              </tr>
              {(
                [
                  ['EBIT', (y) => y.ebit, (h) => h.ebit],
                  ['NOPAT (after tax)', (y) => y.nopat, (h) => h.nopat],
                  ['+ D&A', (y) => y.da, (h) => h.da],
                  ['− Capex', (y) => -y.capex, (h) => (h.capex === null ? null : -h.capex)],
                  ['− Change in working capital', (y) => -y.changeNwc, (h) => (h.changeNwc === null ? null : -h.changeNwc)],
                  ...(model.deductSbc ? [] : [['+ Stock-based comp', (y: DcfYear) => y.sbc, (h: HistoryYear) => h.sbc] as const]),
                ] as Array<readonly [string, (year: DcfYear) => number, (year: HistoryYear) => number | null]>
              ).map(([label, pick, pickHistory]) => (
                <tr key={label} className="border-t border-line">
                  <td className="sticky left-0 bg-surface-1 px-3 py-1.5 whitespace-nowrap text-muted">{label}</td>
                  {data.history.map((year) => (
                    <td key={year.label} className={cn(cell, 'text-faint')}>{m(pickHistory(year))}</td>
                  ))}
                  <td className={cell} />
                  {result.years.map((year) => <td key={year.year} className={cn(cell, 'text-ink-2')}>{m(pick(year))}</td>)}
                </tr>
              ))}
              <tr className="border-t border-line-strong">
                <td className="sticky left-0 bg-surface-1 px-3 py-1.5 font-medium text-ink">Free cash flow</td>
                {data.history.map((year) => <td key={year.label} className={cn(cell, 'text-faint')}>{m(year.freeCashFlow)}</td>)}
                <td className={cell} />
                {result.years.map((year) => <td key={year.year} className={cn(cell, 'font-medium text-ink')}>{m(year.fcf)}</td>)}
              </tr>
              <tr className="border-t border-line">
                <td className="sticky left-0 bg-surface-1 px-3 py-1.5 text-muted">Present value</td>
                {data.history.map((year) => <td key={year.label} className={cell} />)}
                <td className={cell} />
                {result.years.map((year) => <td key={year.year} className={cn(cell, 'text-ink-2')}>{m(year.presentValue)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[11px] text-faint">
          Faded columns are reported history (operating cash flow minus capex for free cash flow, so stock comp is added back). EBIT is GAAP, after stock
          comp: with “Treat SBC as a cost” on it stays deducted; off, it is added back like reported free cash flow. Year columns use the assumptions below.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Operating assumptions */}
        <Panel>
          <PanelHeader kicker="Assumptions" title="Operations" />
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            <Field label="Tax rate" hint="3-year effective rate, one-offs excluded"><PctInput value={model.taxRate} onChange={(taxRate) => update({ taxRate })} /></Field>
            <Field label="D&A % of revenue"><PctInput value={model.daPct} onChange={(daPct) => update({ daPct })} /></Field>
            <Field label="Capex % of revenue"><PctInput value={model.capexPct} onChange={(capexPct) => update({ capexPct })} /></Field>
            <Field label="Working capital % of revenue" hint="Receivables + inventory − payables − deferred revenue"><PctInput value={model.nwcPct} onChange={(nwcPct) => update({ nwcPct })} /></Field>
            <Field label="Stock comp % of revenue"><PctInput value={model.sbcPct} onChange={(sbcPct) => update({ sbcPct })} /></Field>
            <div className="flex items-end pb-1.5"><Toggle checked={model.deductSbc} onChange={(deductSbc) => update({ deductSbc })} label="Treat SBC as a cost" /></div>
          </div>
        </Panel>

        {/* Discount rate */}
        <Panel>
          <PanelHeader kicker="Assumptions" title={`Discount rate ${pct(wacc)}`} />
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            <Field label="Risk-free rate" hint={data.market.riskFreeAsOf ? `10Y Treasury, ${data.market.riskFreeAsOf}` : '10Y Treasury'}><PctInput value={model.riskFree} onChange={(riskFree) => update({ riskFree })} /></Field>
            <Field label="Beta" hint={data.market.rawBeta !== null ? `2Y daily vs S&P 500: ${data.market.rawBeta.toFixed(2)}` : 'No price history: 1.0'}><NumberInput value={model.beta} onChange={(beta) => update({ beta })} /></Field>
            <Field label="Equity risk premium"><PctInput value={model.equityRiskPremium} onChange={(equityRiskPremium) => update({ equityRiskPremium })} /></Field>
            <Field label="Pre-tax cost of debt" hint="Interest expense ÷ debt"><PctInput value={model.costOfDebt} onChange={(costOfDebt) => update({ costOfDebt })} /></Field>
            <Field label="Terminal growth"><PctInput value={model.terminalGrowth} onChange={(terminalGrowth) => update({ terminalGrowth })} /></Field>
            <Field label="Override WACC">
              <PctInput value={model.useWaccOverride ? model.waccOverride : capital.wacc} onChange={(waccOverride) => update({ waccOverride, useWaccOverride: true })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-2.5 text-[11.5px] text-muted">
            <span>Cost of equity {pct(capital.costOfEquity)}</span>
            <span>After-tax debt {pct(capital.afterTaxDebt)}</span>
            <span>Debt weight {pct(capital.debtWeight)}</span>
            {model.useWaccOverride ? (
              <button type="button" className="text-brand-soft hover:underline" onClick={() => update({ useWaccOverride: false })}>Use calculated WACC</button>
            ) : null}
          </div>
          <div className="border-t border-line px-4 py-2.5"><Toggle checked={model.midYear} onChange={(midYear) => update({ midYear })} label="Mid-year discounting" /></div>
        </Panel>

        {/* Bridge */}
        <Panel>
          <PanelHeader kicker="Enterprise → equity" title={`Bridge${data.bridge.asOf ? ` (${data.bridge.asOf})` : ''}`} />
          <div className="flex flex-col gap-2 px-4 pb-3 text-[12.5px]">
            <BridgeRow label="Enterprise value" value={m(result.enterpriseValue)} strong />
            <BridgeRow label="+ Cash & short-term investments" input={<MillionsInput value={model.cash} onChange={(cash) => update({ cash })} />} />
            <BridgeRow label="− Debt" input={<MillionsInput value={model.debt} onChange={(debt) => update({ debt })} />} />
            <BridgeRow
              label={
                <span className="flex items-center gap-2">
                  − Lease liabilities
                  <Switch checked={model.includeLeases} onChange={(includeLeases) => update({ includeLeases })} label="Include lease liabilities" />
                </span>
              }
              input={<MillionsInput value={model.leases} onChange={(leases) => update({ leases })} />}
              missing={data.bridge.leases === null}
            />
            <BridgeRow label="− Minority interest" input={<MillionsInput value={model.minorityInterest} onChange={(minorityInterest) => update({ minorityInterest })} />} missing={data.bridge.minorityInterest === null} />
            <BridgeRow label="− Preferred stock" input={<MillionsInput value={model.preferredStock} onChange={(preferredStock) => update({ preferredStock })} />} missing={data.bridge.preferredStock === null} />
            <BridgeRow label="Equity value" value={m(result.equityValue)} strong />
            <BridgeRow
              label={data.bridge.sharesFromQuote ? 'Shares, in quoted units (M)' : 'Shares outstanding (M)'}
              input={<NumberInput value={model.shares / 1e6} digits={1} onChange={(value) => update({ shares: value * 1e6 })} />}
            />
          </div>
          <p className="border-t border-line px-4 py-2.5 text-[11px] text-faint">
            {data.bridge.sharesFromQuote ? 'The share count is market cap ÷ quoted price, so it counts ADRs or the quoted share class rather than filed ordinary shares. ' : ''}
            Include leases when EBIT is after rent (US GAAP operating leases); leave them out to avoid double-counting. “None reported” means the filing had no tagged value.
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sensitivity */}
        <Panel className="overflow-hidden">
          <PanelHeader kicker="Sensitivity" title="Value per share: discount rate × terminal growth" />
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-faint">WACC ↓ g →</th>
                  {computed.growths.map((growth) => <th key={growth} className="px-2 py-1.5 text-right font-mono font-medium text-muted">{pct(growth)}</th>)}
                </tr>
              </thead>
              <tbody>
                {computed.grid.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-line">
                    <td className="px-2 py-1.5 font-mono text-muted">{pct(computed.waccs[rowIndex])}</td>
                    {row.map((value, columnIndex) => {
                      const usd = value !== null && computed.waccs[rowIndex] > computed.growths[columnIndex] ? value * fx : null;
                      const center = rowIndex === 2 && columnIndex === 2;
                      const tone = usd !== null && data.price ? (usd >= data.price ? 'text-gain' : 'text-loss') : 'text-faint';
                      return (
                        <td key={columnIndex} className={cn('px-2 py-1.5 text-right font-mono tabular-nums', tone, center && 'rounded-sm bg-white/[0.06] font-semibold')}>
                          {usd === null ? '—' : price(usd)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Analyst forecasts */}
        <Panel>
          <PanelHeader kicker="Analyst consensus" title="Forecasts" />
          <div className="flex flex-col gap-3 px-4 pb-4 text-[12.5px]">
            {data.forecasts.revenue.length ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-muted">
                    <th className="py-1 text-left font-medium">Fiscal year</th>
                    <th className="py-1 text-right font-medium">Revenue</th>
                    <th className="py-1 text-right font-medium">Growth</th>
                    <th className="py-1 text-right font-medium">EBIT</th>
                    <th className="py-1 text-right font-medium">EPS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecasts.revenue.map((row) => (
                    <tr key={row.fiscalEnd} className="border-t border-line font-mono tabular-nums">
                      <td className="py-1.5 text-ink-2">{row.fiscalEnd.slice(0, 7)}</td>
                      <td className="py-1.5 text-right">{m(row.revenue)}</td>
                      <td className="py-1.5 text-right">{pct(row.growth)}</td>
                      <td className="py-1.5 text-right">{m(row.ebit)}</td>
                      <td className="py-1.5 text-right">{row.eps?.toFixed(2) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {data.forecasts.eps.length ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-muted">
                    <th className="py-1 text-left font-medium">Fiscal year end</th>
                    <th className="py-1 text-right font-medium">Consensus EPS</th>
                    <th className="py-1 text-right font-medium">Range</th>
                    <th className="py-1 text-right font-medium">Growth</th>
                    <th className="py-1 text-right font-medium">Analysts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecasts.eps.map((row, index) => {
                    const previous = index === 0 ? data.forecasts.trailingEps : data.forecasts.eps[index - 1].eps;
                    const growth = previous && previous > 0 && row.eps !== null ? row.eps / previous - 1 : null;
                    return (
                      <tr key={row.fiscalEnd} className="border-t border-line font-mono tabular-nums">
                        <td className="py-1.5 text-ink-2">{row.fiscalEnd}</td>
                        <td className="py-1.5 text-right">{row.eps?.toFixed(2)}</td>
                        <td className="py-1.5 text-right text-muted">{row.low?.toFixed(2)}–{row.high?.toFixed(2)}</td>
                        <td className="py-1.5 text-right">{pct(growth)}</td>
                        <td className="py-1.5 text-right text-muted">{row.analysts ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
            {!data.forecasts.revenue.length && !data.forecasts.eps.length ? <p className="text-muted">No analyst forecasts found for this company.</p> : null}
            {data.defaults.cagr3 !== null ? <p className="text-[11.5px] text-muted">Reported revenue CAGR, last 3 years: {pct(data.defaults.cagr3)}</p> : null}
            {!data.forecasts.fmpEnabled ? (
              <p className="text-[11px] text-faint">Multi-year revenue and EBIT estimates need a free FMP_API_KEY in .env.local. Without it, only consensus EPS is shown.</p>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ImpliedRow({
  label,
  value,
  current,
  format,
  onApply,
}: {
  label: string;
  value: number | null;
  current: number;
  format: (value: number) => string;
  onApply: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">{label}</span>
      <span className="ml-auto font-mono tabular-nums text-ink">{value === null ? 'out of range' : format(value)}</span>
      <span className="w-24 text-right font-mono text-[11px] text-faint tabular-nums">now {format(current)}</span>
      <Button size="xs" variant="ghost" onClick={onApply} disabled={value === null}>Apply</Button>
    </div>
  );
}

function BridgeRow({ label, value, input, strong, missing }: { label: ReactNode; value?: string; input?: ReactNode; strong?: boolean; missing?: boolean }) {
  return (
    <div className={cn('grid grid-cols-[1fr_120px] items-center gap-2', strong && 'border-t border-line pt-2')}>
      <span className={cn(strong ? 'font-medium text-ink' : 'text-muted')}>
        {label}
        {missing ? <span className="ml-1.5 text-[10.5px] text-faint">none reported</span> : null}
      </span>
      {input ?? <span className={cn('text-right font-mono tabular-nums', strong ? 'font-semibold text-ink' : 'text-ink-2')}>{value}</span>}
    </div>
  );
}

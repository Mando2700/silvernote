'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';

import { type WaterfallStep } from '@/components/charts/svg';
import { TweenedLineChart as LineChart, TweenedWaterfall as Waterfall } from '@/components/learn/animated-charts';
import { AskGrok, DataState, Readout, Slider, TickerPicker, Widget } from '@/components/learn/blocks';
import { useDailyCloses, useDcfInputs } from '@/components/learn/hooks';
import { XYChart } from '@/components/learn/xy-chart';
import { Segmented } from '@/components/ui/primitives';
import { money, multiple, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

const usd = (value: number) => money(value, { compact: Math.abs(value) >= 10_000, digits: Math.abs(value) >= 10_000 ? 1 : 0 });

// ─── Compounding and discounting ──────────────────────────────────────────────

export function CompoundingWidget() {
  const [mode, setMode] = useState<'grow' | 'discount'>('grow');
  const [amount, setAmount] = useState(10_000);
  const [rate, setRate] = useState(0.08);
  const [years, setYears] = useState(25);
  const categories = Array.from({ length: years + 1 }, (_, year) => (year === 0 ? 'Now' : `${year}y`));
  const compound = categories.map((_, year) => amount * (1 + rate) ** year);
  const simple = categories.map((_, year) => amount * (1 + rate * year));
  const discounted = categories.map((_, year) => amount / (1 + rate) ** year);
  const doubling = rate > 0 ? Math.log(2) / Math.log(1 + rate) : Infinity;

  return (
    <Widget
      title={mode === 'grow' ? 'Watch compounding pull away from simple interest' : 'What a future dollar is worth today'}
      actions={<Segmented size="xs" value={mode} onChange={setMode} options={[{ value: 'grow', label: 'Compound' }, { value: 'discount', label: 'Discount' }]} />}
      footer={
        mode === 'grow'
          ? `Rule of 72: 72 / ${(rate * 100).toFixed(1)} ≈ ${rate > 0 ? (72 / (rate * 100)).toFixed(1) : '∞'} years to double. Exact: ${Number.isFinite(doubling) ? doubling.toFixed(1) : '∞'} years.`
          : `Discounting is compounding run backwards: PV = FV / (1 + r)^t. The further away, the less it is worth today.`
      }
    >
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-4">
          <Slider label={mode === 'grow' ? 'Invest today' : 'Receive in the future'} value={amount} min={1000} max={100_000} step={1000} onChange={setAmount} format={(value) => money(value, { digits: 0 })} />
          <Slider label="Annual rate" value={rate} min={0} max={0.15} step={0.0025} onChange={setRate} format={(value) => pct(value, 2)} />
          <Slider label="Years" value={years} min={1} max={40} step={1} onChange={setYears} format={(value) => `${value}`} />
          <div className="grid grid-cols-2 gap-2">
            {mode === 'grow' ? (
              <>
                <Readout label={`Value in ${years}y`} value={usd(compound[years])} tone="brand" />
                <Readout label="Growth multiple" value={multiple(compound[years] / amount, 2)} sub={`simple: ${multiple(simple[years] / amount, 2)}`} />
              </>
            ) : (
              <>
                <Readout label="Worth today" value={usd(discounted[years])} tone="brand" />
                <Readout label="Discount factor" value={(1 / (1 + rate) ** years).toFixed(3)} sub={`1 / ${(1 + rate).toFixed(3)}^${years}`} />
              </>
            )}
          </div>
        </div>
        <LineChart
          categories={categories}
          height={260}
          format={(value) => money(value, { compact: true })}
          series={
            mode === 'grow'
              ? [
                  { label: 'Compound', values: compound, color: 'var(--color-series-1)', emphasis: true },
                  { label: 'Simple', values: simple, color: 'var(--color-series-2)', dashed: true },
                ]
              : [{ label: 'Present value', values: discounted, color: 'var(--color-series-1)', emphasis: true }]
          }
        />
      </div>
    </Widget>
  );
}

// ─── NPV and IRR ────────────────────────────────────────────────────────────

export function npv(rate: number, flows: number[]) {
  return flows.reduce((sum, flow, year) => sum + flow / (1 + rate) ** year, 0);
}

/** IRR by bisection on [-0.99, 10]; null when NPV doesn't change sign. */
export function irr(flows: number[]) {
  let lo = -0.99;
  let hi = 10;
  const at = (rate: number) => npv(rate, flows);
  if (Math.sign(at(lo)) === Math.sign(at(hi))) return null;
  for (let step = 0; step < 100; step += 1) {
    const mid = (lo + hi) / 2;
    if (Math.sign(at(mid)) === Math.sign(at(lo))) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function NpvIrrWidget() {
  const [investment, setInvestment] = useState(1000);
  const [flows, setFlows] = useState([200, 260, 320, 350, 380]);
  const [rate, setRate] = useState(0.1);
  const all = [-investment, ...flows];
  const value = npv(rate, all);
  const internal = irr(all);
  const profile = Array.from({ length: 41 }, (_, index) => {
    const r = index / 100;
    return [r, npv(r, all)] as [number, number];
  });
  let cumulative = -investment;
  let payback: number | null = null;
  flows.forEach((flow, index) => {
    const before = cumulative;
    cumulative += flow;
    if (payback === null && cumulative >= 0) payback = index + (flow ? -before / flow : 0);
  });

  return (
    <Widget
      title="A project: invest now, collect for five years"
      footer="NPV adds every cash flow in today’s dollars. The IRR is the discount rate where NPV hits zero — where the curve crosses the axis."
    >
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-3">
          <Slider label="Investment today" value={investment} min={200} max={2000} step={50} onChange={setInvestment} format={(v) => money(-v, { digits: 0 })} />
          {flows.map((flow, index) => (
            <Slider
              key={index}
              label={`Year ${index + 1} cash flow`}
              value={flow}
              min={0}
              max={800}
              step={10}
              onChange={(next) => setFlows((current) => current.map((item, i) => (i === index ? next : item)))}
              format={(v) => money(v, { digits: 0 })}
            />
          ))}
          <Slider label="Discount rate" value={rate} min={0} max={0.3} step={0.005} onChange={setRate} format={(v) => pct(v, 1)} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Readout label={`NPV at ${pct(rate, 1)}`} value={money(value, { digits: 0 })} tone={value >= 0 ? 'gain' : 'loss'} sub={value >= 0 ? 'creates value' : 'destroys value'} />
            <Readout label="IRR" value={internal === null ? '—' : pct(internal, 1)} tone="brand" sub={internal !== null && internal > rate ? 'above your hurdle' : 'below your hurdle'} />
            <Readout label="Payback" value={payback === null ? 'never' : `${(payback as number).toFixed(1)} yrs`} sub="undiscounted" />
          </div>
          <XYChart
            height={250}
            xDomain={[0, 0.4]}
            xFormat={(v) => pct(v, 0)}
            yFormat={(v) => money(v, { compact: true })}
            hoverLabel={(r) => `At ${pct(r, 1)}: NPV ${money(npv(r, all), { digits: 0 })}`}
            layers={[
              { type: 'hline', y: 0, color: 'rgba(255,255,255,0.3)', dashed: false },
              { type: 'line', points: profile, color: 'var(--color-series-1)', width: 2 },
              { type: 'dot', x: rate, y: value, color: 'var(--color-brand-bright)', label: `you: ${money(value, { digits: 0 })}` },
              ...(internal !== null && internal <= 0.4 ? [{ type: 'vline' as const, x: internal, color: 'var(--color-ion)', label: `IRR ${pct(internal, 1)}` }] : []),
            ]}
          />
        </div>
      </div>
    </Widget>
  );
}

// ─── CAGR on a real stock ─────────────────────────────────────────────────────

export function CagrWidget() {
  const [symbol, setSymbol] = useState('MSFT');
  const { candles, isLoading, error } = useDailyCloses(symbol, 10);
  const stats = useMemo(() => {
    if (!candles || candles.length < 300) return null;
    const first = candles[0];
    const last = candles[candles.length - 1];
    const years = (last.t - first.t) / (365.25 * 86_400);
    const cagr = (last.c / first.c) ** (1 / years) - 1;
    const arithmetic = (last.c / first.c - 1) / years;
    const step = Math.max(1, Math.floor(candles.length / 160));
    const sampled = candles.filter((_, index) => index % step === 0 || index === candles.length - 1);
    return { first, last, years, cagr, arithmetic, sampled };
  }, [candles]);

  return (
    <Widget
      kicker={`Live data · ${symbol}`}
      title="Ten years of a real stock, in one number"
      actions={<AskGrok symbol={symbol} prompt={`Explain what drove ${symbol}'s compound annual return over the last ten years: how much came from revenue growth, margin change and multiple change?`} label="Why?" />}
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['MSFT', 'KO', 'NVDA', 'XOM', 'SPY']} />
      </div>
      {!stats ? (
        <DataState loading={isLoading} error={error} empty="Not enough price history for this ticker." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
          <XYChart
            height={230}
            xFormat={(t) => String(new Date(t * 1000).getUTCFullYear())}
            yFormat={(v) => `$${v.toFixed(0)}`}
            hoverLabel={(t) => {
              const nearest = stats.sampled.reduce((best, candle) => (Math.abs(candle.t - t) < Math.abs(best.t - t) ? candle : best), stats.sampled[0]);
              return `${new Date(nearest.t * 1000).toISOString().slice(0, 10)} · $${nearest.c.toFixed(2)}`;
            }}
            layers={[
              { type: 'line', points: stats.sampled.map((candle) => [candle.t, candle.c]), color: 'var(--color-series-1)', width: 1.75 },
              {
                type: 'line',
                points: stats.sampled.map((candle) => [candle.t, stats.first.c * (1 + stats.cagr) ** ((candle.t - stats.first.t) / (365.25 * 86_400))]),
                color: 'var(--color-brand-soft)',
                dashed: true,
                width: 1.25,
              },
            ]}
          />
          <div className="flex flex-col gap-2">
            <Readout label="CAGR" value={pct(stats.cagr, 1)} tone="brand" sub={`over ${stats.years.toFixed(1)} years`} />
            <Readout label="Total return (price)" value={multiple(stats.last.c / stats.first.c, 1)} sub={`$${stats.first.c.toFixed(2)} → $${stats.last.c.toFixed(2)}`} />
            <Readout label="Naive average (÷ years)" value={pct(stats.arithmetic, 1)} sub="ignores compounding — wrong" />
            <p className="text-[11.5px] leading-snug text-muted">The dashed line grows at exactly the CAGR: same start, same end, no volatility. Prices are split-adjusted and exclude dividends.</p>
          </div>
        </div>
      )}
    </Widget>
  );
}

// ─── Three-statement transaction simulator ──────────────────────────────────

type Delta = { line: string; value: number; total?: boolean };
type Event = { id: string; label: string; detail: string; is: Delta[]; cfs: Delta[]; bs: { assets: Delta[]; liabilities: Delta[]; equity: Delta[] }; insight: string };

const EVENTS: Event[] = [
  {
    id: 'dep',
    label: 'Depreciation +$10',
    detail: 'The classic interview question. 25% tax rate.',
    is: [{ line: 'Depreciation', value: -10 }, { line: 'Pre-tax income', value: -10, total: true }, { line: 'Taxes (saved)', value: 2.5 }, { line: 'Net income', value: -7.5, total: true }],
    cfs: [{ line: 'Net income', value: -7.5 }, { line: 'Add back depreciation', value: 10 }, { line: 'Cash from operations', value: 2.5, total: true }, { line: 'Net change in cash', value: 2.5, total: true }],
    bs: { assets: [{ line: 'Cash', value: 2.5 }, { line: 'PP&E', value: -10 }], liabilities: [], equity: [{ line: 'Retained earnings', value: -7.5 }] },
    insight: 'Depreciation is non-cash, so the only cash effect is the tax it saves: +$2.50.',
  },
  {
    id: 'inventory',
    label: 'Buy $100 inventory (cash)',
    detail: 'Stock the shelves before selling anything.',
    is: [],
    cfs: [{ line: 'Increase in inventory', value: -100 }, { line: 'Cash from operations', value: -100, total: true }, { line: 'Net change in cash', value: -100, total: true }],
    bs: { assets: [{ line: 'Cash', value: -100 }, { line: 'Inventory', value: 100 }], liabilities: [], equity: [] },
    insight: 'Nothing hits the income statement until the goods are sold — but cash is gone today. Growth consumes working capital.',
  },
  {
    id: 'sale',
    label: 'Sell it for $150 on credit',
    detail: 'The customer will pay in 60 days.',
    is: [{ line: 'Revenue', value: 150 }, { line: 'COGS', value: -100 }, { line: 'Pre-tax income', value: 50, total: true }, { line: 'Taxes', value: -12.5 }, { line: 'Net income', value: 37.5, total: true }],
    cfs: [{ line: 'Net income', value: 37.5 }, { line: 'Decrease in inventory', value: 100 }, { line: 'Increase in receivables', value: -150 }, { line: 'Cash from operations', value: -12.5, total: true }, { line: 'Net change in cash', value: -12.5, total: true }],
    bs: { assets: [{ line: 'Cash', value: -12.5 }, { line: 'Accounts receivable', value: 150 }, { line: 'Inventory', value: -100 }], liabilities: [], equity: [{ line: 'Retained earnings', value: 37.5 }] },
    insight: 'A profitable sale with negative cash flow: the tax is paid now, the customer pays later. Profit ≠ cash.',
  },
  {
    id: 'prepay',
    label: 'Customer prepays $50',
    detail: 'A subscription paid a year in advance.',
    is: [],
    cfs: [{ line: 'Increase in deferred revenue', value: 50 }, { line: 'Cash from operations', value: 50, total: true }, { line: 'Net change in cash', value: 50, total: true }],
    bs: { assets: [{ line: 'Cash', value: 50 }], liabilities: [{ line: 'Deferred revenue', value: 50 }], equity: [] },
    insight: 'Cash before revenue: subscription businesses are partly financed by their customers.',
  },
  {
    id: 'capex',
    label: 'Buy $50 of equipment',
    detail: 'Capital expenditure paid in cash.',
    is: [],
    cfs: [{ line: 'Capital expenditures', value: -50 }, { line: 'Cash from investing', value: -50, total: true }, { line: 'Net change in cash', value: -50, total: true }],
    bs: { assets: [{ line: 'Cash', value: -50 }, { line: 'PP&E', value: 50 }], liabilities: [], equity: [] },
    insight: 'Capex skips the income statement today and comes back as depreciation over the asset’s life. EBITDA never sees it.',
  },
  {
    id: 'debt',
    label: 'Borrow $100',
    detail: 'Issue a bond.',
    is: [],
    cfs: [{ line: 'Debt issued', value: 100 }, { line: 'Cash from financing', value: 100, total: true }, { line: 'Net change in cash', value: 100, total: true }],
    bs: { assets: [{ line: 'Cash', value: 100 }], liabilities: [{ line: 'Debt', value: 100 }], equity: [] },
    insight: 'Borrowing isn’t income. Cash and debt rise together, so enterprise value doesn’t change.',
  },
  {
    id: 'interest',
    label: 'Pay $20 interest',
    detail: 'Interest on that debt, tax-deductible.',
    is: [{ line: 'Interest expense', value: -20 }, { line: 'Pre-tax income', value: -20, total: true }, { line: 'Taxes (saved)', value: 5 }, { line: 'Net income', value: -15, total: true }],
    cfs: [{ line: 'Net income', value: -15 }, { line: 'Cash from operations', value: -15, total: true }, { line: 'Net change in cash', value: -15, total: true }],
    bs: { assets: [{ line: 'Cash', value: -15 }], liabilities: [], equity: [{ line: 'Retained earnings', value: -15 }] },
    insight: 'The $5 tax saving is the "interest tax shield" that makes debt cheaper than equity in WACC.',
  },
  {
    id: 'sbc',
    label: '$10 stock-based comp',
    detail: 'Pay employees in shares (assume tax-deductible).',
    is: [{ line: 'Stock-based compensation', value: -10 }, { line: 'Pre-tax income', value: -10, total: true }, { line: 'Taxes (saved)', value: 2.5 }, { line: 'Net income', value: -7.5, total: true }],
    cfs: [{ line: 'Net income', value: -7.5 }, { line: 'Add back SBC', value: 10 }, { line: 'Cash from operations', value: 2.5, total: true }, { line: 'Net change in cash', value: 2.5, total: true }],
    bs: { assets: [{ line: 'Cash', value: 2.5 }], liabilities: [], equity: [{ line: 'Common stock & APIC', value: 10 }, { line: 'Retained earnings', value: -7.5 }] },
    insight: 'Cash goes up — but existing shareholders own less of the company. That’s why analysts treat SBC as a real cost.',
  },
  {
    id: 'dividend',
    label: 'Pay a $20 dividend',
    detail: 'Return cash to shareholders.',
    is: [],
    cfs: [{ line: 'Dividends paid', value: -20 }, { line: 'Cash from financing', value: -20, total: true }, { line: 'Net change in cash', value: -20, total: true }],
    bs: { assets: [{ line: 'Cash', value: -20 }], liabilities: [], equity: [{ line: 'Retained earnings', value: -20 }] },
    insight: 'Dividends are a distribution of profit, not an expense — they never touch the income statement.',
  },
  {
    id: 'impairment',
    label: '$30 goodwill write-down',
    detail: 'An acquisition went badly (not tax-deductible).',
    is: [{ line: 'Impairment', value: -30 }, { line: 'Pre-tax income', value: -30, total: true }, { line: 'Net income', value: -30, total: true }],
    cfs: [{ line: 'Net income', value: -30 }, { line: 'Add back impairment', value: 30 }, { line: 'Cash from operations', value: 0, total: true }],
    bs: { assets: [{ line: 'Goodwill', value: -30 }], liabilities: [], equity: [{ line: 'Retained earnings', value: -30 }] },
    insight: 'A big "loss" with zero cash impact: the money was spent years ago, when the deal closed.',
  },
];

function DeltaRows({ rows, empty = 'No change' }: { rows: Delta[]; empty?: string }) {
  if (!rows.length) return <div className="py-2 text-[12px] text-faint italic">{empty}</div>;
  return (
    <div className="flex flex-col">
      {rows.map((row, index) => (
        <motion.div
          key={row.line + index}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.07, duration: 0.3 }}
          className={cn('flex items-center justify-between gap-2 py-1 text-[12.5px]', row.total && 'border-t border-line pt-1.5 font-semibold')}
        >
          <span className={row.total ? 'text-ink' : 'text-ink-2'}>{row.line}</span>
          <span className={cn('num font-mono', row.value > 0 ? 'text-gain' : row.value < 0 ? 'text-loss' : 'text-muted')}>
            {row.value > 0 ? '+' : row.value < 0 ? '−' : ''}${Math.abs(row.value).toFixed(Number.isInteger(row.value) ? 0 : 2)}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

export function StatementSimulator() {
  const [id, setId] = useState('dep');
  const event = EVENTS.find((item) => item.id === id) ?? EVENTS[0];
  const sum = (rows: Delta[]) => rows.reduce((total, row) => total + row.value, 0);
  const assets = sum(event.bs.assets);
  const claims = sum(event.bs.liabilities) + sum(event.bs.equity);

  return (
    <Widget title="Push a transaction through all three statements" footer={<span><strong className="text-ink">Why it matters:</strong> {event.insight}</span>}>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {EVENTS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setId(item.id)}
            className={cn(
              'rounded-sm border px-2.5 py-1 text-[12px] transition-colors',
              item.id === id ? 'border-brand/50 bg-brand-wash text-ink' : 'border-line text-muted hover:border-line-strong hover:text-ink-2',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mb-3 text-[12.5px] text-muted">{event.detail}</div>
      <AnimatePresence mode="wait">
        <motion.div key={event.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-line bg-surface-1 p-3">
            <div className="kicker mb-1.5">1 · Income statement</div>
            <DeltaRows rows={event.is} empty="No income statement effect" />
          </div>
          <div className="rounded-md border border-line bg-surface-1 p-3">
            <div className="kicker mb-1.5">2 · Cash flow statement</div>
            <DeltaRows rows={event.cfs} />
          </div>
          <div className="rounded-md border border-line bg-surface-1 p-3">
            <div className="kicker mb-1.5">3 · Balance sheet</div>
            <div className="text-[11px] text-faint">Assets</div>
            <DeltaRows rows={event.bs.assets} />
            <div className="mt-2 text-[11px] text-faint">Liabilities</div>
            <DeltaRows rows={event.bs.liabilities} />
            <div className="mt-2 text-[11px] text-faint">Equity</div>
            <DeltaRows rows={event.bs.equity} />
            <div className={cn('mt-3 flex items-center justify-between rounded-sm px-2 py-1.5 font-mono text-[11.5px]', Math.abs(assets - claims) < 1e-9 ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss')}>
              <span>Assets {assets >= 0 ? '+' : '−'}${Math.abs(assets).toFixed(2)}</span>
              <span>= L + E {claims >= 0 ? '+' : '−'}${Math.abs(claims).toFixed(2)} ✓</span>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </Widget>
  );
}

// ─── Revenue → unlevered free cash flow on a real company ─────────────────────

export function RevenueToFcfWidget() {
  const [symbol, setSymbol] = useState('COST');
  const { data, isLoading, error } = useDcfInputs(symbol);
  const year = data?.history.filter((row) => row.revenue !== null && row.ebit !== null).at(-1) ?? null;
  const fmt = (value: number) => money(value, { compact: true, currency: data?.currency });

  const steps = year
    ? (() => {
        const revenue = year.revenue as number;
        const ebit = year.ebit as number;
        const nopat = year.nopat ?? ebit * 0.79;
        const da = year.da ?? 0;
        const capex = year.capex ?? 0;
        const nwc = year.changeNwc ?? 0;
        const fcf = nopat + da - capex - nwc;
        return {
          revenue,
          fcf,
          list: [
            { label: 'Revenue', value: revenue, kind: 'start' as const },
            { label: 'Operating costs', value: ebit - revenue, kind: 'delta' as const },
            { label: 'EBIT', value: ebit, kind: 'total' as const },
            { label: 'Taxes on EBIT', value: nopat - ebit, kind: 'delta' as const },
            { label: 'NOPAT', value: nopat, kind: 'total' as const },
            { label: '+ D&A', value: da, kind: 'delta' as const },
            { label: '− Capex', value: -capex, kind: 'delta' as const },
            { label: '− ΔNWC', value: -nwc, kind: 'delta' as const },
            { label: 'Unlevered FCF', value: fcf, kind: 'total' as const, emphasis: true },
          ],
        };
      })()
    : null;

  return (
    <Widget
      kicker={`Live data · ${symbol}${year ? ` · ${year.label}` : ''}`}
      title="From revenue to the cash a DCF discounts"
      actions={<AskGrok symbol={symbol} prompt={`Walk me through ${symbol}'s latest year from revenue to unlevered free cash flow. Which line is unusual versus its history and peers, and why?`} />}
      footer="Unlevered FCF = EBIT × (1 − tax) + D&A − capex − increase in working capital. Reported free cash flow differs: it is after interest and adds back stock comp."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['COST', 'AAPL', 'NVDA', 'KO', 'CAT']} />
      </div>
      {!steps ? (
        <DataState loading={isLoading} error={error} empty={data?.financial ? 'Banks and insurers don’t fit this bridge — debt is their raw material. Try an industrial or tech company.' : 'No filed statements with operating income for this ticker.'} height={260} />
      ) : (
        <>
          <Waterfall steps={steps.list} format={fmt} height={270} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Readout label="EBIT margin" value={pct(year?.ebitMargin ?? null, 1)} />
            <Readout label="Tax rate" value={pct(year?.taxRate ?? null, 1)} />
            <Readout label="FCF / revenue" value={pct(steps.fcf / steps.revenue, 1)} tone="brand" />
            <Readout label="Reported FCF" value={year?.freeCashFlow != null ? fmt(year.freeCashFlow) : '—'} sub="CFO − capex, as filed" />
          </div>
        </>
      )}
    </Widget>
  );
}

// ─── Enterprise value bridge on a real company ────────────────────────────────

export function EvBridgeWidget() {
  const [symbol, setSymbol] = useState('AAPL');
  const { data, isLoading, error } = useDcfInputs(symbol);
  const bridge = data?.bridge;
  const marketCap = data?.marketCap ?? null;
  const fx = data?.fxToUsd ?? 1;
  const toUsd = (value: number | null | undefined) => (value ?? 0) * fx;
  const fmt = (value: number) => money(value, { compact: true });
  const latest = data?.history.at(-1);
  const ebitda = latest && latest.ebit !== null ? ((latest.ebit ?? 0) + (latest.da ?? 0)) * fx : null;

  const ev = bridge && marketCap !== null ? marketCap + toUsd(bridge.debt) + toUsd(bridge.leases) + toUsd(bridge.minorityInterest) + toUsd(bridge.preferredStock) - toUsd(bridge.cash) : null;

  return (
    <Widget
      kicker={`Live data · ${symbol}`}
      title="From market cap to enterprise value"
      actions={<AskGrok symbol={symbol} prompt={`Break down ${symbol}'s enterprise value bridge. Is its cash really excess cash, and should its leases be treated as debt? What does that do to its EV/EBITDA?`} />}
      footer="Add every claim that isn’t common equity; subtract cash, which a buyer effectively gets back. Balance-sheet items are from the latest filing."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['AAPL', 'GOOGL', 'T', 'F', 'DAL']} />
      </div>
      {!bridge || marketCap === null || ev === null ? (
        <DataState loading={isLoading} error={error} empty="No market value or balance sheet for this ticker." height={250} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_230px]">
          <Waterfall
            height={260}
            format={fmt}
            steps={([
              { label: 'Market cap', value: marketCap, kind: 'start' },
              { label: '+ Debt', value: toUsd(bridge.debt), kind: 'delta' },
              { label: '+ Leases', value: toUsd(bridge.leases), kind: 'delta' },
              { label: '+ Minority', value: toUsd(bridge.minorityInterest), kind: 'delta' },
              { label: '+ Preferred', value: toUsd(bridge.preferredStock), kind: 'delta' },
              { label: '− Cash', value: -toUsd(bridge.cash), kind: 'delta' },
              { label: 'Enterprise value', value: ev, kind: 'total', emphasis: true },
            ] satisfies WaterfallStep[]).filter((step) => step.kind !== 'delta' || Math.abs(step.value) > marketCap * 0.001)}
          />
          <div className="flex flex-col gap-2">
            <Readout label="Enterprise value" value={fmt(ev)} tone="brand" sub={`${ev > marketCap ? '+' : '−'}${pct(Math.abs(ev / marketCap - 1), 0)} vs market cap`} />
            <Readout label="EV / EBITDA" value={ebitda && ebitda > 0 ? multiple(ev / ebitda, 1) : '—'} sub={latest ? `EBITDA ${latest.label}` : undefined} />
            <Readout label="Net debt" value={fmt(toUsd(bridge.debt) - toUsd(bridge.cash))} sub={toUsd(bridge.debt) < toUsd(bridge.cash) ? 'net cash — EV below market cap' : 'EV above market cap'} />
          </div>
        </div>
      )}
    </Widget>
  );
}

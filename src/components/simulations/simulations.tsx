'use client';

import { Briefcase, FlaskConical, Play, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { FanChart } from '@/components/charts/fan-chart';
import { ColumnChart, LineChart, SERIES_COLORS } from '@/components/charts/svg';
import { Delta } from '@/components/motion/delta';
import { Page } from '@/components/shell/page';
import { useShell } from '@/components/shell/providers';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Select, Skeleton, Tabs } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { localToday } from '@/lib/dates';
import { api } from '@/lib/client';
import { fixed, money, pct, shortDate, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MonteCarloInput, MonteCarloResult } from '@/workers/montecarlo.worker';

type PortfolioListItem = { id: string; name: string; summary: { totalValue: number; positions: number } };
type Model = {
  symbols: string[];
  weights: number[];
  returns: number[][];
  benchmark: string | null;
  days: number;
  from: number | null;
  totalValue: number;
  invested: number;
  cash: number;
  excluded: string[];
  backfilled: string[];
  riskFree: number;
  beta: number;
  impliedReturn: number;
  historicalReturn: number;
  blendedReturn: number;
};
type Scenario = {
  id: string;
  name: string;
  description: string;
  start: string;
  end: string;
  proxy: string;
  portfolioReturn: number;
  marketReturn: number;
  maxDrawdown: number;
  worstDay: number;
  dollarImpact: number;
  holdings: Array<{ symbol: string; weight: number; return: number; contribution: number; method: 'actual' | 'beta'; beta: number }>;
  path: Array<{ t: number; portfolio: number; market: number }>;
};
type WhatIfSide = {
  total: number;
  stats: null | { annualReturn: number; volatility: number; beta: number | null; sharpe: number | null; sortino: number | null; maxDrawdown: number; var95: number | null };
  concentration: { hhi: number; effectiveN: number; top1: number; top5: number };
  sectors: Array<{ sector: string; weight: number }>;
  stress: Array<{ id: string; name: string; portfolioReturn: number; maxDrawdown: number }>;
};
type WhatIfPurchase = {
  date: string;
  price: number;
  shares: number;
  lastPrice: number;
  valueNow: number;
  gain: number;
  return: number;
  history: null | {
    benchmark: string;
    actualReturn: number | null;
    proposedReturn: number | null;
    benchmarkReturn: number;
    actualValue: number;
    proposedValue: number;
    points: Array<{ t: number; actual: number; proposed: number; benchmark: number }>;
  };
};
type WhatIfResult = { symbol: string; name: string; amount: number; purchase: WhatIfPurchase | null; baseline: WhatIfSide; proposed: WhatIfSide };

function MonteCarlo({ portfolioId }: { portfolioId: string }) {
  // Run once automatically when the model first loads, so the chart is never empty.
  const autoRan = useRef(false);
  const { data: model, isLoading } = useSWR<Model>(`/api/portfolios/${portfolioId}/model`, {
    onSuccess: (fresh) => {
      if (autoRan.current || !fresh.symbols.length) return;
      autoRan.current = true;
      run(fresh);
    },
  });
  const [years, setYears] = useState('10');
  const [simulations, setSimulations] = useState('5000');
  const [method, setMethod] = useState<'bootstrap' | 'normal'>('bootstrap');
  const [contribution, setContribution] = useState('0');
  const [target, setTarget] = useState('');
  const [assumption, setAssumption] = useState('implied');
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const run = (source: Model | undefined = model) => {
    if (!source?.symbols.length) return;
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../workers/montecarlo.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setRunning(true);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: MonteCarloResult; error?: string }>) => {
      setRunning(false);
      if (event.data.ok && event.data.result) setResult(event.data.result);
      else toast.error(event.data.error ?? 'Simulation failed');
      worker.terminate();
    };
    const input: MonteCarloInput = {
      weights: source.weights.map((weight) => (weight * source.invested) / Math.max(1, source.totalValue)),
      returns: source.returns,
      startValue: source.totalValue,
      monthlyContribution: Number(contribution || 0),
      years: Number(years),
      simulations: Number(simulations),
      method,
      target: target ? Number(target) : null,
      annualReturn:
        assumption === 'historical' ? null : assumption === 'implied' ? source.impliedReturn : assumption === 'blended' ? source.blendedReturn : Number(assumption),
      seed: Date.now() % 2 ** 31,
    };
    worker.postMessage(input);
  };

  if (isLoading && !model) return <Skeleton className="h-96" />;
  if (!model?.symbols.length) return <EmptyState title="Not enough price history" body="Monte Carlo needs holdings with at least a few months of daily prices." />;

  const histogram = (() => {
    if (!result) return null;
    const values = [...result.finalValues].sort((a, b) => a - b);
    const low = values[Math.floor(values.length * 0.01)];
    const high = values[Math.floor(values.length * 0.99)];
    const bins = 24;
    const width = (high - low) / bins || 1;
    const counts = new Array(bins).fill(0);
    for (const value of values) {
      if (value < low || value > high) continue;
      counts[Math.min(bins - 1, Math.floor((value - low) / width))] += 1;
    }
    return { categories: counts.map((_, index) => money(low + width * (index + 0.5), { compact: true })), counts };
  })();

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Horizon">
            <Select value={years} onChange={(event) => setYears(event.target.value)} className="w-28">
              {['1', '3', '5', '10', '15', '20', '25', '30', '40'].map((value) => (
                <option key={value} value={value}>
                  {value} years
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Paths">
            <Select value={simulations} onChange={(event) => setSimulations(event.target.value)} className="w-28">
              {['1000', '5000', '10000', '25000'].map((value) => (
                <option key={value} value={value}>
                  {Number(value).toLocaleString()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Method">
            <Segmented
              value={method}
              onChange={setMethod}
              options={[
                { value: 'bootstrap', label: 'Historical bootstrap' },
                { value: 'normal', label: 'Lognormal' },
              ]}
            />
          </Field>
          <Field label="Expected return">
            <Select value={assumption} onChange={(event) => setAssumption(event.target.value)} className="w-48">
              <option value="implied">Market ({pct(model.impliedReturn, 1)} a year)</option>
              <option value="blended">Blended ({pct(model.blendedReturn, 1)} a year)</option>
              <option value="historical">Historical sample</option>
              <option value="0.1">10% a year</option>
              <option value="0.07">7% a year</option>
              <option value="0.05">5% a year</option>
            </Select>
          </Field>
          <Field label="Monthly contribution">
            <Input inputMode="decimal" value={contribution} onChange={(event) => setContribution(event.target.value)} className="w-32" />
          </Field>
          <Field label="Goal (optional)">
            <Input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="$" className="w-32" />
          </Field>
          <Magnetic className="ml-auto">
            <Button variant="primary" loading={running} icon={<Play className="size-3.5" />} onClick={() => run()}>
              Run simulation
            </Button>
          </Magnetic>
        </div>
        <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">
          Using {model.days.toLocaleString()} trading days of history{model.from ? ` since ${shortDate(model.from)}` : ''} for {model.symbols.length} holdings at today’s weights (cash and bonds held flat).
          {model.backfilled.length ? ` Before listing, ${model.backfilled.join(', ')} ${model.backfilled.length === 1 ? 'is' : 'are'} modelled from ${model.benchmark ?? 'the benchmark'} via beta.` : ''}
          {model.excluded.length ? ` Excluded (no history): ${model.excluded.join(', ')}.` : ''}
          {assumption === 'implied' ? ` Expected return = ${pct(model.riskFree, 1)} risk-free + ${model.beta.toFixed(2)} beta × 5% equity premium.` : ''}
          {assumption === 'blended'
            ? ` Expected return = 75% × ${pct(model.impliedReturn, 1)} market + 25% × ${pct(model.historicalReturn, 1)} this portfolio's own history.`
            : ''}
        </div>
      </Panel>

      {result ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {(() => {
              const invested = result.contributions[result.months];
              const start = result.contributions[0];
              const monthly = result.months ? (invested - start) / result.months : 0;
              const multiple = (value: number) => (invested > 0 ? `${(value / invested).toFixed(1)}× money put in` : undefined);
              const median = result.percentiles.p50[result.months];
              const low = result.percentiles.p5[result.months];
              const high = result.percentiles.p95[result.months];
              return [
                {
                  label: `Money put in over ${result.months / 12}y`,
                  value: money(invested, { digits: 0 }),
                  sub: monthly > 0 ? `${money(start, { digits: 0 })} now + ${money(monthly, { digits: 0 })}/mo × ${result.months}` : 'Starting value, no contributions',
                },
                { label: `Median in ${result.months / 12}y`, value: money(median, { digits: 0 }), sub: multiple(median) },
                { label: 'Bad case (5th pct)', value: money(low, { digits: 0 }), sub: multiple(low) },
                { label: 'Good case (95th pct)', value: money(high, { digits: 0 }), sub: multiple(high) },
                { label: 'Chance of ending below money put in', value: pct(result.probabilityOfLoss) },
                result.probabilityOfTarget !== null
                  ? { label: 'Chance of reaching the goal', value: pct(result.probabilityOfTarget) }
                  : { label: 'Median max drawdown', value: signedPct(result.medianMaxDrawdown, 1) },
              ];
            })().map((tile) => (
              <div key={tile.label} className="flex flex-col items-center justify-center rounded-sm border border-line bg-surface-1 p-3 text-center">
                <div className="text-[11px] text-muted">{tile.label}</div>
                <div className="mt-1 text-[17px] font-semibold text-ink">{tile.value}</div>
                {'sub' in tile && tile.sub ? <div className="mt-0.5 text-[11px] text-faint">{tile.sub}</div> : null}
              </div>
            ))}
          </div>
          <Panel>
            <PanelHeader
              kicker={`${Number(simulations).toLocaleString()} paths · ${method === 'bootstrap' ? 'resampled historical months' : 'lognormal'} · ran in ${Math.round(result.elapsedMs)} ms`}
              title="Projected portfolio value"
              actions={
                <span className="text-[11.5px] text-muted">
                  {assumption === 'historical' ? 'Historical' : 'Modelled'} month: {signedPct(result.historicalMonthlyMean, 2)} avg · {pct(result.historicalMonthlyVol, 1)} vol
                </span>
              }
            />
            <div className="px-4 pb-2">
              <FanChart bands={result.percentiles} contributions={result.contributions} height={320} />
            </div>
            <div className="flex flex-wrap gap-4 px-4 pb-4 text-[10.5px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-[2px] w-4 bg-brand" /> Median
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-brand/30" /> 25th–75th percentile
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-brand/10" /> 5th–95th percentile
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-px w-4 border-t border-dashed border-muted" /> Money put in
              </span>
              <span className="ml-auto text-faint">Worst 5% of paths drew down {signedPct(result.worstMaxDrawdown, 0)} or more along the way.</span>
            </div>
          </Panel>
          {histogram ? (
            <Panel>
              <PanelHeader kicker={`Distribution of outcomes after ${result.months / 12} years`} title="Where the paths end" />
              <div className="px-4 pb-4">
                <ColumnChart categories={histogram.categories} series={[{ label: 'Paths', values: histogram.counts }]} format={(value) => value.toFixed(0)} height={200} />
              </div>
            </Panel>
          ) : null}
        </>
      ) : (
        <Skeleton className="h-80" />
      )}
      <p className="text-[11px] leading-relaxed text-faint">
        Projections resample the past; they are not forecasts. Bootstrap keeps real fat tails but assumes the future looks like the sample window; lognormal is smoother and understates crashes. The default market expected return (CAPM: risk-free plus beta times a 5% equity premium) keeps the historical volatility and shape but re-centres the average, which is more prudent than extrapolating a strong sample.
      </p>
    </div>
  );
}

function StressTests({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading } = useSWR<{ totalValue: number; scenarios: Scenario[] }>(`/api/portfolios/${portfolioId}/stress`);
  const [active, setActive] = useState<string | null>(null);
  if (isLoading && !data) return <Skeleton className="h-96" />;
  if (!data?.scenarios.length) return <EmptyState title="Stress tests unavailable" body="Add positions first; the market proxy histories could not be loaded." />;
  const scenario = data.scenarios.find((item) => item.id === active) ?? data.scenarios[0];
  const step = Math.max(1, Math.floor(scenario.path.length / 120));
  const sampled = scenario.path.filter((_, index) => index % step === 0 || index === scenario.path.length - 1);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {data.scenarios.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={cn('rounded-md border p-4 text-left transition-colors', item.id === scenario.id ? 'border-brand/50 bg-brand-wash' : 'border-line bg-surface-2 hover:border-line-strong')}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">{item.name}</span>
              <span className="font-mono text-[10px] text-faint">
                {item.start.slice(0, 7)} → {item.end.slice(0, 7)}
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-[11px] text-muted">Your portfolio</div>
                <div className="text-[22px] font-semibold text-loss">{signedPct(item.portfolioReturn, 1)}</div>
                <div className="text-[11.5px] text-muted">{money(item.dollarImpact, { digits: 0 })}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted">Market</div>
                <div className="text-[15px] font-medium text-ink-2">{signedPct(item.marketReturn, 1)}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <Panel>
        <PanelHeader kicker={`${scenario.description} Market proxy: ${scenario.proxy}.`} title={`${scenario.name}: path through the drawdown`} />
        <div className="px-4 pb-4">
          <LineChart
            categories={sampled.map((point) => shortDate(point.t))}
            series={[
              { label: 'Your portfolio (today’s mix)', values: sampled.map((point) => point.portfolio * 100), color: '#cdd4de', emphasis: true },
              { label: 'Market', values: sampled.map((point) => point.market * 100), color: SERIES_COLORS[0] },
            ]}
            format={(value) => value.toFixed(0)}
            height={240}
          />
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-sm border border-line bg-surface-1 p-2.5">
              <div className="text-[11px] text-muted">Peak-to-trough in window</div>
              <div className="mt-0.5 text-[15px] font-semibold text-loss">{signedPct(scenario.maxDrawdown, 1)}</div>
            </div>
            <div className="rounded-sm border border-line bg-surface-1 p-2.5">
              <div className="text-[11px] text-muted">Worst single day</div>
              <div className="mt-0.5 text-[15px] font-semibold text-loss">{signedPct(scenario.worstDay, 1)}</div>
            </div>
            <div className="rounded-sm border border-line bg-surface-1 p-2.5">
              <div className="text-[11px] text-muted">Relative to market</div>
              <div className="mt-0.5 text-[15px] font-semibold">
                <Delta value={scenario.portfolioReturn - scenario.marketReturn} digits={1} />
              </div>
            </div>
            <div className="rounded-sm border border-line bg-surface-1 p-2.5">
              <div className="text-[11px] text-muted">Dollar impact today</div>
              <div className="mt-0.5 text-[15px] font-semibold text-ink">{money(scenario.dollarImpact, { digits: 0 })}</div>
            </div>
          </div>
        </div>
        <table className="w-full border-t border-line text-[12.5px]">
          <thead>
            <tr className="bg-surface-1 text-left text-[11px] text-muted">
              <th className="px-4 py-2 font-medium">Holding</th>
              <th className="px-3 py-2 text-right font-medium">Weight</th>
              <th className="px-3 py-2 text-right font-medium">Return in window</th>
              <th className="px-3 py-2 text-right font-medium">Contribution</th>
              <th className="px-3 py-2 font-medium">Method</th>
            </tr>
          </thead>
          <tbody>
            {scenario.holdings.map((holding) => (
              <tr key={holding.symbol} className="border-t border-line">
                <td className="px-4 py-1.5">
                  <span className="flex items-center gap-2 font-mono text-[12px] font-semibold text-ink">
                    <CompanyLogo symbol={holding.symbol} size="xs" />
                    {holding.symbol}
                  </span>
                </td>
                <td className="num px-3 py-1.5 text-right text-ink-2">{pct(holding.weight, 1)}</td>
                <td className="px-3 py-1.5 text-right">
                  <Delta value={holding.return} digits={1} className="justify-end text-[12px]" />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Delta value={holding.contribution} digits={2} className="justify-end text-[12px]" />
                </td>
                <td className="px-3 py-1.5">
                  {holding.method === 'actual' ? <Badge tone="neutral">Actual prices</Badge> : <Badge tone="outline">β {fixed(holding.beta, 2)} × market</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2.5 text-[11px] text-faint">Holdings without prices that far back are replayed as beta × the market proxy. Cash is assumed flat.</p>
      </Panel>
    </div>
  );
}

function PastPurchase({ result, purchase }: { result: WhatIfResult; purchase: WhatIfPurchase }) {
  const history = purchase.history;
  const step = history ? Math.max(1, Math.ceil(history.points.length / 160)) : 1;
  const sampled = history ? history.points.filter((_, index) => index % step === 0 || index === history.points.length - 1) : [];
  const diff = history && history.proposedReturn !== null && history.actualReturn !== null ? history.proposedReturn - history.actualReturn : null;
  const tiles: Array<{ label: string; value: string; tone?: 'gain' | 'loss' | null; sub?: string }> = [
    { label: `${result.symbol} position today`, value: money(purchase.valueNow), sub: `${fixed(purchase.shares, 4)} sh at ${money(purchase.price)} → ${money(purchase.lastPrice)}` },
    { label: 'Gain on the position', value: `${purchase.gain >= 0 ? '+' : '−'}${money(Math.abs(purchase.gain))}`, tone: purchase.gain >= 0 ? 'gain' : 'loss', sub: signedPct(purchase.return, 1) },
    ...(history
      ? [
          { label: 'Portfolio since then', value: signedPct(history.actualReturn, 2), tone: history.actualReturn === null ? null : history.actualReturn >= 0 ? ('gain' as const) : ('loss' as const), sub: 'time-weighted, actual' },
          {
            label: `With ${result.symbol}`,
            value: signedPct(history.proposedReturn, 2),
            tone: diff === null ? null : diff >= 0 ? ('gain' as const) : ('loss' as const),
            sub: diff === null ? undefined : `${diff >= 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(2)} pts vs actual`,
          },
          { label: `${history.benchmark === 'SPY' ? 'S&P 500' : history.benchmark} since then`, value: signedPct(history.benchmarkReturn, 2), sub: 'for reference' },
        ]
      : []),
  ];

  return (
    <Panel>
      <PanelHeader kicker={`Bought ${money(result.amount, { digits: 0 })} of ${result.name} on ${shortDate(Date.parse(purchase.date) / 1000)} at the close`} title="What it would have done" />
      <div className="grid grid-cols-2 gap-2 px-4 md:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-sm border border-line bg-surface-1 p-2.5">
            <div className="truncate text-[11px] text-muted">{tile.label}</div>
            <div className={cn('num mt-0.5 text-[15px] font-semibold', tile.tone === 'gain' ? 'text-gain' : tile.tone === 'loss' ? 'text-loss' : 'text-ink')}>{tile.value}</div>
            {tile.sub ? <div className="num mt-0.5 truncate text-[10.5px] text-faint">{tile.sub}</div> : null}
          </div>
        ))}
      </div>
      {history && sampled.length > 1 ? (
        <div className="px-4 pt-3 pb-4">
          <LineChart
            categories={sampled.map((point) => shortDate(point.t))}
            series={[
              { label: `With ${result.symbol}`, values: sampled.map((point) => point.proposed), color: '#cdd4de', emphasis: true },
              { label: 'Actual', values: sampled.map((point) => point.actual), color: SERIES_COLORS[1], dashed: true },
              { label: history.benchmark === 'SPY' ? 'S&P 500' : history.benchmark, values: sampled.map((point) => point.benchmark), color: SERIES_COLORS[0] },
            ]}
            format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`}
            height={240}
            zeroLine
          />
        </div>
      ) : (
        <p className="px-4 py-3 text-[12px] text-muted">Your portfolio has no history on that date yet, so only the position itself is shown.</p>
      )}
    </Panel>
  );
}

function WhatIf({ portfolioId }: { portfolioId: string }) {
  const [symbol, setSymbol] = useState('');
  const [amount, setAmount] = useState('10000');
  const [when, setWhen] = useState<'now' | 'past'>('now');
  const today = localToday();
  const [date, setDate] = useState(() => new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10));
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [loading, setLoading] = useState(false);
  const { askAssistant } = useShell();

  const run = async () => {
    if (!symbol || !Number(amount)) return;
    setLoading(true);
    try {
      setResult(await api<WhatIfResult>(`/api/portfolios/${portfolioId}/whatif`, { body: { symbol, amount: Number(amount), date: when === 'past' ? date : null } }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const rows: Array<{ label: string; get: (side: WhatIfSide) => number | null; format: (value: number | null) => string; better: 'higher' | 'lower' }> = [
    { label: 'Annualized return (history)', get: (side) => side.stats?.annualReturn ?? null, format: (value) => signedPct(value, 1), better: 'higher' },
    { label: 'Volatility', get: (side) => side.stats?.volatility ?? null, format: (value) => pct(value), better: 'lower' },
    { label: 'Beta', get: (side) => side.stats?.beta ?? null, format: (value) => fixed(value), better: 'lower' },
    { label: 'Sharpe ratio', get: (side) => side.stats?.sharpe ?? null, format: (value) => fixed(value), better: 'higher' },
    { label: 'Sortino ratio', get: (side) => side.stats?.sortino ?? null, format: (value) => fixed(value), better: 'higher' },
    { label: 'Max drawdown', get: (side) => side.stats?.maxDrawdown ?? null, format: (value) => signedPct(value, 1), better: 'higher' },
    { label: 'VaR 95% (1 day)', get: (side) => side.stats?.var95 ?? null, format: (value) => pct(value, 2), better: 'lower' },
    { label: 'Largest position', get: (side) => side.concentration.top1, format: (value) => pct(value), better: 'lower' },
    { label: 'Effective positions', get: (side) => side.concentration.effectiveN, format: (value) => fixed(value, 1), better: 'higher' },
    ...(result?.baseline.stress ?? []).map((scenario, index) => ({
      label: scenario.name,
      get: (side: WhatIfSide) => side.stress[index]?.portfolioReturn ?? null,
      format: (value: number | null) => signedPct(value, 1),
      better: 'higher' as const,
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Position to add">
            <TickerSearch onPick={setSymbol} placeholder={symbol || 'Ticker'} className="w-64" />
          </Field>
          <Field label="Amount ($)">
            <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-36" />
          </Field>
          <Field label="Bought">
            <Segmented
              value={when}
              onChange={setWhen}
              options={[
                { value: 'now', label: 'Right now' },
                { value: 'past', label: 'On a date' },
              ]}
            />
          </Field>
          {when === 'past' ? (
            <Field label="Purchase date">
              <Input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} className="w-40" />
            </Field>
          ) : null}
          {symbol ? <Badge tone="brand" className="mb-2 text-[12px]">{symbol}</Badge> : null}
          <Button variant="primary" loading={loading} disabled={!symbol || (when === 'past' && !date)} onClick={() => void run()} className="ml-auto" icon={<FlaskConical className="size-3.5" />}>
            Compare
          </Button>
        </div>
      </Panel>
      {result?.purchase ? <PastPurchase result={result} purchase={result.purchase} /> : null}
      {result ? (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Panel>
            <PanelHeader
              kicker={
                result.purchase
                  ? `${money(result.amount, { digits: 0 })} of ${result.symbol} bought ${shortDate(Date.parse(result.purchase.date) / 1000)}, worth ${money(result.purchase.valueNow, { digits: 0 })} today`
                  : `Adding ${money(result.amount, { digits: 0 })} of ${result.symbol}`
              }
              title={result.purchase ? 'Risk today, with and without it' : 'Before vs. after'}
              actions={
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Sparkles className="size-3 text-brand" />}
                  onClick={() =>
                    askAssistant(
                      `I'm considering adding ${money(result.amount, { digits: 0 })} of ${result.name} (${result.symbol}) to my portfolio. Volatility would go from ${pct(result.baseline.stats?.volatility ?? null)} to ${pct(result.proposed.stats?.volatility ?? null)}, beta from ${fixed(result.baseline.stats?.beta ?? null)} to ${fixed(result.proposed.stats?.beta ?? null)}. Should I? What would you check first?`,
                      { type: 'company', symbol: result.symbol, name: result.name },
                    )
                  }
                >
                  Ask Grok
                </Button>
              }
            />
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-y border-line bg-surface-1 text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Metric</th>
                  <th className="px-3 py-2 text-right font-medium">Today</th>
                  <th className="px-3 py-2 text-right font-medium">With {result.symbol}</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const before = row.get(result.baseline);
                  const after = row.get(result.proposed);
                  const delta = before !== null && after !== null ? after - before : null;
                  const good = delta === null || delta === 0 ? null : row.better === 'higher' ? delta > 0 : delta < 0;
                  return (
                    <tr key={row.label} className="border-b border-line">
                      <td className="px-4 py-1.5 text-ink-2">{row.label}</td>
                      <td className="num px-3 py-1.5 text-right text-muted">{row.format(before)}</td>
                      <td className="num px-3 py-1.5 text-right text-ink">{row.format(after)}</td>
                      <td className={cn('num px-3 py-1.5 text-right text-[11.5px]', good === null ? 'text-muted' : good ? 'text-gain' : 'text-loss')}>
                        {delta === null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${row.format(Math.abs(delta)).replace(/^[+−]/, '')}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          <Panel>
            <PanelHeader kicker="Allocation shift" title="Sector exposure" />
            <div className="flex flex-col gap-2 px-4 pb-4">
              {[...new Set([...result.proposed.sectors, ...result.baseline.sectors].map((item) => item.sector))].map((sector) => {
                const before = result.baseline.sectors.find((item) => item.sector === sector)?.weight ?? 0;
                const after = result.proposed.sectors.find((item) => item.sector === sector)?.weight ?? 0;
                return (
                  <div key={sector} className="grid grid-cols-[130px_1fr_90px] items-center gap-3">
                    <span className="truncate text-[12px] text-ink-2">{sector}</span>
                    <div className="flex flex-col gap-1">
                      <div className="h-1.5 rounded-full bg-white/[0.05]">
                        <motion.div className="h-full rounded-full bg-[#5d6470]" initial={{ width: 0 }} animate={{ width: `${before * 100}%` }} />
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.05]">
                        <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${after * 100}%` }} />
                      </div>
                    </div>
                    <span className="num text-right text-[11px] text-muted">
                      {pct(before, 0)} → <span className="text-ink">{pct(after, 0)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      ) : (
        <Panel>
          <EmptyState icon={<FlaskConical className="size-4" />} title="Test a position before you buy it" body="Pick a ticker and an amount to see how risk, concentration, sector mix and crisis behaviour would change." />
        </Panel>
      )}
    </div>
  );
}

export function Simulations() {
  const { data: portfolios, isLoading } = useSWR<PortfolioListItem[]>('/api/portfolios');
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [tab, setTab] = useState<'montecarlo' | 'stress' | 'whatif'>('montecarlo');
  const selected = portfolioId ?? portfolios?.[0]?.id ?? null;

  return (
    <Page
      kicker="Monte Carlo · historical stress tests · what-if"
      title="Simulations"
      actions={
        portfolios && portfolios.length > 1 ? (
          <Select value={selected ?? ''} onChange={(event) => setPortfolioId(event.target.value)} className="w-52">
            {portfolios.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </Select>
        ) : null
      }
    >
      {!isLoading && !portfolios?.length ? (
        <Panel>
          <EmptyState icon={<Briefcase className="size-4" />} title="Simulations run on a portfolio" body="Create a portfolio and record a few positions first." action={<Link href="/portfolio"><Button variant="primary">Go to portfolio</Button></Link>} />
        </Panel>
      ) : selected ? (
        <>
          <div className="border-b border-line">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'montecarlo', label: 'Monte Carlo' },
                { value: 'stress', label: 'Stress tests' },
                { value: 'whatif', label: 'What if I add…' },
              ]}
            />
          </div>
          {tab === 'montecarlo' ? <MonteCarlo key={selected} portfolioId={selected} /> : null}
          {tab === 'stress' ? <StressTests key={selected} portfolioId={selected} /> : null}
          {tab === 'whatif' ? <WhatIf key={selected} portfolioId={selected} /> : null}
        </>
      ) : (
        <Skeleton className="h-96" />
      )}
    </Page>
  );
}

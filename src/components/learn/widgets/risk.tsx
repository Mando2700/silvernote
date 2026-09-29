'use client';

import { ArrowUpRight, Dices, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { AskGrok, DataState, Readout, Slider, TickerPicker, Widget } from '@/components/learn/blocks';
import { useAlignedReturns, useDailyCloses } from '@/components/learn/hooks';
import { XYChart, type Layer } from '@/components/learn/xy-chart';
import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Segmented } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { simulate, type MonteCarloResult } from '@/lib/finance/montecarlo';
import {
  alignReturns,
  annualizedReturn,
  annualizedVolatility,
  beta as betaOf,
  correlation,
  dailyReturns,
  equityCurve,
  maxDrawdown,
  mean,
  sharpe,
  sortino,
  stdev,
  TRADING_DAYS,
  valueAtRisk,
} from '@/lib/finance/stats';
import { money, pct, signedPct } from '@/lib/format';
import { SERIES_COLORS } from '@/lib/theme';
import { cn } from '@/lib/utils';

const year = (t: number) => String(new Date(t * 1000).getUTCFullYear());

/** Keep at most ~n points for drawing. */
function thin<T>(items: T[], n = 240) {
  const step = Math.max(1, Math.floor(items.length / n));
  return items.filter((_, index) => index % step === 0 || index === items.length - 1);
}

// ─── Return, volatility and drawdowns ─────────────────────────────────────────

export function RiskReturnLab() {
  const [symbol, setSymbol] = useState('TSLA');
  const { aligned, isLoading, error } = useAlignedReturns(symbol, 'SPY', 5);
  const stats = useMemo(() => {
    if (!aligned || aligned.asset.length < 120) return null;
    const make = (returns: number[]) => {
      const curve = equityCurve(returns);
      const dd = maxDrawdown(curve);
      let peak = curve[0];
      const underwater = curve.map((value) => {
        peak = Math.max(peak, value);
        return value / peak - 1;
      });
      const ret = annualizedReturn(returns);
      const vol = annualizedVolatility(returns);
      return { curve, dd, underwater, ret, vol, arithmetic: mean(returns) * TRADING_DAYS };
    };
    return { dates: [aligned.dates[0] - 86_400, ...aligned.dates], stock: make(aligned.asset), market: make(aligned.market) };
  }, [aligned]);

  return (
    <Widget
      kicker={`Live data · ${symbol} vs S&P 500 · 5 years`}
      title="What you earned — and what you had to sit through"
      actions={<AskGrok symbol={symbol} prompt={`What caused ${symbol}'s largest drawdown in the last five years, and what did an investor need to believe to hold through it?`} label="Why the drawdown?" />}
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['TSLA', 'KO', 'META', 'NFLX', 'JNJ']} />
      </div>
      {!stats ? (
        <DataState loading={isLoading} error={error} empty="Not enough price history." height={300} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Readout label={`${symbol} CAGR`} value={pct(stats.stock.ret, 1)} tone="brand" sub={`S&P ${pct(stats.market.ret, 1)}`} />
            <Readout label="Volatility" value={pct(stats.stock.vol, 1)} sub={`S&P ${pct(stats.market.vol, 1)}`} />
            <Readout label="Max drawdown" value={pct(stats.stock.dd.value, 1)} tone="loss" sub={`S&P ${pct(stats.market.dd.value, 1)}`} />
            <Readout label="Volatility drag" value={`−${((stats.stock.arithmetic - Math.log(1 + stats.stock.ret)) * 100).toFixed(1)} pts`} sub="arithmetic − compound (log)" />
          </div>
          <XYChart
            height={220}
            xFormat={year}
            yFormat={(v) => money(v * 10_000, { compact: true })}
            hoverLabel={(t) => {
              const index = stats.dates.findIndex((date) => date >= t);
              const i = index < 0 ? stats.dates.length - 1 : index;
              return `${new Date(stats.dates[i] * 1000).toISOString().slice(0, 10)} · ${symbol} ${money(stats.stock.curve[i] * 10_000, { digits: 0 })} · S&P ${money(stats.market.curve[i] * 10_000, { digits: 0 })}`;
            }}
            layers={[
              { type: 'hline', y: 1, color: 'rgba(255,255,255,0.25)' },
              { type: 'line', points: thin(stats.dates.map((t, i) => [t, stats.market.curve[i]] as [number, number])), color: 'var(--color-series-2)', width: 1.5 },
              { type: 'line', points: thin(stats.dates.map((t, i) => [t, stats.stock.curve[i]] as [number, number])), color: 'var(--color-series-1)', width: 2 },
            ]}
          />
          <div className="flex items-center gap-4 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-series-1" />{symbol}: $10,000 grew to {money(stats.stock.curve.at(-1)! * 10_000, { digits: 0 })}</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-series-2" />S&P 500: {money(stats.market.curve.at(-1)! * 10_000, { digits: 0 })}</span>
          </div>
          <div>
            <div className="mb-1 text-[12px] text-ink-2">Underwater chart — how far below its previous high it was on each day</div>
            <XYChart
              height={150}
              xFormat={year}
              yFormat={(v) => pct(v, 0)}
              yDomain={[Math.min(stats.stock.dd.value, stats.market.dd.value) * 1.05, 0]}
              layers={[
                { type: 'area', upper: thin(stats.dates.map((t) => [t, 0] as [number, number])), lower: thin(stats.dates.map((t, i) => [t, stats.market.underwater[i]] as [number, number])), color: 'var(--color-series-2)', opacity: 0.25 },
                { type: 'area', upper: thin(stats.dates.map((t) => [t, 0] as [number, number])), lower: thin(stats.dates.map((t, i) => [t, stats.stock.underwater[i]] as [number, number])), color: 'var(--color-loss-fill)', opacity: 0.35 },
                { type: 'line', points: thin(stats.dates.map((t, i) => [t, stats.stock.underwater[i]] as [number, number])), color: 'var(--color-loss)', width: 1 },
              ]}
            />
          </div>
        </div>
      )}
    </Widget>
  );
}

// ─── Sharpe lab ─────────────────────────────────────────────────────────────

type Row = { label: string; ret: number; vol: number; sharpe: number | null; sortino: number | null; dd: number; calmar: number | null; color: string; mine?: boolean };

function useRow(symbol: string, riskFree: number, color: string): { row: Row | null; loading: boolean } {
  const { candles, isLoading } = useDailyCloses(symbol, 3);
  const row = useMemo(() => {
    if (!candles || candles.length < 200) return null;
    const map = dailyReturns(candles);
    const returns = [...map.keys()].sort((a, b) => a - b).map((date) => map.get(date) as number);
    const ret = annualizedReturn(returns);
    const dd = maxDrawdown(equityCurve(returns)).value;
    return { label: symbol, ret, vol: annualizedVolatility(returns), sharpe: sharpe(returns, riskFree), sortino: sortino(returns, riskFree), dd, calmar: dd < 0 ? ret / -dd : null, color };
  }, [candles, riskFree, symbol, color]);
  return { row, loading: isLoading };
}

type PortfolioListItem = { id: string; name: string; summary: { positions: number } };
type RiskPayload = { stats: null | { annualReturn: number; volatility: number; sharpe: number | null; sortino: number | null; maxDrawdown: number } };

export function SharpeLab() {
  const { prefs } = useShell();
  const riskFree = prefs.riskFreeRate ?? 0.04;
  const [symbols, setSymbols] = useState(['SPY', 'AAPL', 'KO', 'TSLA']);
  const slots = [0, 1, 2, 3, 4].map((index) => symbols[index] ?? null);
  const r0 = useRow(slots[0] ?? 'SPY', riskFree, SERIES_COLORS[0]);
  const r1 = useRow(slots[1] ?? 'SPY', riskFree, SERIES_COLORS[1]);
  const r2 = useRow(slots[2] ?? 'SPY', riskFree, SERIES_COLORS[2]);
  const r3 = useRow(slots[3] ?? 'SPY', riskFree, SERIES_COLORS[3]);
  const r4 = useRow(slots[4] ?? 'SPY', riskFree, SERIES_COLORS[5]);
  const { data: portfolios } = useSWR<PortfolioListItem[]>('/api/portfolios');
  const portfolio = portfolios?.find((item) => item.summary.positions > 0) ?? null;
  const { data: risk } = useSWR<RiskPayload>(portfolio ? `/api/portfolios/${portfolio.id}/risk` : null);
  const rows: Row[] = [r0, r1, r2, r3, r4].slice(0, symbols.length).map((item) => item.row).filter((row): row is Row => row !== null);
  if (risk?.stats && portfolio) {
    const s = risk.stats;
    rows.push({ label: `Your ${portfolio.name}`, ret: s.annualReturn, vol: s.volatility, sharpe: s.sharpe, sortino: s.sortino, dd: s.maxDrawdown, calmar: s.maxDrawdown < 0 ? s.annualReturn / -s.maxDrawdown : null, color: 'var(--color-brand-bright)', mine: true });
  }
  const loading = [r0, r1, r2, r3, r4].slice(0, symbols.length).some((item) => item.loading);
  const maxVol = Math.max(0.3, ...rows.map((row) => row.vol)) * 1.1;
  const best = rows.reduce<Row | null>((top, row) => (row.sharpe !== null && (!top || (top.sharpe ?? -Infinity) < row.sharpe) ? row : top), null);
  const layers: Layer[] = [
    { type: 'hline', y: riskFree, color: 'rgba(255,255,255,0.3)', label: `risk-free ${pct(riskFree, 1)}` },
    ...[0.5, 1].map((s) => ({ type: 'line' as const, points: [[0, riskFree], [maxVol, riskFree + s * maxVol]] as Array<[number, number]>, color: 'rgba(255,255,255,0.18)', dashed: true, width: 1 })),
    ...(best?.sharpe ? [{ type: 'line' as const, points: [[0, riskFree], [maxVol, riskFree + best.sharpe * maxVol]] as Array<[number, number]>, color: best.color, width: 1.25, opacity: 0.6 }] : []),
    ...rows.map((row) => ({ type: 'dot' as const, x: row.vol, y: row.ret, color: row.color, label: row.label, r: row.mine ? 5 : 4 })),
  ];

  return (
    <Widget
      kicker="Live data · 3 years of daily returns"
      title="Return per unit of risk, compared"
      actions={portfolio ? <Link href="/portfolio" className="flex items-center gap-1 text-[11.5px] text-muted hover:text-ink">Your portfolio <ArrowUpRight className="size-3" /></Link> : null}
      footer={`Dashed rays from the risk-free rate have slopes of 0.5 and 1.0 — the Sharpe ratio is the slope from cash to each dot. The solid ray is the best one here (${best?.label ?? '—'}). Risk-free: ${pct(riskFree, 1)} (Settings).`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {symbols.map((symbol, index) => (
          <span key={symbol} className="flex h-6.5 items-center gap-1.5 rounded-sm border border-line pr-1 pl-1.5 font-mono text-[11.5px] text-ink">
            <span className="size-2 rounded-full" style={{ background: SERIES_COLORS[index === 4 ? 5 : index] }} />
            {symbol}
            {symbols.length > 1 ? (
              <button type="button" onClick={() => setSymbols((list) => list.filter((item) => item !== symbol))} className="text-faint hover:text-ink" aria-label={`Remove ${symbol}`}>
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        {symbols.length < 5 ? <TickerSearch onPick={(symbol) => setSymbols((list) => (list.includes(symbol) ? list : [...list, symbol]))} placeholder="Add ticker…" className="w-36" /> : null}
        {!portfolio ? <span className="text-[11px] text-faint">Add holdings in Portfolio to see yourself on this chart.</span> : null}
      </div>
      {!rows.length ? (
        <DataState loading={loading} empty="No data." height={280} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
          <XYChart height={280} xDomain={[0, maxVol]} xFormat={(v) => pct(v, 0)} yFormat={(v) => pct(v, 0)} layers={layers} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[12px]">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 text-left font-medium">Asset</th>
                  <th className="py-1.5 text-right font-medium">Return</th>
                  <th className="py-1.5 text-right font-medium">Vol</th>
                  <th className="py-1.5 text-right font-medium">Sharpe</th>
                  <th className="py-1.5 text-right font-medium">Sortino</th>
                  <th className="py-1.5 text-right font-medium">Max DD</th>
                  <th className="py-1.5 text-right font-medium">Calmar</th>
                </tr>
              </thead>
              <tbody className="num">
                {rows.map((row) => (
                  <tr key={row.label} className={cn('border-b border-line', row.mine && 'bg-brand-wash')}>
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5 text-ink">
                        <span className="size-2 rounded-full" style={{ background: row.color }} />
                        {row.mine ? row.label : <><CompanyLogo symbol={row.label} size="xs" /><span className="font-mono">{row.label}</span></>}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-ink-2">{pct(row.ret, 1)}</td>
                    <td className="py-1.5 text-right text-ink-2">{pct(row.vol, 1)}</td>
                    <td className={cn('py-1.5 text-right font-semibold', row === best ? 'text-brand-bright' : 'text-ink')}>{row.sharpe?.toFixed(2) ?? '—'}</td>
                    <td className="py-1.5 text-right text-ink-2">{row.sortino?.toFixed(2) ?? '—'}</td>
                    <td className="py-1.5 text-right text-loss">{pct(row.dd, 0)}</td>
                    <td className="py-1.5 text-right text-ink-2">{row.calmar?.toFixed(2) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              <strong className="text-ink-2">Sharpe</strong> = (return − risk-free) / volatility. <strong className="text-ink-2">Sortino</strong> divides by downside deviation only. <strong className="text-ink-2">Calmar</strong> = return / max drawdown — the pain a real holder felt.
            </p>
          </div>
        </div>
      )}
    </Widget>
  );
}

// ─── Correlation playground ──────────────────────────────────────────────────

function twoAsset(w: number, volA: number, volB: number, rho: number) {
  return Math.sqrt(w * w * volA * volA + (1 - w) * (1 - w) * volB * volB + 2 * w * (1 - w) * rho * volA * volB);
}

export function CorrelationPlayground() {
  const [volA, setVolA] = useState(0.3);
  const [volB, setVolB] = useState(0.2);
  const [retA, setRetA] = useState(0.12);
  const [retB, setRetB] = useState(0.07);
  const [rho, setRho] = useState(0.2);
  const [weight, setWeight] = useState(0.5);
  const [names, setNames] = useState<[string, string]>(['Asset A', 'Asset B']);
  const [pair, setPair] = useState<[string, string]>(['XOM', 'MSFT']);
  const a = useDailyCloses(pair[0], 3);
  const b = useDailyCloses(pair[1], 3);
  const real = useMemo(() => {
    if (!a.candles?.length || !b.candles?.length) return null;
    const { matrix } = alignReturns([dailyReturns(a.candles), dailyReturns(b.candles)]);
    if ((matrix[0]?.length ?? 0) < 120) return null;
    return { volA: annualizedVolatility(matrix[0]), volB: annualizedVolatility(matrix[1]), retA: annualizedReturn(matrix[0]), retB: annualizedReturn(matrix[1]), rho: correlation(matrix[0], matrix[1]) };
  }, [a.candles, b.candles]);

  const frontier = (r: number) => Array.from({ length: 51 }, (_, i) => [twoAsset(i / 50, volA, volB, r), (i / 50) * retA + (1 - i / 50) * retB] as [number, number]);
  const vol = twoAsset(weight, volA, volB, rho);
  const ret = weight * retA + (1 - weight) * retB;
  const naive = weight * volA + (1 - weight) * volB;
  let minVolWeight = 0;
  for (let i = 0; i <= 100; i += 1) if (twoAsset(i / 100, volA, volB, rho) < twoAsset(minVolWeight, volA, volB, rho)) minVolWeight = i / 100;

  return (
    <Widget title="Two assets, one correlation slider" footer="Every point on the curve is a mix of the two assets. The more the curve bows left of the straight ρ = 1 line, the more diversification is doing for you.">
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-3.5">
          <Slider label={`${names[0]} volatility`} value={volA} min={0.05} max={0.8} step={0.01} onChange={setVolA} format={(v) => pct(v, 0)} />
          <Slider label={`${names[0]} return`} value={retA} min={-0.1} max={0.4} step={0.005} onChange={setRetA} format={(v) => pct(v, 1)} />
          <Slider label={`${names[1]} volatility`} value={volB} min={0.05} max={0.8} step={0.01} onChange={setVolB} format={(v) => pct(v, 0)} />
          <Slider label={`${names[1]} return`} value={retB} min={-0.1} max={0.4} step={0.005} onChange={setRetB} format={(v) => pct(v, 1)} />
          <Slider label="Correlation ρ" value={rho} min={-1} max={1} step={0.05} onChange={setRho} format={(v) => v.toFixed(2)} />
          <Slider label={`Weight in ${names[0]}`} value={weight} min={0} max={1} step={0.01} onChange={setWeight} format={(v) => pct(v, 0)} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Readout label="Portfolio volatility" value={pct(vol, 1)} tone="brand" />
            <Readout label="Portfolio return" value={pct(ret, 1)} />
            <Readout label="Diversification benefit" value={`−${((naive - vol) * 100).toFixed(1)} pts`} sub={`vs ${pct(naive, 1)} weighted average`} />
            <Readout label="Min-variance mix" value={`${pct(minVolWeight, 0)} / ${pct(1 - minVolWeight, 0)}`} sub={`σ ${pct(twoAsset(minVolWeight, volA, volB, rho), 1)}`} />
          </div>
          <XYChart
            height={250}
            xFormat={(v) => pct(v, 0)}
            yFormat={(v) => pct(v, 0)}
            layers={[
              { type: 'line', points: frontier(1), color: 'rgba(255,255,255,0.25)', dashed: true, width: 1 },
              { type: 'line', points: frontier(-1), color: 'rgba(255,255,255,0.12)', dashed: true, width: 1 },
              { type: 'line', points: frontier(rho), color: 'var(--color-series-1)', width: 2.25 },
              { type: 'dot', x: volA, y: retA, color: 'var(--color-series-2)', label: names[0], r: 3.5 },
              { type: 'dot', x: volB, y: retB, color: 'var(--color-series-3)', label: names[1], r: 3.5 },
              { type: 'dot', x: vol, y: ret, color: 'var(--color-brand-bright)', label: `your mix`, r: 4.5 },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-2">
            <span className="text-[12px] text-ink-2">Load two real stocks (3y):</span>
            {[0, 1].map((index) => (
              <TickerSearch
                key={index}
                onPick={(symbol) => setPair((current) => (index === 0 ? [symbol, current[1]] : [current[0], symbol]))}
                placeholder={pair[index]}
                className="w-28"
              />
            ))}
            {real ? (
              <>
                <span className="font-mono text-[11.5px] text-muted">ρ {real.rho.toFixed(2)} · σ {pct(real.volA, 0)} / {pct(real.volB, 0)}</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setVolA(Math.min(0.8, Math.round(real.volA * 100) / 100));
                    setVolB(Math.min(0.8, Math.round(real.volB * 100) / 100));
                    setRetA(Math.max(-0.1, Math.min(0.4, Math.round(real.retA * 200) / 200)));
                    setRetB(Math.max(-0.1, Math.min(0.4, Math.round(real.retB * 200) / 200)));
                    setRho(Math.round(real.rho * 20) / 20);
                    setNames([pair[0], pair[1]]);
                  }}
                >
                  Load {pair[0]} + {pair[1]}
                </Button>
              </>
            ) : (
              <span className="text-[11.5px] text-faint">{a.isLoading || b.isLoading ? 'Loading…' : 'Pick two tickers'}</span>
            )}
          </div>
        </div>
      </div>
    </Widget>
  );
}

// ─── Beta scatter ────────────────────────────────────────────────────────────

export function BetaScatter() {
  const [symbol, setSymbol] = useState('AMD');
  const { aligned, isLoading, error } = useAlignedReturns(symbol, 'SPY', 3);
  const stats = useMemo(() => {
    if (!aligned || aligned.asset.length < 120) return null;
    const x = aligned.market.slice(-504);
    const y = aligned.asset.slice(-504);
    const b = betaOf(y, x) ?? 0;
    const alphaDaily = mean(y) - b * mean(x);
    const rho = correlation(x, y);
    const clip = 0.12;
    return { points: x.map((value, index) => [value, y[index]] as [number, number]).filter(([px, py]) => Math.abs(px) < clip && Math.abs(py) < clip * 2), beta: b, alpha: alphaDaily * TRADING_DAYS, r2: rho * rho, rho, volStock: annualizedVolatility(y), volMarket: annualizedVolatility(x) };
  }, [aligned]);

  return (
    <Widget
      kicker={`Live data · ${symbol} vs S&P 500 · 2 years of days`}
      title="Beta is the slope of this cloud"
      actions={<AskGrok symbol={symbol} prompt={`${symbol}'s beta and R² against the S&P 500 — what do they say about its risk, and how much of its volatility is company-specific?`} />}
      footer="Each dot is one trading day: the market’s return on the x-axis, the stock’s on the y-axis. The line is the least-squares fit: slope = beta, and R² is the share of the stock’s variance the market explains."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['AMD', 'KO', 'JPM', 'NEM', 'WMT']} />
      </div>
      {!stats ? (
        <DataState loading={isLoading} error={error} empty="Not enough overlapping history." height={300} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_230px]">
          <XYChart
            height={300}
            xDomain={[-0.06, 0.06]}
            yDomain={[-Math.max(0.06, Math.min(0.2, stats.volStock / 4)), Math.max(0.06, Math.min(0.2, stats.volStock / 4))]}
            xFormat={(v) => pct(v, 0)}
            yFormat={(v) => pct(v, 0)}
            layers={[
              { type: 'hline', y: 0, color: 'rgba(255,255,255,0.18)', dashed: false },
              { type: 'vline', x: 0, color: 'rgba(255,255,255,0.18)', dashed: false },
              { type: 'scatter', points: stats.points, color: 'var(--color-series-1)', r: 1.8, opacity: 0.45 },
              { type: 'line', points: [[-0.06, stats.alpha / TRADING_DAYS - 0.06 * stats.beta], [0.06, stats.alpha / TRADING_DAYS + 0.06 * stats.beta]], color: 'var(--color-brand-bright)', width: 2 },
              { type: 'line', points: [[-0.06, -0.06], [0.06, 0.06]], color: 'rgba(255,255,255,0.25)', dashed: true, width: 1 },
            ]}
          />
          <div className="flex flex-col gap-2">
            <Readout label="Beta" value={stats.beta.toFixed(2)} tone="brand" sub={stats.beta > 1.1 ? 'amplifies the market' : stats.beta < 0.9 ? 'dampens the market' : 'moves with the market'} />
            <Readout label="R²" value={pct(stats.r2, 0)} sub={`${pct(1 - stats.r2, 0)} of variance is company-specific`} />
            <Readout label="Volatility" value={pct(stats.volStock, 0)} sub={`market ${pct(stats.volMarket, 0)}`} />
            <Readout label="Alpha (annualized)" value={signedPct(stats.alpha, 1)} sub="intercept — noisy, don’t over-read" />
            <p className="text-[11px] leading-snug text-faint">Dashed line: beta = 1. Beta = correlation × (σ stock / σ market) = {stats.rho.toFixed(2)} × {(stats.volStock / stats.volMarket).toFixed(2)}.</p>
          </div>
        </div>
      )}
    </Widget>
  );
}

// ─── Monte Carlo lab ─────────────────────────────────────────────────────────

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A handful of monthly paths for drawing, generated the same two ways as the engine. */
function samplePaths(daily: number[], months: number, count: number, method: 'bootstrap' | 'normal', seed: number, annualReturn: number | null) {
  const random = rng(seed);
  // Re-centre on an assumed return the same way the engine does: keep the shape, move the mean.
  const shift = annualReturn === null ? 0 : (1 + annualReturn) ** (1 / 252) - 1 - mean(daily);
  if (shift) daily = daily.map((value) => value + shift);
  const m = mean(daily);
  const s = stdev(daily);
  const drift = (m - (s * s) / 2) * 21;
  const vol = s * Math.sqrt(21);
  const paths: number[][] = [];
  for (let p = 0; p < count; p += 1) {
    const path = [1];
    for (let month = 1; month <= months; month += 1) {
      let growth: number;
      if (method === 'bootstrap') {
        const start = Math.floor(random() * Math.max(1, daily.length - 21));
        growth = 1;
        for (let d = start; d < start + 21 && d < daily.length; d += 1) growth *= 1 + daily[d];
      } else {
        let u = 0;
        let v = 0;
        while (u === 0) u = random();
        while (v === 0) v = random();
        growth = Math.exp(drift + vol * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
      }
      path.push(path[month - 1] * growth);
    }
    paths.push(path);
  }
  return paths;
}

export function MonteCarloLab() {
  const [symbol, setSymbol] = useState('AAPL');
  const [method, setMethod] = useState<'bootstrap' | 'normal'>('bootstrap');
  const [years, setYears] = useState(5);
  const [sims, setSims] = useState(2000);
  const [seed, setSeed] = useState(7);
  const [assumed, setAssumed] = useState<number | null>(null);
  const { candles, isLoading, error } = useDailyCloses(symbol, 10);
  const daily = useMemo(() => {
    if (!candles || candles.length < 300) return null;
    const map = dailyReturns(candles);
    return [...map.keys()].sort((a, b) => a - b).map((date) => map.get(date) as number);
  }, [candles]);
  const historical = useMemo(() => (daily ? (1 + mean(daily)) ** 252 - 1 : null), [daily]);
  const result = useMemo(
    () => (daily ? simulate({ weights: [1], returns: [daily], startValue: 10_000, monthlyContribution: 0, years, simulations: sims, method, seed, annualReturn: assumed }) : null),
    [daily, years, sims, method, seed, assumed],
  );
  const paths = useMemo(() => (daily ? samplePaths(daily, years * 12, 40, method, seed + 1, assumed) : null), [daily, years, method, seed, assumed]);
  const histogram = useMemo(() => {
    if (!result) return null;
    const logs = result.finalValues.map((value) => Math.log10(Math.max(1, value)));
    const min = Math.min(...logs);
    const max = Math.max(...logs);
    const bins = 36;
    const width = (max - min) / bins || 1;
    const counts = Array(bins).fill(0) as number[];
    logs.forEach((value) => (counts[Math.min(bins - 1, Math.floor((value - min) / width))] += 1));
    return counts.map((count, index) => ({ x0: min + index * width, x1: min + (index + 1) * width, y: count / logs.length }));
  }, [result]);
  const mean$ = result ? mean(result.finalValues) : 0;
  const median$ = result ? result.percentiles.p50.at(-1)! : 0;

  return (
    <Widget
      kicker={`Live data · ${symbol} · ${daily ? `${(daily.length / 252).toFixed(0)} years of daily returns` : 'loading'}`}
      title="Ten thousand futures for $10,000"
      actions={
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" icon={<Dices className="size-3" />} onClick={() => setSeed((value) => value + 101)}>
            Re-roll
          </Button>
          <Link href="/simulations" className="flex items-center gap-1 text-[11.5px] text-muted hover:text-ink">
            Run on your portfolio <ArrowUpRight className="size-3" />
          </Link>
        </div>
      }
      footer="Thin lines are 40 individual paths. The bands are the 5–95th and 25–75th percentiles across all simulations; the bright line is the median."
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['AAPL', 'SPY', 'KO', 'NVDA']} />
        <Segmented size="xs" value={method} onChange={setMethod} options={[{ value: 'bootstrap', label: 'Bootstrap history' }, { value: 'normal', label: 'Lognormal (GBM)' }]} />
      </div>
      {!result || !paths || !histogram ? (
        <DataState loading={isLoading} error={error} empty="Not enough history to simulate." height={320} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <div className="flex flex-col gap-4">
            <Slider label="Horizon" value={years} min={1} max={10} step={1} onChange={setYears} format={(v) => `${v} yr`} />
            <Slider label="Simulations" value={sims} min={100} max={10000} step={100} onChange={setSims} format={(v) => v.toLocaleString()} hint="Watch the percentiles steady as N grows." />
            <Slider
              label="Expected annual return"
              value={assumed ?? Math.round((historical ?? 0.08) * 200) / 200}
              min={-0.1}
              max={0.4}
              step={0.005}
              onChange={setAssumed}
              format={(v) => (assumed === null ? `${pct(v, 1)} (history)` : pct(v, 1))}
              hint={assumed === null ? 'Using the stock’s own past — a winner’s past flatters its future. Drag to assume your own.' : 'Your assumption; volatility and tail shape still come from history.'}
            />
            {assumed !== null ? (
              <button type="button" onClick={() => setAssumed(null)} className="-mt-2 self-start text-[11px] text-muted underline underline-offset-2 hover:text-ink">
                Back to historical ({pct(historical, 1)})
              </button>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Readout label="Median" value={money(median$, { compact: true })} tone="brand" />
              <Readout label="Mean" value={money(mean$, { compact: true })} sub="pulled up by the tail" />
              <Readout label="P(lose money)" value={pct(result.probabilityOfLoss, 0)} tone={result.probabilityOfLoss > 0.3 ? 'loss' : undefined} />
              <Readout label="5th pct" value={money(result.percentiles.p5.at(-1)!, { compact: true })} />
              <Readout label="95th pct" value={money(result.percentiles.p95.at(-1)!, { compact: true })} />
              <Readout label="Median max DD" value={pct(result.medianMaxDrawdown, 0)} tone="loss" />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <FanChart bands={result.percentiles} />
            <XYChart
              height={170}
              xFormat={(v) => money(10 ** v, { compact: true })}
              yFormat={(v) => pct(v, 0)}
              layers={[
                { type: 'bars', bars: histogram.map((bin) => ({ ...bin, color: bin.x1 <= 4 ? 'var(--color-loss-fill)' : 'var(--color-series-1)' })) },
                { type: 'vline', x: 4, color: 'rgba(255,255,255,0.5)', label: 'start $10k' },
                { type: 'vline', x: Math.log10(median$), color: 'var(--color-brand-bright)', label: 'median' },
                { type: 'vline', x: Math.log10(mean$), color: 'var(--color-series-2)', label: 'mean' },
              ]}
            />
            <div className="text-[11px] text-faint">Distribution of final values (log scale). Red bins end below the $10,000 you started with.</div>
            <PathsChart paths={paths} />
          </div>
        </div>
      )}
    </Widget>
  );
}

/** Percentile fan on the Learn chart, so bands and axis glide together when a parameter changes. */
function FanChart({ bands }: { bands: MonteCarloResult['percentiles'] }) {
  const layers = useMemo<Layer[]>(() => {
    const at = (values: number[]) => values.map((value, month) => [month / 12, value] as [number, number]);
    const end = bands.p50.length - 1;
    return [
      { type: 'area', upper: at(bands.p95), lower: at(bands.p5), color: 'rgb(205,212,222)', opacity: 0.07 },
      { type: 'area', upper: at(bands.p90), lower: at(bands.p10), color: 'rgb(205,212,222)', opacity: 0.07 },
      { type: 'area', upper: at(bands.p75), lower: at(bands.p25), color: 'rgb(205,212,222)', opacity: 0.14 },
      { type: 'hline', y: 10_000, color: 'rgba(255,255,255,0.4)', label: 'start $10k' },
      { type: 'line', points: at(bands.p50), color: '#cdd4de', width: 2.5 },
      { type: 'dot', x: end / 12, y: bands.p50[end], color: '#cdd4de', r: 3, label: money(bands.p50[end], { compact: true }) },
    ];
  }, [bands]);
  return (
    <XYChart
      height={260}
      xFormat={(v) => (v === 0 ? 'Now' : `${v}y`)}
      yFormat={(v) => money(v, { compact: true })}
      layers={layers}
      hoverLabel={(v) => {
        const month = Math.max(0, Math.min(bands.p50.length - 1, Math.round(v * 12)));
        return (
          <span className="num">
            {(month / 12).toFixed(1)}y · 5th {money(bands.p5[month], { compact: true })} · median {money(bands.p50[month], { compact: true })} · 95th {money(bands.p95[month], { compact: true })}
          </span>
        );
      }}
    />
  );
}

function PathsChart({ paths }: { paths: number[][] }) {
  const months = paths[0].length - 1;
  const layers: Layer[] = paths.map((path, index) => ({ type: 'line', points: path.map((value, month) => [month / 12, value * 10_000] as [number, number]), color: SERIES_COLORS[index % SERIES_COLORS.length], width: 1, opacity: 0.45 }));
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[12px] text-ink-2">
        <Plus className="size-3 text-faint" />
        40 individual paths — each one a possible future for {months / 12} years
      </div>
      <XYChart height={200} xFormat={(v) => `${v}y`} yFormat={(v) => money(v, { compact: true })} layers={[{ type: 'hline', y: 10_000, color: 'rgba(255,255,255,0.4)', label: 'start' }, ...layers]} />
    </div>
  );
}

// ─── Value at Risk lab ──────────────────────────────────────────────────────

export function VarLab() {
  const [symbol, setSymbol] = useState('SPY');
  const [position, setPosition] = useState(100_000);
  const { candles, isLoading, error } = useDailyCloses(symbol, 10);
  const stats = useMemo(() => {
    if (!candles || candles.length < 300) return null;
    const map = dailyReturns(candles);
    const returns = [...map.keys()].sort((a, b) => a - b).map((date) => map.get(date) as number);
    const m = mean(returns);
    const s = stdev(returns);
    const var95 = valueAtRisk(returns, 0.95, 1);
    const var99 = valueAtRisk(returns, 0.99, 1);
    const kurtosis = mean(returns.map((value) => ((value - m) / s) ** 4)) - 3;
    const beyond3 = returns.filter((value) => Math.abs(value - m) > 3 * s).length;
    const width = 0.0025;
    const lo = -0.1;
    const bins = 80;
    const counts = Array(bins).fill(0) as number[];
    returns.forEach((value) => {
      const index = Math.floor((Math.max(lo, Math.min(-lo - 1e-9, value)) - lo) / width);
      counts[index] += 1;
    });
    const hist = counts.map((count, index) => ({ x0: lo + index * width, x1: lo + (index + 1) * width, y: count / returns.length / width }));
    const normal = Array.from({ length: 161 }, (_, i) => {
      const x = lo + (i / 160) * -2 * lo;
      return [x, Math.exp(-((x - m) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))] as [number, number];
    });
    const worst = Math.min(...returns);
    return { returns, m, s, var95, var99, kurtosis, beyond3, expected3: returns.length * 0.0027, hist, normal, worst, years: returns.length / 252 };
  }, [candles]);

  return (
    <Widget
      kicker={`Live data · ${symbol} · ${stats ? `${stats.years.toFixed(0)} years` : '…'} of daily returns`}
      title="The left tail, measured"
      actions={<AskGrok symbol={symbol} prompt={`Using ${symbol}'s daily return history, explain its Value at Risk and expected shortfall, and which historical days sit in its worst 1% tail and why.`} />}
      footer="Bars are the real distribution of daily returns; the curve is a normal distribution with the same mean and volatility. The gap in the tails is why VaR models built on the normal understate crashes."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['SPY', 'QQQ', 'TSLA', 'KO', 'COIN']} />
      </div>
      {!stats || !stats.var95 || !stats.var99 ? (
        <DataState loading={isLoading} error={error} empty="Not enough history." height={300} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <div className="flex flex-col gap-3">
            <Slider label="Position size" value={position} min={10_000} max={1_000_000} step={10_000} onChange={setPosition} format={(v) => money(v, { digits: 0 })} />
            <Readout label="1-day 95% VaR (historical)" value={money(stats.var95.historical * position, { digits: 0 })} tone="loss" sub={pct(stats.var95.historical, 2)} />
            <Readout label="1-day 95% VaR (normal)" value={money(stats.var95.parametric * position, { digits: 0 })} sub={`1.645 × σ ${pct(stats.s, 2)}`} />
            <Readout label="95% expected shortfall" value={money(stats.var95.expectedShortfall * position, { digits: 0 })} tone="loss" sub="average of the worst 5% of days" />
            <Readout label="1-day 99% VaR (historical)" value={money(stats.var99.historical * position, { digits: 0 })} sub={`worst day: ${pct(stats.worst, 1)}`} />
            <Readout label="Days beyond 3σ" value={`${stats.beyond3}`} sub={`a normal curve expects ~${stats.expected3.toFixed(0)} · excess kurtosis ${stats.kurtosis.toFixed(1)}`} />
          </div>
          <XYChart
            height={330}
            xDomain={[-0.1, 0.1]}
            xFormat={(v) => pct(v, 0)}
            yFormat={(v) => v.toFixed(0)}
            layers={[
              { type: 'bars', bars: stats.hist.map((bin) => ({ ...bin, color: bin.x1 <= -stats.var99!.historical ? 'var(--color-loss)' : bin.x1 <= -stats.var95!.historical ? 'var(--color-loss-fill)' : 'var(--color-series-1)' })) },
              { type: 'line', points: stats.normal, color: 'var(--color-brand-bright)', width: 1.5, opacity: 0.9 },
              { type: 'vline', x: -stats.var95.historical, color: 'var(--color-loss-fill)', label: 'VaR 95%' },
              { type: 'vline', x: -stats.var99.historical, color: 'var(--color-loss)', label: 'VaR 99%' },
            ]}
          />
        </div>
      )}
    </Widget>
  );
}

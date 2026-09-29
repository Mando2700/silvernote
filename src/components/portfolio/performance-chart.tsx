'use client';

import { area, curveLinear, curveMonotoneX, line, scaleLinear } from 'd3';
import { Maximize2, Minimize2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useMemo, useState, type PointerEvent } from 'react';
import useSWR from 'swr';

import { useWidth } from '@/components/charts/svg';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { useMarketColors } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { FullscreenOverlay } from '@/components/ui/fullscreen-overlay';
import { Panel, Segmented, Skeleton } from '@/components/ui/primitives';
import { moneyWeightedPath, replicateInIndex } from '@/lib/finance/performance';
import { money, signedMoney, signedPct } from '@/lib/format';
import { regularSession, sessionHours } from '@/lib/session';
import { SERIES_COLORS } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Point = { t: number; value: number; invested: number; twr: number; benchmark: number; nasdaq?: number };
type Performance = { benchmark: string; points: Point[] };
type Range = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '2Y' | '5Y' | 'ALL';
type Compare = 'benchmark' | 'nasdaq' | 'both';
type Mode = 'value' | 'return';
/** Time-weighted: the holdings' return, independent of deposits. Money-weighted: the return on the money actually at work. */
type Basis = 'twr' | 'mwr';

const BASIS_LABEL: Record<Basis, string> = { twr: 'Time-weighted return', mwr: 'Money-weighted return' };
const BASIS_HINT: Record<Basis, string> = {
  twr: 'How the holdings performed, whatever you added or withdrew and when. Indexes: their price change over the same period.',
  mwr: 'Your gain on the money actually at work, so the timing and size of deposits count. Indexes: the same deposits and withdrawals, on the same days, put into the index.',
};

/** Fill gaps (no capital at work yet) with the previous value so the line stays continuous. */
function carryForward(values: Array<number | null>) {
  let last = 0;
  return values.map((value) => (value === null ? last : (last = value)));
}

const DAY = 86_400;
const RANGES: Array<{ value: Range; days?: number }> = [
  { value: '1D' },
  { value: '1W', days: 7 },
  { value: '1M', days: 30 },
  { value: '3M', days: 91 },
  { value: '6M', days: 182 },
  { value: 'YTD' },
  { value: '1Y', days: 365 },
  { value: '2Y', days: 730 },
  { value: '5Y', days: 1826 },
  { value: 'ALL' },
];
const HEIGHT = 280;
const MARGIN = { top: 16, right: 56, bottom: 26, left: 4 };
const EASE = [0.16, 1, 0.3, 1] as const;
const NASDAQ_COLOR = SERIES_COLORS[2];
// Short ranges show every data point instead of a smoothed line.
const DETAILED = new Set<Range>(['1D', '1W', '1M']);

function benchmarkName(symbol: string) {
  return symbol === 'SPY' ? 'S&P 500' : symbol;
}

function cutoff(range: Range, last: number) {
  if (range === 'ALL' || range === '1D') return -Infinity;
  if (range === 'YTD') return Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000;
  return last - (RANGES.find((item) => item.value === range)?.days ?? 0) * DAY;
}

function withLiveEnd(points: Point[], live: number | null | undefined) {
  const end = points[points.length - 1];
  if (!end || live == null || !(live > 0)) return points;
  return [...points.slice(0, -1), { ...end, value: live, twr: end.invested ? (live / end.invested) * 100 : end.twr }];
}

function timeLabel(t: number) {
  return new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

function dateLabel(t: number, withYear = false) {
  return new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

/** `live` is the headline's streamed total: on 1D the chart ends on it instead of the last (up to minutes old) server print. */
export function PerformanceChart({ portfolioId, live }: { portfolioId: string; live?: number | null }) {
  const { data } = useSWR<Performance>(`/api/portfolios/${portfolioId}/performance`);
  const [picked, setRange] = useState<Range>('3M');
  const { data: intraday } = useSWR<{ points: Point[] }>(`/api/portfolios/${portfolioId}/intraday`, { refreshInterval: picked === '1D' ? 60_000 : 0 });
  // Days before the first trade carry no value; start where the portfolio does.
  const all = useMemo(() => {
    const points = data?.points ?? [];
    const start = points.findIndex((point) => point.value > 0);
    return start < 0 ? [] : points.slice(start);
  }, [data]);

  const first = all[0]?.t ?? 0;
  const last = all[all.length - 1]?.t ?? 0;
  const hasIntraday = (intraday?.points.length ?? 0) > 2;
  const ranges = RANGES.filter((item) => (item.value === '1D' ? hasIntraday : item.value === 'ALL' || cutoff(item.value, last) > first - 3 * DAY));
  const range = ranges.some((item) => item.value === picked) ? picked : 'ALL';
  const [mode, setMode] = useState<Mode>('value');
  const [compare, setCompare] = useState<Compare>('benchmark');
  const [pickedBasis, setBasis] = useState<Basis>('twr');
  const [fullscreen, setFullscreen] = useState(false);

  if (!data) {
    return (
      <Panel className="p-4">
        <Skeleton className="h-[360px]" />
      </Panel>
    );
  }
  if (all.length < 3) return null;

  const from = cutoff(range, last);
  const startIndex = Math.max(0, all.findIndex((point) => point.t >= from) - 1);
  const points = range === '1D' && intraday ? withLiveEnd(intraday.points, live) : all.slice(startIndex);
  const name = benchmarkName(data.benchmark);
  // Nothing is added or withdrawn within a session, so both measures agree on 1D.
  const basis: Basis = range === '1D' ? 'twr' : pickedBasis;

  const body = (
    <>
      <ChartBody points={points} benchmark={name} mode={mode} basis={basis} range={range} compare={data.benchmark === 'QQQ' ? 'benchmark' : compare} height={fullscreen ? 520 : HEIGHT} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <Segmented size="xs" value={range} onChange={setRange} options={ranges.map((item) => ({ value: item.value, label: item.value === 'ALL' ? 'All' : item.value }))} />
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'return' && data.benchmark !== 'QQQ' ? (
            <Segmented
              size="xs"
              value={compare}
              onChange={setCompare}
              options={[
                { value: 'benchmark', label: name },
                { value: 'nasdaq', label: 'Nasdaq 100' },
                { value: 'both', label: 'Both' },
              ]}
            />
          ) : null}
          {range !== '1D' ? (
            <span title={BASIS_HINT[basis]}>
              <Segmented
                size="xs"
                value={basis}
                onChange={setBasis}
                options={[
                  { value: 'twr', label: 'Time-weighted' },
                  { value: 'mwr', label: 'Money-weighted' },
                ]}
              />
            </span>
          ) : null}
          <Segmented
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'value', label: 'Value' },
              { value: 'return', label: 'Return vs index' },
            ]}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            onClick={() => setFullscreen((value) => !value)}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          />
        </div>
      </div>
    </>
  );

  if (fullscreen) {
    return (
      <FullscreenOverlay onClose={() => setFullscreen(false)}>
        <Panel className="flex h-full flex-col overflow-y-auto">{body}</Panel>
      </FullscreenOverlay>
    );
  }

  return <Panel className="overflow-hidden">{body}</Panel>;
}

function ChartBody({
  points,
  benchmark,
  mode,
  basis,
  range,
  compare,
  height = HEIGHT,
}: {
  points: Point[];
  benchmark: string;
  mode: Mode;
  basis: Basis;
  range: Range;
  compare: Compare;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const palette = useMarketColors();
  const reduced = useReducedMotion();
  const gradientId = useId().replace(/:/g, '');

  const start = points[0];
  const end = points[points.length - 1];
  const focus = points[hover ?? points.length - 1];
  const intraday = range === '1D';
  const detailed = DETAILED.has(range);

  // Index lines to compare against in return mode; value mode shows net invested (or the prior close on 1D).
  const indexes = [
    { key: 'benchmark' as const, label: benchmark, color: SERIES_COLORS[0], of: (point: Point) => point.benchmark },
    { key: 'nasdaq' as const, label: 'Nasdaq 100', color: NASDAQ_COLOR, of: (point: Point) => point.nasdaq ?? point.benchmark },
  ].filter((index) => compare === 'both' || compare === index.key);
  // Return from the start of the range to each point, as fractions, on the chosen basis. An index is
  // measured the same way: its price change (time-weighted), or the portfolio's own flows put into it (money-weighted).
  const returnsOf = (series: Point[]) => (basis === 'twr' ? series.map((point) => point.twr / series[0].twr - 1) : carryForward(moneyWeightedPath(series)));
  const portfolioReturns = returnsOf(points);
  const indexReturns = (of: (point: Point) => number) =>
    basis === 'twr'
      ? points.map((point) => of(point) / of(start) - 1)
      : carryForward(moneyWeightedPath(replicateInIndex(points, (_, index) => of(points[index]))));

  const primary = mode === 'value' ? points.map((point) => point.value) : portfolioReturns.map((value) => value * 100);
  const indexSeries = indexes.map((index) => ({ key: index.key, label: index.label, color: index.color, values: indexReturns(index.of).map((value) => value * 100) }));
  const secondaries =
    mode === 'value'
      ? [{ key: 'invested', label: intraday ? 'Prior close' : 'Net invested', color: 'var(--color-faint)', values: points.map((point) => point.invested) }]
      : indexSeries;
  const hoverIndex = hover ?? points.length - 1;

  const periodReturn = portfolioReturns[hoverIndex];
  // Dollar gain excludes money added or withdrawn during the period.
  const periodGain = focus.value - start.value - (focus.invested - start.invested);
  const endReturn = portfolioReturns[portfolioReturns.length - 1];
  const up = (mode === 'value' ? endReturn : endReturn - (indexSeries[0]?.values.at(-1) ?? 0) / 100) >= 0;
  const tone = up ? palette.gain : palette.loss;

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  const values = [...primary, ...secondaries.flatMap((series) => series.values), ...(mode === 'return' ? [0] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || Math.abs(max) || 1) * 0.12;
  const y = scaleLinear().domain([min - pad, max + pad]).range([innerHeight, 0]).nice(4);
  // A session always spans open to close, so the line starts at the left and advances rightward as the day goes on.
  const session = intraday ? regularSession(end.t) : null;
  const x = scaleLinear().domain(session ? [Math.min(start.t, session.open), Math.max(end.t, session.close)] : [start.t, end.t]).range([0, innerWidth]);

  const curve = detailed ? curveLinear : curveMonotoneX;
  const linePath = line<number>().x((_, i) => x(points[i].t)).y((value) => y(value)).curve(curve);
  const areaPath = area<number>().x((_, i) => x(points[i].t)).y0(innerHeight).y1((value) => y(value)).curve(curve);
  const ticks = y.ticks(detailed ? 6 : 4);
  const xTicks = innerWidth ? xTickValues(points, range, session, Math.max(2, Math.min(detailed ? 8 : 6, Math.floor(innerWidth / (intraday ? 80 : 100))))) : [];
  const drawKey = `${range}-${mode}-${basis}-${compare}-${points.length}`;
  // Daily points get markers on short ranges so each session is visible.
  const markers = (range === '1W' || range === '1M') && innerWidth / points.length > 8;

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const t = x.invert(event.clientX - bounds.left);
    let best = 0;
    for (let i = 1; i < points.length; i += 1) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best);
  };

  const span = Math.abs(max - min);
  const formatAxis = (value: number) => (mode === 'value' ? money(value, { compact: span > 2_000 }) : `${value > 0 ? '+' : ''}${value.toFixed(span < 1 ? 2 : span < 4 ? 1 : 0)}%`);
  const stamp = (t: number) => (intraday ? `${timeLabel(t)} ET` : dateLabel(t, true));
  const hoverX = hover !== null ? x(points[hover].t) : null;
  const previous = hover !== null && hover > 0 ? points[hover - 1] : null;

  return (
    <div className="px-4 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="kicker mb-1" title={mode === 'return' ? BASIS_HINT[basis] : undefined}>
            {hover !== null ? stamp(focus.t) : mode === 'value' ? 'Portfolio value' : BASIS_LABEL[basis]}
          </div>
          <div className="num text-[30px] leading-none font-semibold tracking-[-0.02em] text-ink">
            {mode === 'value' ? (
              hover !== null ? money(focus.value) : <AnimatedNumber value={focus.value} format={(value) => money(value)} from="near" />
            ) : hover !== null ? (
              signedPct(periodReturn)
            ) : (
              <AnimatedNumber key={drawKey} value={periodReturn * 100} format={(value) => signedPct(value, 2, true)} />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            {mode === 'value' ? (
              <span className="num font-medium" style={{ color: periodGain >= 0 ? palette.gain : palette.loss }}>
                {signedMoney(periodGain)} ({signedPct(periodReturn)}
                {intraday ? '' : basis === 'twr' ? ' time-weighted' : ' money-weighted'})
              </span>
            ) : (
              indexSeries.map((index) => {
                const diff = periodReturn - index.values[hoverIndex] / 100;
                return (
                  <span key={index.key} className="num font-medium" style={{ color: diff >= 0 ? palette.gain : palette.loss }}>
                    {signedPct(diff * 100, 2, true).replace('%', ' pts')} vs {index.label}
                  </span>
                );
              })
            )}
            <span className="text-muted">
              {intraday ? (hover !== null ? 'since prior close' : 'today') : hover !== null ? `since ${dateLabel(start.t)}` : range === 'ALL' ? `since ${dateLabel(start.t, true)}` : range === 'YTD' ? 'year to date' : `past ${range}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 pb-0.5 text-[11.5px] text-muted">
          <Legend color={tone} label={mode === 'value' ? 'Value' : 'Portfolio'} />
          {secondaries.map((series) => (
            <Legend
              key={series.key}
              color={series.color}
              label={mode === 'value' ? series.label : `${series.label} ${signedPct(series.values[hoverIndex], 2, true)}`}
              dashed
            />
          ))}
                  </div>
      </div>

      <div ref={ref} className="relative mt-3 select-none" style={{ height }}>
        {width > 0 ? (
          <svg width={width} height={height} className="overflow-visible">
            <defs>
              <linearGradient id={`fill-${gradientId}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={tone} stopOpacity={0.28} />
                <stop offset="70%" stopColor={tone} stopOpacity={0.04} />
                <stop offset="100%" stopColor={tone} stopOpacity={0} />
              </linearGradient>
              <filter id={`glow-${gradientId}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {ticks.map((tick) => (
                <g key={tick} transform={`translate(0,${y(tick)})`}>
                  <line x2={innerWidth} stroke={mode === 'return' && tick === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} strokeDasharray={tick === 0 && mode === 'return' ? undefined : '2 4'} />
                  <text x={innerWidth + 10} dy="0.32em" className="num fill-faint text-[10.5px]">
                    {formatAxis(tick)}
                  </text>
                </g>
              ))}
              {xTicks.map((tick) => (
                <g key={tick}>
                  {detailed ? <line x1={x(tick)} x2={x(tick)} y1={0} y2={innerHeight} stroke="var(--color-line)" strokeDasharray="2 4" opacity={0.6} /> : null}
                  <text x={x(tick)} y={innerHeight + 18} textAnchor="middle" className="num fill-faint text-[10.5px]">
                    {intraday ? timeLabel(tick) : range === '1W' ? new Date(tick * 1000).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) : dateLabel(tick)}
                  </text>
                </g>
              ))}

              <AnimatePresence mode="popLayout" initial={!reduced}>
                <motion.g key={drawKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                  <motion.path
                    d={areaPath(primary) ?? ''}
                    fill={`url(#fill-${gradientId})`}
                    initial={reduced ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
                  />
                  {secondaries.map((series, index) => (
                    <motion.path
                      key={series.key}
                      d={linePath(series.values) ?? ''}
                      fill="none"
                      stroke={series.color}
                      strokeWidth={1.25}
                      strokeDasharray={index === 0 ? '4 4' : '1.5 3.5'}
                      strokeLinecap="round"
                      initial={reduced ? false : { opacity: 0 }}
                      animate={{ opacity: 0.9 }}
                      transition={{ duration: 0.6, delay: 0.3 + index * 0.1 }}
                    />
                  ))}
                  <motion.path
                    d={linePath(primary) ?? ''}
                    fill="none"
                    stroke={tone}
                    strokeWidth={detailed ? 1.75 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    initial={reduced ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, ease: EASE }}
                  />
                  {markers
                    ? primary.map((value, i) => (
                        <motion.circle
                          key={points[i].t}
                          cx={x(points[i].t)}
                          cy={y(value)}
                          r={2.5}
                          fill="var(--color-surface-2)"
                          stroke={tone}
                          strokeWidth={1.5}
                          initial={reduced ? false : { opacity: 0, scale: 0 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.2 + (i / points.length) * 0.7, duration: 0.25 }}
                        />
                      ))
                    : null}
                  {hover === null ? (
                    <motion.g initial={reduced ? false : { scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.85, type: 'spring', stiffness: 400, damping: 20 }} style={{ originX: `${x(end.t)}px`, originY: `${y(primary[primary.length - 1])}px` }}>
                      <circle cx={x(end.t)} cy={y(primary[primary.length - 1])} r={7} fill={tone} opacity={0.35} className={reduced ? undefined : 'animate-ping'} style={{ transformOrigin: `${x(end.t)}px ${y(primary[primary.length - 1])}px` }} />
                      <circle cx={x(end.t)} cy={y(primary[primary.length - 1])} r={3.5} fill={tone} stroke="var(--color-surface-2)" strokeWidth={1.5} />
                    </motion.g>
                  ) : null}
                </motion.g>
              </AnimatePresence>

              {hover !== null && hoverX !== null ? (
                <g pointerEvents="none">
                  <line x1={hoverX} x2={hoverX} y1={0} y2={innerHeight} stroke="var(--color-line-strong)" />
                  {secondaries.map((series) => (
                    <circle key={series.key} cx={hoverX} cy={y(series.values[hover])} r={3} fill={series.color} />
                  ))}
                  <circle cx={hoverX} cy={y(primary[hover])} r={9} fill={tone} opacity={0.5} filter={`url(#glow-${gradientId})`} />
                  <circle cx={hoverX} cy={y(primary[hover])} r={4} fill={tone} stroke="var(--color-surface-2)" strokeWidth={1.5} />
                </g>
              ) : null}

              <rect width={innerWidth} height={innerHeight} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: 'pan-y' }} />
            </g>
          </svg>
        ) : null}

        {hover !== null && hoverX !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-sm border border-line-strong bg-surface-3/95 px-2.5 py-1.5 text-[11.5px] shadow-lg backdrop-blur"
            style={{ left: Math.min(Math.max(MARGIN.left + hoverX - 80, 0), Math.max(0, width - 170)), width: 160 }}
          >
            <div className="text-faint">{stamp(points[hover].t)}</div>
            {mode === 'value' ? (
              <>
                <Row label="Value" value={money(points[hover].value)} />
                <Row label={intraday ? 'Prior close' : 'Invested'} value={money(points[hover].invested)} />
                {previous && detailed && !intraday ? <Row label="Day" value={signedPct(points[hover].twr / previous.twr - 1)} tone={points[hover].twr >= previous.twr ? palette.gain : palette.loss} /> : null}
              </>
            ) : (
              <>
                <Row label="Portfolio" value={signedPct(primary[hover], 2, true)} />
                {secondaries.map((series) => (
                  <Row key={series.key} label={series.label} value={signedPct(series.values[hover], 2, true)} />
                ))}
                {previous && detailed && !intraday ? <Row label="Day" value={signedPct(points[hover].twr / previous.twr - 1)} tone={points[hover].twr >= previous.twr ? palette.gain : palette.loss} /> : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** X-axis ticks at natural boundaries: every hour on 1D, every session on 1W, evenly spread otherwise. */
function xTickValues(points: Point[], range: Range, session: ReturnType<typeof regularSession> | null, count: number) {
  const first = points[0].t;
  const last = points[points.length - 1].t;
  if (range === '1D') {
    const ticks = session ? sessionHours(session) : [];
    const step = Math.max(1, Math.ceil(ticks.length / count));
    return ticks.filter((_, i) => i % step === 0);
  }
  if (range === '1W') return points.slice(1).map((point) => point.t);
  return scaleLinear().domain([first, last]).ticks(count).map(Number);
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="num text-ink" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="6" aria-hidden>
        <line x1="1" x2="15" y1="3" y2="3" stroke={color} strokeWidth={2} strokeDasharray={dashed ? '3 3' : undefined} strokeLinecap="round" />
      </svg>
      <span className={cn('num')}>{label}</span>
    </span>
  );
}

'use client';

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  type AutoscaleInfoProvider,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useMarketColors } from '@/components/shell/providers';
import type { Candle } from '@/lib/data/types';
import { compactNumber, price, shortDate, signedPct } from '@/lib/format';
import { SILVER, withAlpha, type MarketPalette } from '@/lib/theme';
import { cn } from '@/lib/utils';

export type ChartMarker = { t: number; label: string; tone?: 'brand' | 'muted' };

type Hover = { t: number; o: number; h: number; l: number; c: number; v: number | null } | null;
type Mode = 'area' | 'candles';
type PriceRange = { min: number; max: number };
type PriceSeries = ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>;

// Timeframe morph, ported from Nestor's chart engine.
const TRANSITION_MS = 430;
// Candle bodies fill ~80% of a slot; half a body of padding lets the first and last candle meet the plot edge.
const CANDLE_EDGE_PADDING_BARS = 0.4;

function easeInOutCubic(value: number) {
  const x = Math.min(1, Math.max(0, value));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

/** The source path sampled at the target's bar positions (by index ratio), carrying the target's timestamps. */
function resample(source: Candle[], target: Candle[]): Candle[] {
  if (!source.length) return target;
  return target.map((bar, index) => {
    const position = (target.length <= 1 ? 1 : index / (target.length - 1)) * (source.length - 1);
    const lower = source[Math.floor(position)];
    const upper = source[Math.ceil(position)];
    const local = position - Math.floor(position);
    return {
      t: bar.t,
      o: lerp(lower.o, upper.o, local),
      h: lerp(lower.h, upper.h, local),
      l: lerp(lower.l, upper.l, local),
      c: lerp(lower.c, upper.c, local),
      v: lerp(lower.v ?? 0, upper.v ?? 0, local),
    };
  });
}

function interpolate(from: Candle[], to: Candle[], progress: number): Candle[] {
  return to.map((bar, index) => {
    const start = from[index] ?? bar;
    return {
      t: bar.t,
      o: lerp(start.o, bar.o, progress),
      h: lerp(start.h, bar.h, progress),
      l: lerp(start.l, bar.l, progress),
      c: lerp(start.c, bar.c, progress),
      v: lerp(start.v ?? 0, bar.v ?? 0, progress),
    };
  });
}

function priceRange(bars: Candle[], mode: Mode): PriceRange | null {
  if (!bars.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const bar of bars) {
    min = Math.min(min, mode === 'candles' ? bar.l : bar.c);
    max = Math.max(max, mode === 'candles' ? bar.h : bar.c);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') return true;
  const preference = document.documentElement.dataset.motion;
  if (preference === 'reduced') return true;
  if (preference === 'full') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function trendColor(candles: Candle[], market: MarketPalette) {
  const first = candles[0]?.c;
  const last = candles[candles.length - 1]?.c;
  if (first === undefined || last === undefined || last === first) return SILVER.base;
  return last > first ? market.gainFill : market.lossFill;
}

export function PriceChart({
  candles,
  mode = 'area',
  height = 340,
  markers = [],
  targetPrice,
  animationKey,
  className,
}: {
  candles: Candle[];
  mode?: Mode;
  height?: number;
  markers?: ChartMarker[];
  targetPrice?: number | null;
  /** Data for a different key (e.g. another symbol) replaces the chart instead of morphing into it. */
  animationKey?: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<PriceSeries | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const modeRef = useRef(mode);
  const marketRef = useRef<MarketPalette | null>(null);
  // What is on screen right now (mid-transition frames included), so a new range morphs from the current frame.
  const shownRef = useRef<{ bars: Candle[]; key: string | undefined }>({ bars: [], key: undefined });
  const animationRef = useRef<{ frame: number | null; range: PriceRange | null }>({ frame: null, range: null });
  const [series, setSeries] = useState<PriceSeries | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const market = useMarketColors();
  const sorted = useMemo(() => [...candles].sort((a, b) => a.t - b.t), [candles]);

  const renderBars = (bars: Candle[]) => {
    const priceSeries = priceRef.current;
    const volume = volumeRef.current;
    const palette = marketRef.current;
    if (!priceSeries || !volume || !palette) return;
    if (modeRef.current === 'area') {
      (priceSeries as ISeriesApi<'Area'>).setData(bars.map((bar) => ({ time: bar.t as UTCTimestamp, value: bar.c })));
    } else {
      (priceSeries as ISeriesApi<'Candlestick'>).setData(
        bars.map((bar) => ({ time: bar.t as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c })),
      );
    }
    volume.setData(
      bars.map((bar, index) => ({
        time: bar.t as UTCTimestamp,
        value: bar.v ?? 0,
        color: withAlpha(bar.c >= (bars[index - 1]?.c ?? bar.o) ? palette.gainFill : palette.lossFill, 0.35),
      })),
    );
    shownRef.current.bars = bars;
  };

  const fitViewport = (count: number) => {
    const chart = chartRef.current;
    if (!chart || !count) return;
    const padding = modeRef.current === 'candles' ? CANDLE_EDGE_PADDING_BARS : 0;
    chart.timeScale().setVisibleLogicalRange({ from: -padding, to: Math.max(count - 1, 1) + padding });
  };

  const cancelAnimation = () => {
    const animation = animationRef.current;
    if (animation.frame !== null) cancelAnimationFrame(animation.frame);
    animation.frame = null;
    animation.range = null;
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#858a95',
        fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
        fontSize: 10.5,
        attributionLogo: false,
      },
      grid: { vertLines: { color: 'rgba(255,255,255,0.035)' }, horzLines: { color: 'rgba(255,255,255,0.035)' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderVisible: false, fixLeftEdge: false, fixRightEdge: false, rightOffset: 0, minBarSpacing: 0.5, timeVisible: false },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: 'rgba(255,255,255,0.28)', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#1c2027' },
        horzLine: { color: 'rgba(255,255,255,0.18)', width: 1, style: LineStyle.Solid, labelBackgroundColor: '#1c2027' },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    chartRef.current = chart;
    volumeRef.current = volume;
    // Keep the whole range framed when the panel resizes, as Nestor re-fits on layout changes.
    const onResize = () => fitViewport(shownRef.current.bars.length);
    chart.timeScale().subscribeSizeChange(onResize);
    return () => {
      cancelAnimation();
      chart.remove();
      chartRef.current = null;
      volumeRef.current = null;
      priceRef.current = null;
      shownRef.current = { bars: [], key: undefined };
    };
     
  }, [height]);

  // The price series is rebuilt when the chart style or palette changes; data swaps morph in the effect below.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    modeRef.current = mode;
    marketRef.current = market;
    const autoscaleInfoProvider: AutoscaleInfoProvider = (base) => {
      const range = animationRef.current.range;
      return range ? { priceRange: { minValue: range.min, maxValue: range.max } } : base();
    };
    const priceSeries: PriceSeries =
      mode === 'area'
        ? chart.addSeries(AreaSeries, {
            lineColor: SILVER.base,
            lineWidth: 2,
            topColor: withAlpha(SILVER.base, 0.12),
            bottomColor: withAlpha(SILVER.base, 0),
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerRadius: 4,
            crosshairMarkerBorderColor: '#0f1115',
            crosshairMarkerBackgroundColor: SILVER.bright,
            autoscaleInfoProvider,
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: market.gainFill,
            downColor: market.lossFill,
            borderUpColor: market.gainFill,
            borderDownColor: market.lossFill,
            wickUpColor: market.gainFill,
            wickDownColor: market.lossFill,
            priceLineVisible: false,
            autoscaleInfoProvider,
          });
    priceRef.current = priceSeries;
    cancelAnimation();
    shownRef.current.bars = [];
    setSeries(priceSeries);
    return () => {
      if (priceRef.current === priceSeries) priceRef.current = null;
      if (chartRef.current !== chart) return;
      try {
        chart.removeSeries(priceSeries);
      } catch {
        // series already detached
      }
    };
     
  }, [mode, market, height]);

  useEffect(() => {
    if (!series || !sorted.length) return;
    const line = trendColor(sorted, market);
    if (mode === 'area') {
      (series as ISeriesApi<'Area'>).applyOptions({
        lineColor: line,
        topColor: withAlpha(line, 0.14),
        bottomColor: withAlpha(line, 0),
        crosshairMarkerBackgroundColor: line,
      });
    }

    const previous = shownRef.current;
    const canMorph = previous.bars.length > 0 && previous.key === animationKey && !prefersReducedMotion();
    cancelAnimation();
    shownRef.current.key = animationKey;
    if (!canMorph) {
      renderBars(sorted);
      fitViewport(sorted.length);
      return;
    }

    const from = resample(previous.bars, sorted);
    const fromRange = priceRange(from, mode);
    const toRange = priceRange(sorted, mode);
    const animation = animationRef.current;
    animation.range = fromRange;
    renderBars(from);
    fitViewport(sorted.length);

    let startedAt: number | null = null;
    const step = (now: number) => {
      startedAt ??= now;
      const progress = easeInOutCubic((now - startedAt) / TRANSITION_MS);
      animation.range =
        fromRange && toRange ? { min: lerp(fromRange.min, toRange.min, progress), max: lerp(fromRange.max, toRange.max, progress) } : null;
      if (progress >= 1) {
        animation.frame = null;
        animation.range = null;
        renderBars(sorted);
        return;
      }
      renderBars(interpolate(from, sorted, progress));
      animation.frame = requestAnimationFrame(step);
    };
    animation.frame = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers only read refs
  }, [series, sorted, animationKey]);

  useEffect(() => {
    if (!series || !sorted.length) return;
    const first = sorted[0].t;
    const seriesMarkers: SeriesMarker<Time>[] = markers
      .filter((marker) => marker.t >= first)
      .map((marker) => {
        const nearest = sorted.find((candle) => candle.t >= marker.t) ?? sorted[sorted.length - 1];
        const item: SeriesMarker<Time> = {
          time: nearest.t as UTCTimestamp,
          position: 'aboveBar',
          color: marker.tone === 'muted' ? '#858a95' : SILVER.bright,
          shape: 'circle',
          text: marker.label,
          size: 1,
        };
        return item;
      })
      .sort((a, b) => Number(a.time) - Number(b.time));
    const markerPlugin = seriesMarkers.length ? createSeriesMarkers(series, seriesMarkers) : null;
    const targetLine =
      targetPrice && Number.isFinite(targetPrice)
        ? series.createPriceLine({ price: targetPrice, color: SILVER.soft, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Target' })
        : null;
    return () => {
      if (priceRef.current !== series) return;
      try {
        markerPlugin?.detach();
        if (targetLine) series.removePriceLine(targetLine);
      } catch {
        // series already detached
      }
    };
  }, [series, sorted, markers, targetPrice]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const byTime = new Map(sorted.map((candle) => [candle.t, candle]));
    const onMove: Parameters<IChartApi['subscribeCrosshairMove']>[0] = (param) => {
      if (!param.time) {
        setHover(null);
        return;
      }
      const candle = byTime.get(Number(param.time));
      setHover(candle ? { ...candle } : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      if (chartRef.current === chart) chart.unsubscribeCrosshairMove(onMove);
    };
  }, [sorted, height]);

  const last = sorted[sorted.length - 1];
  const firstCandle = sorted[0];
  const shown = hover ?? (last ? { ...last } : null);
  const rangeReturn = firstCandle && last ? last.c / firstCandle.c - 1 : null;

  return (
    <div className={cn('relative', className)}>
      <div className="pointer-events-none absolute top-0 left-0 z-10 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px]">
        {shown ? (
          <>
            <span className="text-faint">{shortDate(shown.t)}</span>
            <span className="text-muted">
              O <span className="num text-ink-2">{price(shown.o)}</span>
            </span>
            <span className="text-muted">
              H <span className="num text-ink-2">{price(shown.h)}</span>
            </span>
            <span className="text-muted">
              L <span className="num text-ink-2">{price(shown.l)}</span>
            </span>
            <span className="text-muted">
              C <span className="num text-ink">{price(shown.c)}</span>
            </span>
            <span className="text-muted">
              Vol <span className="num text-ink-2">{compactNumber(shown.v)}</span>
            </span>
          </>
        ) : null}
        {!hover && rangeReturn !== null ? (
          <span className={cn('num font-medium', rangeReturn >= 0 ? 'text-gain' : 'text-loss')}>{signedPct(rangeReturn)} over range</span>
        ) : null}
      </div>
      <div ref={hostRef} className="w-full pt-5" style={{ height }} />
    </div>
  );
}

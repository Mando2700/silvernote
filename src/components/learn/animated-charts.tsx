'use client';

import { useMemo, type ComponentProps } from 'react';

import { ColumnChart, columnDomain, LineChart, lineDomain, Waterfall, waterfallDomain } from '@/components/charts/svg';
import { useTweened } from '@/components/learn/tween';

// The shared charts with their data *and* y axis tweened together, so lesson sliders morph them
// smoothly (tweening only the data would re-round the axis every frame and make bars jump).

export function TweenedWaterfall(props: ComponentProps<typeof Waterfall>) {
  const target = useMemo(() => ({ steps: props.steps, domain: waterfallDomain(props.steps) }), [props.steps]);
  const shown = useTweened(target);
  return <Waterfall {...props} steps={shown.steps} yDomain={shown.domain} />;
}

export function TweenedColumnChart(props: ComponentProps<typeof ColumnChart>) {
  const target = useMemo(() => ({ series: props.series, domain: columnDomain(props.series) }), [props.series]);
  const shown = useTweened(target);
  return <ColumnChart {...props} series={shown.series} yDomain={shown.domain} />;
}

export function TweenedLineChart(props: ComponentProps<typeof LineChart>) {
  const target = useMemo(() => ({ series: props.series, domain: lineDomain(props.series, props.zeroLine) }), [props.series, props.zeroLine]);
  const shown = useTweened(target);
  return <LineChart {...props} series={shown.series} yDomain={shown.domain} />;
}

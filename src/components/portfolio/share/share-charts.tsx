import { arc, area, curveMonotoneX, line, pie, scaleLinear } from 'd3';

import { ShareLogo } from '@/components/portfolio/share/share-logo';
import type { ShareSlice, SharePerformance } from '@/lib/share/view';
import { MAX_SLICES, NEUTRAL_COLORS, sliceColorMap } from '@/lib/share/colors';
import { groupSlices, weightLabel } from '@/lib/share/view';


/** The slices a donut and its legend show, in order, each with its color. */
export function donutSlices(slices: ShareSlice[]) {
  const colors = sliceColorMap(slices);
  return groupSlices(slices, MAX_SLICES).map((slice) => ({ ...slice, color: colors.get(slice.label) ?? NEUTRAL_COLORS.other }));
}

export function ShareDonut({ slices, size = 180, thickness = 30, centerLabel, centerValue, logoSrc }: { slices: ShareSlice[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: string; logoSrc?: (symbol: string) => string }) {
  const items = donutSlices(slices);
  const radius = size / 2;
  const generator = arc<{ startAngle: number; endAngle: number; padAngle: number }>().innerRadius(radius - thickness).outerRadius(radius - 1).cornerRadius(2);
  const segments = pie<(typeof items)[number]>().value((slice) => slice.weight).sort(null).padAngle(items.length > 1 ? 0.018 : 0)(items);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`${-radius} ${-radius} ${size} ${size}`} width={size} height={size} role="img" aria-label="Allocation">
        {segments.map((segment) => (
          <path key={segment.data.label} d={generator(segment) ?? ''} fill={segment.data.color} />
        ))}
      </svg>
      {logoSrc
        ? segments.map((segment) => {
            // A logo rides on each holding's slice when the slice is wide enough for it.
            const mid = radius - thickness / 2 - 0.5;
            const logo = thickness - 8;
            const at = (segment.startAngle + segment.endAngle) / 2;
            if (segment.data.kind !== 'holding' || (segment.endAngle - segment.startAngle) * mid < logo * 1.3) return null;
            return (
              <span key={segment.data.label} className="absolute" style={{ left: radius + Math.sin(at) * mid - logo / 2, top: radius - Math.cos(at) * mid - logo / 2 }}>
                <ShareLogo symbol={segment.data.label} color={segment.data.color} src={logoSrc(segment.data.label)} size={logo} />
              </span>
            );
          })
        : null}
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="num text-[20px] leading-none font-semibold tracking-[-0.02em] text-ink">{centerValue}</div>
          {centerLabel ? <div className="mt-1 text-[10.5px] text-muted">{centerLabel}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Each slice's color, its logo (for a holding) and weight. */
export function ShareLegend({ slices, logoSrc }: { slices: ShareSlice[]; logoSrc?: (symbol: string) => string }) {
  return (
    <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
      {donutSlices(slices).map((slice) => (
        <li key={slice.label} className="flex items-center gap-2 text-[12.5px]">
          {slice.kind === 'holding' ? <ShareLogo symbol={slice.label} color={slice.color} src={logoSrc?.(slice.label)} size={20} /> : <span className="grid size-5 shrink-0 place-items-center"><span className="size-2.5 rounded-[3px]" style={{ background: slice.color }} /></span>}
          <span className={slice.kind === 'holding' ? 'min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-ink' : 'min-w-0 flex-1 truncate text-ink-2'}>{slice.label}</span>
          <span className="num text-ink">{weightLabel(slice.weight)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The Nasdaq 100 line, distinct from the grey benchmark. */
export const NASDAQ_COLOR = '#7aa7ff';

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, bottom: 12 };

/** Portfolio against its benchmark, both indexed to 100 at the start. Text lives outside the SVG so it never stretches. */
export function ShareLineChart({ performance, height = HEIGHT }: { performance: SharePerformance; height?: number }) {
  const { points } = performance;
  const times = points.map((point) => point.t);
  const withNasdaq = performance.nasdaqReturn !== undefined && points.every((point) => point.nasdaq !== undefined);
  const values = points.flatMap((point) => (withNasdaq ? [point.portfolio, point.benchmark, point.nasdaq ?? 100] : [point.portfolio, point.benchmark]));
  const lo = Math.min(...values, 100);
  const hi = Math.max(...values, 100);
  const margin = (hi - lo || 1) * 0.08;
  const x = scaleLinear().domain([times[0], times[times.length - 1]]).range([0, WIDTH]);
  const y = scaleLinear().domain([lo - margin, hi + margin]).range([HEIGHT - PAD.bottom, PAD.top]);
  const portfolioLine = line<(typeof points)[number]>().x((point) => x(point.t)).y((point) => y(point.portfolio)).curve(curveMonotoneX);
  const benchmarkLine = line<(typeof points)[number]>().x((point) => x(point.t)).y((point) => y(point.benchmark)).curve(curveMonotoneX);
  const nasdaqLine = line<(typeof points)[number]>().x((point) => x(point.t)).y((point) => y(point.nasdaq ?? 100)).curve(curveMonotoneX);
  const fill = area<(typeof points)[number]>().x((point) => x(point.t)).y0(HEIGHT).y1((point) => y(point.portfolio)).curve(curveMonotoneX);
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={`Portfolio against ${performance.benchmark}`}>
      <defs>
        <linearGradient id="share-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cdd4de" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#cdd4de" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={0} x2={WIDTH} y1={y(100)} y2={y(100)} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      <path d={fill(points) ?? ''} fill="url(#share-area)" />
      <path d={benchmarkLine(points) ?? ''} fill="none" stroke="#7c8695" strokeWidth={1.4} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      {withNasdaq ? <path d={nasdaqLine(points) ?? ''} fill="none" stroke={NASDAQ_COLOR} strokeWidth={1.4} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" /> : null}
      <path d={portfolioLine(points) ?? ''} fill="none" stroke="#f4f6f9" strokeWidth={1.8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

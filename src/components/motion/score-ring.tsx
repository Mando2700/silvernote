'use client';

import { motion, useInView, useReducedMotion } from 'motion/react';
import { useId, useRef } from 'react';

import { AnimatedNumber } from '@/components/motion/animated-number';
import { HoverCard } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';

export type SubScoreSummary = { key: string; name: string; weight: number; score: number; confidence?: string };

const SIZES = {
  xs: { box: 22, stroke: 2.5, text: 'text-[9.5px]' },
  sm: { box: 34, stroke: 3, text: 'text-[11px]' },
  md: { box: 64, stroke: 4, text: 'text-[18px]' },
  lg: { box: 116, stroke: 6, text: 'text-[34px]' },
} as const;

function ringColor(score: number) {
  if (score >= 86) return '#e6b93c'; // gold
  if (score >= 71) return '#15803d'; // dark green
  if (score >= 56) return '#4ade80'; // light green
  if (score >= 41) return '#facc15'; // yellow
  if (score >= 26) return '#ef4444'; // red
  return '#27272a'; // black
}

export function ScoreRing({
  score,
  size = 'md',
  label,
  confidence,
  subScores,
  className,
}: {
  score: number | null | undefined;
  size?: keyof typeof SIZES;
  label?: string | null;
  confidence?: string | null;
  subScores?: SubScoreSummary[] | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const spec = SIZES[size];
  const radius = (spec.box - spec.stroke) / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const fraction = hasScore ? Math.max(0, Math.min(1, (score as number) / 100)) : 0;
  const color = hasScore ? ringColor(score as number) : 'rgba(255,255,255,0.15)';
  // Top scores get a polished-gold stroke.
  const metallic = hasScore && (score as number) >= 86;
  const gradientId = `ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const ring = (
    <div ref={ref} className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: spec.box, height: spec.box }}>
      <svg width={spec.box} height={spec.box} className="-rotate-90" aria-hidden>
        {metallic ? (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff3c4" />
              <stop offset="0.4" stopColor="#d4a52c" />
              <stop offset="0.68" stopColor="#f5d77a" />
              <stop offset="1" stopColor="#a67c1a" />
            </linearGradient>
          </defs>
        ) : null}
        <circle cx={spec.box / 2} cy={spec.box / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={spec.stroke} />
        {hasScore ? (
          <motion.circle
            cx={spec.box / 2}
            cy={spec.box / 2}
            r={radius}
            fill="none"
            stroke={metallic ? `url(#${gradientId})` : color}
            strokeWidth={spec.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={reduced ? false : { strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: inView || reduced ? circumference * (1 - fraction) : circumference }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            style={size === 'lg' || size === 'md' ? { filter: `drop-shadow(0 0 ${size === 'lg' ? 8 : 5}px ${color}59)` } : undefined}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center leading-none">
          <span className={cn('font-semibold tracking-[-0.02em] text-ink', spec.text)}>
            {hasScore ? <AnimatedNumber value={score as number} format={(value) => Math.round(value).toString()} /> : '—'}
          </span>
          {size === 'lg' && label ? <span className="mt-1.5 font-mono text-[9.5px] tracking-[0.14em] text-muted uppercase">{label}</span> : null}
        </div>
      </div>
    </div>
  );

  if (!subScores?.length) return <span aria-label={hasScore ? `SilverNote Score ${score}` : 'Not scored yet'}>{ring}</span>;

  return (
    <HoverCard trigger={<span tabIndex={0} className="rounded-full outline-none" aria-label={`SilverNote Score ${score}. Hover for breakdown.`}>{ring}</span>} className="w-72">
      <ScoreBreakdown score={score ?? null} label={label} confidence={confidence} subScores={subScores} />
    </HoverCard>
  );
}

export function ScoreBreakdown({
  score,
  label,
  confidence,
  subScores,
}: {
  score: number | null;
  label?: string | null;
  confidence?: string | null;
  subScores: SubScoreSummary[];
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <div className="kicker">SilverNote Score</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold text-ink">{score ?? '—'}</span>
          {label ? <span className="text-[11px] text-muted">{label}</span> : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {subScores.map((item, index) => (
          <div key={item.key} className="grid grid-cols-[104px_1fr_24px] items-center gap-2">
            <span className="truncate text-[11.5px] text-ink-2">{item.name}</span>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-brand"
                initial={{ width: 0 }}
                animate={{ width: `${item.score}%` }}
                transition={{ duration: 0.6, delay: index * 0.03, ease: [0.16, 1, 0.3, 1] }}
                style={{ opacity: 0.45 + item.score / 180 }}
              />
            </div>
            <span className="num text-right text-[11px] text-ink">{item.score}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2 text-[10.5px] text-muted">
        <span>Weights sum to 100</span>
        {confidence ? <span>Confidence: {confidence}</span> : null}
      </div>
    </div>
  );
}

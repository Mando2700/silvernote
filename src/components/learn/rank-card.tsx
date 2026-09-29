'use client';

import { Award, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, type ReactNode } from 'react';

import { ProgressBar } from '@/components/learn/progress-bar';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { Panel } from '@/components/ui/primitives';
import { LESSONS, TRACKS } from '@/lib/learn/curriculum';
import { describeEta, formatMinutes, rankEtas, type ById, type Pace } from '@/lib/learn/progress';
import { RANKS, type RankSummary } from '@/lib/learn/rank';
import { cn } from '@/lib/utils';

function Ring({ value, size = 64, children }: { value: number; size?: number; children?: ReactNode }) {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#rank-gradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - Math.max(0.02, Math.min(1, value))) }}
          transition={{ type: 'spring', stiffness: 45, damping: 16, mass: 1 }}
        />
        <defs>
          <linearGradient id="rank-gradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#9fd8ff" />
            <stop offset="100%" stopColor="#f4f6f9" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Compact rank readout for sidebars. */
export function RankBadge({ rank }: { rank: RankSummary }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface-1 p-3">
      <Ring value={rank.progressToNext} size={44}>
        <Award className="size-4 text-brand" />
      </Ring>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-ink">{rank.rank}</div>
        <div className="font-mono text-[11px] text-muted">
          {rank.xp.toLocaleString()} XP{rank.next ? ` · ${(rank.next.xp - rank.xp).toLocaleString()} to go` : ''}
        </div>
      </div>
    </div>
  );
}

export function RankCard({ rank, byId, pace }: { rank: RankSummary; byId: ById; pace: Pace }) {
  const etas = useMemo(() => rankEtas(rank, byId, pace), [rank, byId, pace]);
  const eta = new Map(etas.map((item) => [item.title, item]));
  const next = etas[0];
  return (
    <Panel className="overflow-hidden p-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Ring value={rank.progressToNext} size={78}>
              <div className="text-center">
                <Award className="mx-auto size-5 text-brand drop-shadow-[0_0_8px_rgba(159,216,255,0.6)]" />
                <div className="mt-0.5 font-mono text-[9px] tracking-widest text-muted uppercase">Rank</div>
              </div>
            </Ring>
            <div className="min-w-0">
              <div className="kicker mb-1">Analyst rank</div>
              <div className="bg-gradient-to-b from-white to-ink-2 bg-clip-text text-[26px] leading-tight font-semibold tracking-[-0.02em] text-transparent">{rank.rank}</div>
              <div className="mt-0.5 font-mono text-[12px] text-muted">
                <AnimatedNumber value={rank.xp} format={(value) => Math.round(value).toLocaleString()} /> XP
                {rank.next ? ` · ${(rank.next.xp - rank.xp).toLocaleString()} XP to ${rank.next.title}` : ' · top of the ladder'}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-1">
              {RANKS.map((step, index) => {
                const stepEta = eta.get(step.title);
                return (
                  <div
                    key={step.title}
                    className="flex min-w-0 flex-1 flex-col gap-1.5"
                    title={`${step.title} · ${step.xp.toLocaleString()} XP${stepEta ? ` · ≈ ${formatMinutes(stepEta.minutes)} away` : index <= rank.rankIndex ? ' · reached' : ''}`}
                  >
                    {/* Reached ranks are full, the current one fills toward the next, later ones are empty. */}
                    <ProgressBar
                      value={index < rank.rankIndex ? 1 : index === rank.rankIndex ? (rank.next ? rank.progressToNext : 1) : 0}
                      delay={0.05 * index}
                      fillClassName={index === rank.rankIndex ? 'bg-gradient-to-r from-ion to-brand-bright shadow-[0_0_10px_rgba(159,216,255,0.6)]' : 'bg-brand-soft'}
                    />
                    <span className={cn('truncate text-[10px]', index === rank.rankIndex ? 'text-ink' : 'text-faint')}>{step.title.replace('Managing Director', 'MD').replace('Vice President', 'VP')}</span>
                    {stepEta ? <span className="-mt-1 truncate font-mono text-[9.5px] text-faint">≈{formatMinutes(stepEta.minutes)}</span> : null}
                  </div>
                );
              })}
            </div>
            {next ? (
              <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <Clock className="size-3 text-brand" />
                <span>
                  <span className="text-ink-2">≈ {formatMinutes(next.minutes)}</span> to {next.title} — about {describeEta(next)}
                </span>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Lessons', value: `${rank.lessonsDone}/${LESSONS.length}` },
              { label: 'Drills solved', value: rank.drillsCorrect.toLocaleString() },
              { label: 'Cards reviewed', value: rank.cardsReviewed.toLocaleString() },
              { label: 'Best pitch', value: rank.bestPitch !== null ? `${Math.round(rank.bestPitch)}/100` : '—' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-sm border border-line bg-surface-1 px-3 py-2">
                <div className="text-[11px] text-muted">{stat.label}</div>
                <div className="num mt-0.5 text-[16px] font-semibold text-ink">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="kicker">Mastery by track</div>
          {TRACKS.map((track, index) => {
            const value = rank.mastery[track.id] ?? 0;
            return (
              <div key={track.id}>
                <div className="mb-1 flex items-baseline justify-between text-[12px]">
                  <span className="text-ink-2">{track.title}</span>
                  <span className="num font-mono text-muted">{value}%</span>
                </div>
                <ProgressBar value={value / 100} delay={0.07 * index} />
              </div>
            );
          })}
          <div className="mt-1 text-[11px] leading-relaxed text-faint">
            XP: lessons {rank.breakdown.lessons} · drills {rank.breakdown.drills} · flashcards {rank.breakdown.cards} · graded answers {rank.breakdown.answers} · pitches {rank.breakdown.pitches}. Mastery blends lessons (quiz scores) with drill fluency.
          </div>
        </div>
      </div>
    </Panel>
  );
}

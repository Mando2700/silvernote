'use client';

import { ArrowRight, BookOpen, Check, Eye, Flame, Shuffle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useLearn } from '@/components/learn/hooks';
import { RankBadge } from '@/components/learn/rank-card';
import { Page } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Panel, Skeleton } from '@/components/ui/primitives';
import { checkNumber, TRACKS } from '@/lib/learn/curriculum';
import { DRILL_META, DRILL_TYPES, generateDrill, type DrillType } from '@/lib/learn/drills';
import { cn } from '@/lib/utils';

type Mode = DrillType | 'mixed';

const randomSeed = () => Math.floor(Math.random() * 2_000_000_000) + 1;
const noopSubscribe = () => () => {};

export function PracticeLab() {
  const { state, byId, record } = useLearn();
  const [mode, setMode] = useState<Mode>('mixed');
  const [seed, setSeed] = useState(randomSeed);
  // The server and the client draw different seeds: show the problem only once hydrated so they agree.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<null | { correct: boolean; revealed: boolean }>(null);
  const [session, setSession] = useState({ attempted: 0, correct: 0, streak: 0, best: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const type: DrillType = mode === 'mixed' ? DRILL_TYPES[seed % DRILL_TYPES.length].type : mode;
  const drill = useMemo(() => (hydrated ? generateDrill(type, seed) : null), [hydrated, type, seed]);
  const meta = DRILL_META.get(type)!;

  const next = (nextMode: Mode = mode) => {
    setMode(nextMode);
    setSeed(randomSeed());
    setInput('');
    setResult(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const submit = (revealed = false) => {
    if (!drill || result) return;
    const correct = !revealed && checkNumber(input, drill.answer, drill.tolerance);
    setResult({ correct, revealed });
    setSession((current) => {
      const streak = correct ? current.streak + 1 : 0;
      return { attempted: current.attempted + 1, correct: current.correct + (correct ? 1 : 0), streak, best: Math.max(current.best, streak) };
    });
    void record({ kind: 'drill', type, correct }, { quiet: true });
  };

  return (
    <Page
      kicker="Learn · practice lab"
      title="Practice lab"
      description="Randomized problems in the style of IB technical interviews, CFA exams and PE paper LBOs. Solve with pen, paper or a calculator — every answer comes with the full working."
      actions={
        <Link href="/learn" className="text-[12.5px] text-muted hover:text-ink">
          ← All lessons
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => next('mixed')}
            className={cn('flex items-center gap-2 rounded-md border px-3 py-2.5 text-left text-[13px] transition-colors', mode === 'mixed' ? 'border-brand/50 bg-brand-wash text-ink' : 'border-line text-ink-2 hover:border-line-strong')}
          >
            <Shuffle className="size-4 text-brand" />
            <span className="flex-1 font-medium">Mixed — all topics</span>
          </button>
          {TRACKS.filter((track) => DRILL_TYPES.some((drillType) => drillType.track === track.id)).map((track) => (
            <div key={track.id}>
              <div className="kicker mb-1 px-1">{track.title}</div>
              {DRILL_TYPES.filter((drillType) => drillType.track === track.id).map((drillType) => {
                const progress = byId.get(`drill:${drillType.type}`);
                const correct = Number(progress?.data?.correct ?? 0);
                const total = Number(progress?.data?.total ?? 0);
                return (
                  <button
                    key={drillType.type}
                    type="button"
                    onClick={() => next(drillType.type)}
                    className={cn('mb-0.5 flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] transition-colors', mode === drillType.type ? 'bg-white/[0.06] text-ink' : 'text-ink-2 hover:bg-white/[0.03]')}
                  >
                    <span className="flex-1 truncate">{drillType.label}</span>
                    {total ? (
                      <span className={cn('font-mono text-[10.5px]', correct / total >= 0.8 ? 'text-gain' : 'text-muted')}>
                        {correct}/{total}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
          {state ? <RankBadge rank={state.rank} /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'This session', value: `${session.correct}/${session.attempted}` },
              { label: 'Accuracy', value: session.attempted ? `${Math.round((session.correct / session.attempted) * 100)}%` : '—' },
              { label: 'Streak', value: String(session.streak), icon: session.streak >= 3 },
              { label: 'Best streak', value: String(session.best) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-sm border border-line bg-surface-1 px-3 py-2">
                <div className="text-[11px] text-muted">{stat.label}</div>
                <div className="num mt-0.5 flex items-center gap-1 text-[16px] font-semibold text-ink">
                  {stat.icon ? <Flame className="size-4 text-warning" /> : null}
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          <Panel className="p-5">
            {!drill ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <AnimatePresence mode="wait">
                <motion.div key={`${drill.type}-${drill.seed}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }} className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-xs border border-brand/30 bg-brand-wash px-1.5 py-0.5 font-mono text-[10.5px] tracking-wide text-brand-soft uppercase">{meta.label}</span>
                      <span className="text-[11.5px] text-muted">{meta.blurb}</span>
                    </div>
                    <Link href={`/learn/${meta.lesson}`} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-ink">
                      <BookOpen className="size-3" /> Lesson
                    </Link>
                  </div>
                  <p className="max-w-3xl text-[15px] leading-relaxed text-ink">{drill.prompt}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {drill.given.map((item) => (
                      <span key={item.label} className="rounded-sm border border-line bg-surface-1 px-2 py-1 text-[11.5px]">
                        <span className="text-muted">{item.label} </span>
                        <span className="num font-mono text-ink">{item.value}</span>
                      </span>
                    ))}
                  </div>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (result) next();
                      else submit();
                    }}
                  >
                    <input
                      ref={inputRef}
                      autoFocus
                      inputMode="decimal"
                      value={input}
                      disabled={Boolean(result)}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="Your answer"
                      className="h-10 w-48 rounded-sm border border-line-strong bg-surface-1 px-3 font-mono text-[15px] text-ink outline-none focus:border-brand/60 disabled:opacity-80"
                    />
                    {drill.unit ? <span className="font-mono text-[13px] text-muted">{drill.unit}</span> : null}
                    {!result ? (
                      <>
                        <Button type="submit" variant="primary" size="md" disabled={!input.trim()}>
                          Check
                        </Button>
                        <Button type="button" variant="ghost" size="md" icon={<Eye className="size-3.5" />} onClick={() => submit(true)}>
                          Show solution
                        </Button>
                      </>
                    ) : (
                      <Button type="submit" variant="primary" size="md" icon={<ArrowRight className="size-3.5" />}>
                        Next problem
                      </Button>
                    )}
                  </form>
                  {result ? (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('rounded-md border p-4', result.correct ? 'border-gain/30 bg-gain/[0.04]' : 'border-loss/30 bg-loss/[0.04]')}>
                      <div className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold">
                        {result.correct ? <Check className="size-4 text-gain" /> : <X className="size-4 text-loss" />}
                        <span className={result.correct ? 'text-gain' : 'text-loss'}>{result.correct ? 'Correct' : result.revealed ? 'Solution' : 'Not quite'}</span>
                        <span className="font-mono text-[13px] text-ink">
                          answer {drill.unit === '$' || drill.unit === '$M' ? '$' : ''}
                          {drill.answer.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                          {drill.unit === '$M' ? 'M' : drill.unit === '$' ? '' : drill.unit}
                        </span>
                        {result.correct && Number(byId.get(`drill:${type}`)?.data?.correct ?? 0) <= 25 ? <span className="ml-auto font-mono text-[11px] text-gain">+12 XP</span> : null}
                      </div>
                      <ol className="flex flex-col gap-1 pl-5 text-[13px] leading-relaxed text-ink-2 [list-style:decimal]">
                        {drill.steps.map((step) => (
                          <li key={step} className="font-mono text-[12.5px]">
                            {step}
                          </li>
                        ))}
                      </ol>
                      <div className="mt-2 text-[11px] text-faint">Press Enter for the next problem.</div>
                    </motion.div>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            )}
          </Panel>
          <p className="text-[11.5px] text-faint">Answers accept small rounding differences. Percentages are typed as numbers (12.5 for 12.5%). Each correct answer is worth 12 XP, up to 25 per drill type.</p>
        </div>
      </div>
    </Page>
  );
}

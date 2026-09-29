'use client';

import { ArrowRight, BookOpenCheck, Calculator, CheckCircle2, Circle, Clock, Library, MessagesSquare, Presentation } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { useLearn, type LearnState } from '@/components/learn/hooks';
import { ProgressBar } from '@/components/learn/progress-bar';
import { RankCard } from '@/components/learn/rank-card';
import { Page } from '@/components/shell/page';
import { Panel, Skeleton } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';
import { lessonsInTrack, SOURCES, TRACKS, type Lesson } from '@/lib/learn/curriculum';
import { DRILL_TYPES } from '@/lib/learn/drills';
import { CASES } from '@/lib/learn/examples';
import { caseMinutes, courseSummary, formatMinutes, lessonMinutesLeft, lessonProgress, levelSummary, PRACTICE_MINUTES, readingPace, resumeLesson, trackSummary } from '@/lib/learn/progress';
import { QUESTIONS } from '@/lib/learn/questions';
import { cn } from '@/lib/utils';

const LEVELS: Array<{ level: Lesson['level']; blurb: string }> = [
  { level: 'Core', blurb: 'What every analyst must know cold' },
  { level: 'Intermediate', blurb: 'The day-to-day toolkit' },
  { level: 'Advanced', blurb: 'Deals, tail risk and pitching' },
];

const caseTotal = CASES.reduce((sum, study) => sum + caseMinutes(study), 0);

const PRACTICE = [
  {
    href: '/learn/practice',
    icon: Calculator,
    title: 'Practice lab',
    body: `${DRILL_TYPES.length} kinds of randomized problems — WACC, paper LBOs, accretion, VaR — with worked solutions.`,
    time: `~${PRACTICE_MINUTES.drill} min a problem · 10 min sets`,
  },
  {
    href: '/learn/interview',
    icon: MessagesSquare,
    title: 'Interview prep',
    body: `${QUESTIONS.length} technical questions banks ask. Flashcards, or write your answer and have Grok grade it.`,
    time: `~${PRACTICE_MINUTES.card} min a card · ~${PRACTICE_MINUTES.written} min written`,
  },
  {
    href: '/learn/pitch',
    icon: Presentation,
    title: 'Pitch studio',
    body: 'Pitch any real company. Live structure score as you type, then a PM-style grade from Grok.',
    time: '45–90 min a pitch',
  },
  {
    href: '/learn/examples',
    icon: Library,
    title: 'Case library',
    body: `${CASES.length} famous theses — Buffett, Einhorn, Burry, Ackman — that worked and failed, in pitch format.`,
    time: `~${Math.round(caseTotal / CASES.length)} min a case · ${formatMinutes(caseTotal)} total`,
  },
];

export function LearnHub() {
  const { state, byId, isLoading, refresh } = useLearn();
  const reset = async () => {
    if (!window.confirm('Reset all Learn progress? This deletes your lesson scores, reading progress, drill history, flashcard ratings, saved pitches and graded answers.')) return;
    try {
      await refresh(await api<LearnState>('/api/learn', { method: 'DELETE' }), { revalidate: false });
      await revalidate('/api/learn/');
      toast.success('Learn progress reset');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const pace = useMemo(() => readingPace(byId), [byId]);
  const course = useMemo(() => courseSummary(byId, pace), [byId, pace]);
  const resume = useMemo(() => resumeLesson(byId), [byId]);
  const resumeItem = resume ? byId.get(`lesson:${resume.slug}`) : undefined;
  const resumeProgress = resume ? lessonProgress(resume, resumeItem) : 0;

  return (
    <Page
      kicker="Academy · valuation · risk · deals · pitching"
      title="Learn"
      description="Investing and investment banking from first principles to pitch-ready — every lesson runs on real companies and your own data, with quizzes, drills and graded practice."
    >
      {state ? <RankCard rank={state.rank} byId={byId} pace={pace} /> : isLoading ? <Skeleton className="h-[230px] w-full" /> : null}

      <Panel className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <div className="kicker mb-1">Course progress</div>
            <div className="flex items-baseline gap-3">
              <span className="num text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink">{Math.round(course.progress * 100)}%</span>
              <span className="text-[12.5px] text-muted">
                {course.done}/{course.lessons} lessons done{course.started ? ` · ${course.started} in progress` : ''}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5 text-[13px] font-medium text-ink">
              <Clock className="size-3.5 text-brand" />
              {course.minutesLeft > 0.5 ? `~${formatMinutes(course.minutesLeft)} left` : 'All lessons done'}
            </div>
            <div className="text-[11.5px] text-muted">
              {formatMinutes(course.totalMinutes)} of lessons{pace.calibrated ? ` · estimates at your pace (${pace.factor.toFixed(1)}× typical)` : ' · estimates adapt to your pace after two lessons'}
            </div>
          </div>
        </div>
        <ProgressBar value={course.progress} segments={course.lessons} className="mt-3 h-2" />
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {LEVELS.map(({ level, blurb }, index) => {
            const summary = levelSummary(level, byId, pace);
            return (
              <div key={level} className="rounded-sm border border-line bg-surface-1 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">{level}</span>
                  <span className="font-mono text-[11px] text-muted">
                    {summary.done}/{summary.lessons}
                  </span>
                </div>
                <div className="mb-2 text-[11.5px] text-muted">{blurb}</div>
                <ProgressBar value={summary.progress} segments={summary.lessons} delay={0.08 * index} />
                <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-faint">
                  <span>{formatMinutes(summary.totalMinutes)} total</span>
                  <span className={summary.minutesLeft > 0.5 ? 'text-ink-2' : 'text-gain'}>{summary.minutesLeft > 0.5 ? `~${formatMinutes(summary.minutesLeft)} left` : 'done'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {resume ? (
        <Link href={`/learn/${resume.slug}`} className="group">
          <Panel className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-line-strong">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-md border border-brand/30 bg-brand-wash">
                <BookOpenCheck className="size-5 text-brand" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="kicker mb-0.5">
                  {resumeProgress > 0 ? 'Pick up where you left off' : state?.rank.lessonsDone ? 'Up next' : 'Start here'} · {TRACKS.find((track) => track.id === resume.track)?.title}
                </div>
                <div className="truncate text-[15px] font-semibold text-ink">{resume.title}</div>
                <div className="mt-1 flex max-w-md items-center gap-3">
                  <ProgressBar value={resumeProgress} className="h-1 flex-1" />
                  <span className="shrink-0 font-mono text-[11px] text-muted">
                    {resumeProgress > 0 ? `${Math.round(resumeProgress * 100)}% · ~${formatMinutes(lessonMinutesLeft(resume, resumeItem, pace))} left` : `~${formatMinutes(resume.minutes * pace.factor)}`}
                  </span>
                </div>
              </div>
            </div>
            <ArrowRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-ink" />
          </Panel>
        </Link>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PRACTICE.map((item, index) => {
          const Icon = item.icon;
          return (
            <motion.div key={item.href} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * index }}>
              <Link href={item.href} className="group block h-full">
                <Panel className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-line-strong">
                  <div className="flex items-center justify-between">
                    <Icon className="size-4.5 text-brand" strokeWidth={1.8} />
                    <ArrowRight className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                  </div>
                  <div className="text-[14px] font-semibold text-ink">{item.title}</div>
                  <div className="flex-1 text-[12.5px] leading-snug text-muted">{item.body}</div>
                  <div className="flex items-center gap-1 font-mono text-[10.5px] text-faint">
                    <Clock className="size-3" />
                    {item.time}
                  </div>
                </Panel>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {TRACKS.map((track, trackIndex) => {
          const lessons = lessonsInTrack(track.id);
          const summary = trackSummary(track.id, byId, pace);
          return (
            <Panel key={track.id} className="flex flex-col">
              <div className="border-b border-line px-4 pt-3.5 pb-3">
                <div className="flex items-center justify-between">
                  <span className="kicker">Track {trackIndex + 1}</span>
                  <span className="font-mono text-[11px] text-muted">
                    {summary.done}/{summary.lessons} · {Math.round(summary.progress * 100)}%
                  </span>
                </div>
                <h2 className="mt-1 text-[15px] font-semibold text-ink">{track.title}</h2>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{track.description}</p>
                <ProgressBar value={summary.progress} segments={summary.lessons} className="mt-2.5" delay={0.06 * trackIndex} />
                <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-faint">
                  <span>{formatMinutes(summary.totalMinutes)} total</span>
                  <span className={summary.minutesLeft > 0.5 ? 'text-ink-2' : 'text-gain'}>{summary.minutesLeft > 0.5 ? `~${formatMinutes(summary.minutesLeft)} left` : 'complete'}</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col p-1.5">
                {lessons.map((lesson) => {
                  const item = byId.get(`lesson:${lesson.slug}`);
                  const complete = Boolean(item?.completed_at);
                  const value = lessonProgress(lesson, item);
                  return (
                    <Link key={lesson.slug} href={`/learn/${lesson.slug}`} className="group flex items-start gap-3 rounded-sm px-2.5 py-2 transition-colors hover:bg-white/[0.03]">
                      {complete ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gain" /> : value > 0 ? <PartialCircle value={value} /> : <Circle className="mt-0.5 size-4 shrink-0 text-faint" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('truncate text-[13px] font-medium', complete ? 'text-ink-2' : 'text-ink')}>{lesson.title}</span>
                          <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-faint">
                            {complete ? (
                              `${Math.round((item?.best ?? 0) * 100)}%`
                            ) : value > 0 ? (
                              <span className="text-ink-2">~{formatMinutes(lessonMinutesLeft(lesson, item, pace))} left</span>
                            ) : (
                              <>
                                <Clock className="size-3" />
                                {formatMinutes(lesson.minutes * pace.factor)}
                              </>
                            )}
                          </span>
                        </div>
                        <div className="line-clamp-1 text-[12px] text-muted">
                          <span className={cn('mr-1.5', lesson.level === 'Advanced' ? 'text-warning/80' : lesson.level === 'Intermediate' ? 'text-brand-soft' : 'text-ink-2')}>{lesson.level}</span>
                          {lesson.summary}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
              <div className="border-t border-line px-4 py-2 text-[11px] text-faint">Built from: {track.builtFrom}</div>
            </Panel>
          );
        })}
      </div>

      <Panel className="p-4">
        <div className="kicker mb-2">How this curriculum was designed</div>
        <p className="mb-3 max-w-3xl text-[12.5px] leading-relaxed text-muted">
          Topics and order follow what the standard programs teach analysts — bank training (accounting, valuation, an M&amp;A case), the modeling courses bankers take before starting, CFA Level I, top MBA valuation and investment courses — and what hedge funds and pitch competitions grade on. Every lesson ends by sending you to the part of SilverNote where you’d use it for real.
        </p>
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {SOURCES.map((source) => (
            <a key={source.name} href={source.url} target="_blank" rel="noreferrer noopener" className="group text-[12px] leading-snug">
              <span className="text-ink-2 group-hover:text-ink group-hover:underline">{source.name}</span>
              <span className="text-faint"> — {source.what}</span>
            </a>
          ))}
        </div>
      </Panel>
      {state && (state.rank.xp > 0 || course.started > 0) ? (
        <div className="flex justify-end">
          <button type="button" onClick={reset} className="text-[11.5px] text-faint underline-offset-2 hover:text-loss hover:underline">
            Reset Learn progress
          </button>
        </div>
      ) : null}
    </Page>
  );
}

/** A lesson started but not finished: a ring filled to its progress. */
function PartialCircle({ value }: { value: number }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 -rotate-90">
      <circle cx={8} cy={8} r={radius} fill="none" stroke="currentColor" strokeWidth={1.6} className="text-faint" />
      <motion.circle
        cx={8}
        cy={8}
        r={radius}
        fill="none"
        strokeWidth={1.6}
        strokeLinecap="round"
        className="stroke-brand"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: circumference * (1 - value) }}
        transition={{ type: 'spring', stiffness: 60, damping: 16 }}
      />
    </svg>
  );
}

'use client';

import { ArrowRight, BookOpenCheck, Calculator, CheckCircle2, Circle, Clock, Library, MessagesSquare, Presentation } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { toast } from 'sonner';

import { useLearn, type LearnState } from '@/components/learn/hooks';
import { RankCard } from '@/components/learn/rank-card';
import { Page } from '@/components/shell/page';
import { Panel, Skeleton } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';
import { LESSONS, lessonsInTrack, SOURCES, TRACKS } from '@/lib/learn/curriculum';
import { DRILL_TYPES } from '@/lib/learn/drills';
import { CASES } from '@/lib/learn/examples';
import { QUESTIONS } from '@/lib/learn/questions';
import { cn } from '@/lib/utils';

const PRACTICE = [
  { href: '/learn/practice', icon: Calculator, title: 'Practice lab', body: `${DRILL_TYPES.length} kinds of randomized problems — WACC, paper LBOs, accretion, VaR — with worked solutions.` },
  { href: '/learn/interview', icon: MessagesSquare, title: 'Interview prep', body: `${QUESTIONS.length} technical questions banks ask. Flashcards, or write your answer and have Grok grade it.` },
  { href: '/learn/pitch', icon: Presentation, title: 'Pitch studio', body: 'Pitch any real company. Live structure score as you type, then a PM-style grade from Grok.' },
  { href: '/learn/examples', icon: Library, title: 'Case library', body: `${CASES.length} famous theses — Buffett, Einhorn, Burry, Ackman — that worked and failed, in pitch format.` },
];

export function LearnHub() {
  const { state, byId, isLoading, refresh } = useLearn();
  const reset = async () => {
    if (!window.confirm('Reset all Learn progress? This deletes your lesson scores, drill history, flashcard ratings, saved pitches and graded answers.')) return;
    try {
      await refresh(await api<LearnState>('/api/learn', { method: 'DELETE' }), { revalidate: false });
      await revalidate('/api/learn/');
      toast.success('Learn progress reset');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const nextLesson = LESSONS.find((lesson) => !byId.get(`lesson:${lesson.slug}`)?.completed_at) ?? null;

  return (
    <Page
      kicker="Academy · valuation · risk · deals · pitching"
      title="Learn"
      description="Investing and investment banking from first principles to pitch-ready — every lesson runs on real companies and your own data, with quizzes, drills and graded practice."
    >
      {state ? <RankCard rank={state.rank} /> : isLoading ? <Skeleton className="h-[230px] w-full" /> : null}

      {nextLesson ? (
        <Link href={`/learn/${nextLesson.slug}`} className="group">
          <Panel className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-line-strong">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-md border border-brand/30 bg-brand-wash">
                <BookOpenCheck className="size-5 text-brand" />
              </div>
              <div className="min-w-0">
                <div className="kicker mb-0.5">{state?.rank.lessonsDone ? 'Continue' : 'Start here'} · {TRACKS.find((track) => track.id === nextLesson.track)?.title}</div>
                <div className="truncate text-[15px] font-semibold text-ink">{nextLesson.title}</div>
                <div className="truncate text-[12.5px] text-muted">{nextLesson.summary}</div>
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
                  <div className="text-[12.5px] leading-snug text-muted">{item.body}</div>
                </Panel>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {TRACKS.map((track, trackIndex) => {
          const lessons = lessonsInTrack(track.id);
          const done = lessons.filter((lesson) => byId.get(`lesson:${lesson.slug}`)?.completed_at).length;
          return (
            <Panel key={track.id} className="flex flex-col">
              <div className="border-b border-line px-4 pt-3.5 pb-3">
                <div className="flex items-center justify-between">
                  <span className="kicker">Track {trackIndex + 1}</span>
                  <span className="font-mono text-[11px] text-muted">
                    {done}/{lessons.length}
                  </span>
                </div>
                <h2 className="mt-1 text-[15px] font-semibold text-ink">{track.title}</h2>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{track.description}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-4">
                  <div className="h-full rounded-full bg-brand-soft transition-[width] duration-700" style={{ width: `${(done / lessons.length) * 100}%` }} />
                </div>
              </div>
              <div className="flex flex-1 flex-col p-1.5">
                {lessons.map((lesson) => {
                  const progress = byId.get(`lesson:${lesson.slug}`);
                  const complete = Boolean(progress?.completed_at);
                  return (
                    <Link key={lesson.slug} href={`/learn/${lesson.slug}`} className="group flex items-start gap-3 rounded-sm px-2.5 py-2 transition-colors hover:bg-white/[0.03]">
                      {complete ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gain" /> : <Circle className="mt-0.5 size-4 shrink-0 text-faint" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('truncate text-[13px] font-medium', complete ? 'text-ink-2' : 'text-ink')}>{lesson.title}</span>
                          <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-faint">
                            {complete ? `${Math.round((progress?.best ?? 0) * 100)}%` : <><Clock className="size-3" />{lesson.minutes}m</>}
                          </span>
                        </div>
                        <div className="line-clamp-1 text-[12px] text-muted">{lesson.summary}</div>
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
      {state && state.rank.xp > 0 ? (
        <div className="flex justify-end">
          <button type="button" onClick={reset} className="text-[11.5px] text-faint underline-offset-2 hover:text-loss hover:underline">
            Reset Learn progress
          </button>
        </div>
      ) : null}
    </Page>
  );
}

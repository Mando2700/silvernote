'use client';

import { ArrowLeft, ArrowRight, CheckCircle2, Clock, GraduationCap, Sparkles, Target } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { LessonSlugContext, sectionAnchor, TryItCards } from '@/components/learn/blocks';
import { useLearn } from '@/components/learn/hooks';
import { LESSON_BODIES } from '@/components/learn/lessons';
import { Quiz } from '@/components/learn/quiz';
import { RankBadge } from '@/components/learn/rank-card';
import { Page } from '@/components/shell/page';
import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { adjacentLessons, LESSON_BY_SLUG, TRACKS } from '@/lib/learn/curriculum';
import { cn } from '@/lib/utils';

/** Highlights the outline entry for the last section whose top has scrolled past the header. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0] ?? null;
      for (const id of ids) {
        const element = document.getElementById(id);
        // Hidden (kept-alive) pages have no layout; skip them.
        if (!element || !element.getClientRects().length) continue;
        if (element.getBoundingClientRect().top <= 140) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      window.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [ids]);
  return active;
}

export function LessonView({ slug }: { slug: string }) {
  const lesson = LESSON_BY_SLUG.get(slug)!;
  const track = TRACKS.find((item) => item.id === lesson.track)!;
  const Body = LESSON_BODIES[slug];
  const { state, byId, record } = useLearn();
  const { askAssistant } = useShell();
  const progress = byId.get(`lesson:${slug}`);
  const { previous, next } = adjacentLessons(slug);
  const outline = useMemo(
    () => [...lesson.sections, { id: 'try-it', title: 'Use it in SilverNote' }, { id: 'quiz', title: 'Check your understanding' }].map((section) => ({ ...section, anchor: sectionAnchor(slug, section.id) })),
    [lesson, slug],
  );
  const anchors = useMemo(() => outline.map((section) => section.anchor), [outline]);
  const active = useActiveSection(anchors);

  return (
    <Page
      kicker={`Learn · ${track.title}`}
      title={lesson.title}
      description={lesson.summary}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone="outline">
            <Clock className="size-3" />
            {lesson.minutes} min
          </Badge>
          <Badge tone="outline">{lesson.level}</Badge>
          {progress?.completed_at ? (
            <Badge tone="gain">
              <CheckCircle2 className="size-3" />
              Done · {Math.round((progress.best ?? 0) * 100)}%
            </Badge>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_236px]">
        <article className="flex min-w-0 flex-col gap-10">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-surface-1 px-4 py-3">
            <span className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <Target className="size-3.5 text-brand" />
              You’ll be able to
            </span>
            {lesson.objectives.map((objective) => (
              <span key={objective} className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <span className="size-1 rounded-full bg-brand-soft" />
                {objective}
              </span>
            ))}
          </div>

          <LessonSlugContext.Provider value={slug}>
            <Body />
          </LessonSlugContext.Provider>

          <section id={sectionAnchor(slug, 'try-it')} className="scroll-mt-20">
            <h2 className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-ink">Use it in SilverNote</h2>
            <TryItCards items={lesson.tryIt} />
          </section>

          <section id={sectionAnchor(slug, 'quiz')} className="scroll-mt-20">
            <div className="mb-3 flex items-center gap-2">
              <GraduationCap className="size-4 text-brand" />
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">Check your understanding</h2>
            </div>
            <Quiz key={slug} lesson={lesson} best={progress?.best ?? null} onSubmit={(score, answers) => record({ kind: 'lesson', slug, score, answers })} />
          </section>

          <nav className="grid gap-2 border-t border-line pt-5 sm:grid-cols-2">
            {previous ? (
              <Link href={`/learn/${previous.slug}`} className="group rounded-md border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-3">
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  <ArrowLeft className="size-3 transition-transform group-hover:-translate-x-0.5" /> Previous
                </span>
                <span className="text-[13px] font-medium text-ink">{previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/learn/${next.slug}`} className="group rounded-md border border-line px-4 py-3 text-right transition-colors hover:border-line-strong hover:bg-surface-3">
                <span className="flex items-center justify-end gap-1 text-[11px] text-muted">
                  Next <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-[13px] font-medium text-ink">{next.title}</span>
              </Link>
            ) : (
              <Link href="/learn/pitch" className="group rounded-md border border-brand/30 bg-brand-wash px-4 py-3 text-right transition-colors hover:border-brand/50">
                <span className="flex items-center justify-end gap-1 text-[11px] text-muted">
                  Put it all together <ArrowRight className="size-3" />
                </span>
                <span className="text-[13px] font-medium text-ink">Pitch studio</span>
              </Link>
            )}
          </nav>
        </article>

        <aside className="hidden xl:block">
          <div className="sticky top-20 flex flex-col gap-4">
            <div>
              <div className="kicker mb-2">In this lesson</div>
              <nav className="flex flex-col border-l border-line">
                {outline.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.anchor}`}
                    className={cn(
                      '-ml-px border-l py-1 pl-3 text-[12.5px] transition-colors',
                      active === section.anchor ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink-2',
                    )}
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<Sparkles className="size-3.5 text-brand" />}
              onClick={() =>
                askAssistant(
                  `I'm studying "${lesson.title}" (${lesson.summary}). Explain the single most important idea in it using a real company I could look up in SilverNote, then quiz me with three harder questions one at a time and grade my answers.`,
                )
              }
            >
              Tutor me with Grok
            </Button>
            {state ? <RankBadge rank={state.rank} /> : null}
            <Link href="/learn" className="flex items-center gap-1 text-[12px] text-muted hover:text-ink">
              <ArrowLeft className="size-3" /> All lessons
            </Link>
          </div>
        </aside>
      </div>
    </Page>
  );
}

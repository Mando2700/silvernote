'use client';

import { ArrowRight, Check, CircleDashed, Eye, RotateCcw, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { useLearn } from '@/components/learn/hooks';
import { Page } from '@/components/shell/page';
import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { Badge, Panel, Segmented, Textarea } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/client';
import { relativeTime } from '@/lib/format';
import { CATEGORIES, keyPointCoverage, QUESTIONS, type InterviewQuestion, type QuestionCategory } from '@/lib/learn/questions';
import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

type Grade = { score: number; verdict: string; covered: string[]; missed: string[]; errors: string[]; tip: string };
type Attempt = { id: string; score: number | null; created_at: string; content: { answer?: string } };

const RATING_ORDER = { missed: 0, undefined: 1, partial: 2, nailed: 3 } as Record<string, number>;

export function InterviewPrep() {
  const { state, byId, record } = useLearn();
  const loaded = state !== null;
  const [category, setCategory] = useState<QuestionCategory | 'all'>('all');
  const [mode, setMode] = useState<'cards' | 'written'>('cards');
  const [index, setIndex] = useState(0);

  // Weakest first: missed, then unseen, then partial, then nailed; stable within each group.
  const deck = useMemo(() => {
    const pool = QUESTIONS.filter((question) => category === 'all' || question.category === category);
    return [...pool].sort((a, b) => {
      const ra = RATING_ORDER[String(byId.get(`card:${a.id}`)?.data?.rating)] ?? 1;
      const rb = RATING_ORDER[String(byId.get(`card:${b.id}`)?.data?.rating)] ?? 1;
      return ra - rb || a.difficulty - b.difficulty;
    });
    // Re-sort when progress first arrives and when the category changes — not after every rating, so the deck doesn't jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, loaded]);
  const question = deck[Math.min(index, deck.length - 1)];
  const advance = () => setIndex((current) => (current + 1) % deck.length);

  return (
    <Page
      kicker="Learn · technical interview prep"
      title="Interview prep"
      description="The technical questions investment banks, PE funds and hedge funds actually ask — accounting, EV, valuation, M&A, LBOs and markets. Answer out loud or in writing, then check yourself against the model answer."
      actions={
        <Link href="/learn" className="text-[12.5px] text-muted hover:text-ink">
          ← All lessons
        </Link>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[{ id: 'all' as const, label: 'All' }, ...CATEGORIES].map((item) => {
            const pool = QUESTIONS.filter((q) => item.id === 'all' || q.category === item.id);
            const nailed = pool.filter((q) => byId.get(`card:${q.id}`)?.data?.rating === 'nailed').length;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setCategory(item.id);
                  setIndex(0);
                }}
                className={cn('flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-[12px] transition-colors', category === item.id ? 'border-brand/50 bg-brand-wash text-ink' : 'border-line text-muted hover:border-line-strong hover:text-ink-2')}
              >
                {item.label}
                <span className="font-mono text-[10.5px] text-faint">
                  {nailed}/{pool.length}
                </span>
              </button>
            );
          })}
        </div>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'cards', label: 'Flashcards' }, { value: 'written', label: 'Written · graded by Grok' }]} />
      </div>

      {question ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <AnimatePresence mode="wait">
            <motion.div key={`${question.id}-${mode}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {mode === 'cards' ? (
                <Flashcard question={question} onRate={async (rating) => { await record({ kind: 'card', id: question.id, rating }, { quiet: true }); advance(); }} onSkip={advance} />
              ) : (
                <WrittenAnswer question={question} onNext={advance} />
              )}
            </motion.div>
          </AnimatePresence>
          <Panel className="flex max-h-[640px] flex-col overflow-hidden">
            <div className="border-b border-line px-4 py-2.5 text-[12px] text-muted">
              Deck · {index + 1} of {deck.length} · weakest first
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {deck.map((item, itemIndex) => {
                const rating = byId.get(`card:${item.id}`)?.data?.rating as string | undefined;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setIndex(itemIndex)}
                    className={cn('flex w-full items-start gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12px] transition-colors', itemIndex === index ? 'bg-white/[0.06] text-ink' : 'text-ink-2 hover:bg-white/[0.03]')}
                  >
                    {rating === 'nailed' ? <Check className="mt-0.5 size-3.5 shrink-0 text-gain" /> : rating === 'partial' ? <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-warning" /> : rating === 'missed' ? <X className="mt-0.5 size-3.5 shrink-0 text-loss" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-faint" />}
                    <span className="line-clamp-2">{item.question}</span>
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>
      ) : null}
    </Page>
  );
}

/** Before the answer is shown Grok gives a hint only; afterwards it runs a mock-interview follow-up on the question. */
function QuestionHeader({ question, answered, answer }: { question: InterviewQuestion; answered: boolean; answer?: string }) {
  const { askAssistant } = useShell();
  const ask = () =>
    askAssistant(
      answered
        ? `Interview question (${CATEGORIES.find((item) => item.id === question.category)?.label}): "${question.question}"\n\n${answer?.trim() ? `My answer:\n${answer.trim()}\n\n` : ''}Key points a strong answer covers: ${question.keyPoints.join('; ')}.\n\nAct as the interviewer: explain the concept behind this question with a real-company example, point out what ${answer?.trim() ? 'my answer' : 'candidates'} usually miss, then ask me the two follow-up questions an interviewer would ask next, one at a time.`
        : `Interview question (${CATEGORIES.find((item) => item.id === question.category)?.label}): "${question.question}"\n\nGive me a hint on how to structure my answer — the framework or first concept to start from — without giving me the answer itself.`,
    );
  return (
    <div className="mb-4 flex items-center gap-2">
      <Badge tone="brand">{CATEGORIES.find((item) => item.id === question.category)?.label}</Badge>
      <Badge tone="outline">{['', 'Core', 'Intermediate', 'Advanced'][question.difficulty]}</Badge>
      <button
        type="button"
        onClick={ask}
        title={answered ? 'Have Grok explain it and run the follow-ups' : 'Get a hint from Grok — it won’t give the answer away'}
        className="ml-auto flex h-6 items-center gap-1 rounded-sm border border-line px-2 text-[11px] text-muted transition-colors hover:border-brand/40 hover:bg-brand-wash hover:text-ink"
      >
        <Sparkles className="size-3 text-brand" />
        {answered ? 'Explain with Grok' : 'Hint from Grok'}
      </button>
    </div>
  );
}

function ModelAnswer({ question, highlight }: { question: InterviewQuestion; highlight?: boolean[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div>
        <div className="kicker mb-1.5">Model answer</div>
        <div className="prose-rn text-[13.5px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(question.answer) }} />
      </div>
      <div>
        <div className="kicker mb-1.5">Key points</div>
        <ul className="flex flex-col gap-1.5">
          {question.keyPoints.map((point, pointIndex) => (
            <li key={point} className="flex items-start gap-2 text-[12.5px] text-ink-2">
              {highlight ? highlight[pointIndex] ? <Check className="mt-0.5 size-3.5 shrink-0 text-gain" /> : <X className="mt-0.5 size-3.5 shrink-0 text-loss" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-soft" />}
              {point}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Flashcard({ question, onRate, onSkip }: { question: InterviewQuestion; onRate: (rating: 'nailed' | 'partial' | 'missed') => Promise<void>; onSkip: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const rate = async (rating: 'nailed' | 'partial' | 'missed') => {
    setSaving(true);
    await onRate(rating).finally(() => setSaving(false));
  };
  return (
    <Panel className="p-5">
      <QuestionHeader question={question} answered={revealed} />
      <h2 className="text-[20px] leading-snug font-semibold tracking-[-0.015em] text-ink">{question.question}</h2>
      {!revealed ? (
        <div className="mt-6 flex flex-col items-start gap-3">
          <p className="text-[12.5px] text-muted">Answer out loud as if you were in the interview — aim for 60–90 seconds and a clear structure. Then reveal.</p>
          <div className="flex gap-2">
            <Button variant="primary" size="md" icon={<Eye className="size-3.5" />} onClick={() => setRevealed(true)}>
              Reveal answer
            </Button>
            <Button variant="ghost" size="md" onClick={onSkip}>
              Skip
            </Button>
          </div>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex flex-col gap-5">
          <ModelAnswer question={question} />
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="mr-1 text-[12.5px] text-muted">How did you do?</span>
            <Button variant="outline" disabled={saving} icon={<X className="size-3.5 text-loss" />} onClick={() => rate('missed')}>
              Missed it
            </Button>
            <Button variant="outline" disabled={saving} icon={<CircleDashed className="size-3.5 text-warning" />} onClick={() => rate('partial')}>
              Partly
            </Button>
            <Button variant="outline" disabled={saving} icon={<Check className="size-3.5 text-gain" />} onClick={() => rate('nailed')}>
              Nailed it
            </Button>
          </div>
        </motion.div>
      )}
    </Panel>
  );
}

function WrittenAnswer({ question, onNext }: { question: InterviewQuestion; onNext: () => void }) {
  const [answer, setAnswer] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [fallback, setFallback] = useState<{ reason: string; covered: boolean[]; score: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: history, mutate } = useSWR<{ attempts: Attempt[] }>(`/api/learn/answers?question=${question.id}`);
  const best = history?.attempts.reduce<number | null>((top, attempt) => (attempt.score !== null && (top === null || attempt.score > top) ? attempt.score : top), null) ?? null;

  const submit = async () => {
    setLoading(true);
    setGrade(null);
    setFallback(null);
    try {
      const result = await api<Grade>('/api/learn/answers', { body: { questionId: question.id, answer } });
      setGrade(result);
      void mutate();
    } catch (error) {
      const coverage = keyPointCoverage(answer, question.keyPoints);
      setFallback({ reason: error instanceof ApiError ? error.message : 'Grok is unavailable.', covered: coverage.covered, score: coverage.score });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel className="p-5">
      <QuestionHeader question={question} answered={Boolean(grade || fallback)} answer={answer} />
      <h2 className="text-[20px] leading-snug font-semibold tracking-[-0.015em] text-ink">{question.question}</h2>
      <div className="mt-4 flex flex-col gap-2">
        <Textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your answer the way you’d say it in the interview…" className="min-h-40 text-[13.5px]" disabled={loading} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="md" loading={loading} disabled={answer.trim().length < 20} icon={<Sparkles className="size-3.5" />} onClick={submit}>
            Grade my answer
          </Button>
          {grade || fallback ? (
            <>
              <Button
                variant="outline"
                size="md"
                icon={<RotateCcw className="size-3.5" />}
                onClick={() => {
                  setGrade(null);
                  setFallback(null);
                }}
              >
                Revise
              </Button>
              <Button
                variant="ghost"
                size="md"
                icon={<ArrowRight className="size-3.5" />}
                onClick={() => {
                  setAnswer('');
                  setGrade(null);
                  setFallback(null);
                  onNext();
                }}
              >
                Next question
              </Button>
            </>
          ) : null}
          <span className="ml-auto text-[11.5px] text-faint">
            {best !== null ? `Best ${best}/10 · ` : ''}
            {history?.attempts.length ? `${history.attempts.length} attempt${history.attempts.length === 1 ? '' : 's'}, last ${relativeTime(history.attempts[0].created_at)}` : 'First attempt'}
          </span>
        </div>
      </div>
      {grade ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex flex-col gap-4">
          <div className="flex items-center gap-4 rounded-md border border-line bg-surface-1 p-4">
            <div className={cn('font-mono text-[30px] font-semibold', grade.score >= 8 ? 'text-gain' : grade.score >= 6 ? 'text-brand-bright' : 'text-loss')}>
              {grade.score}
              <span className="text-[15px] text-muted">/10</span>
            </div>
            <div className="text-[13.5px] leading-relaxed text-ink">{grade.verdict}</div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { title: 'Covered', items: grade.covered, icon: <Check className="mt-0.5 size-3.5 shrink-0 text-gain" /> },
              { title: 'Missed', items: grade.missed, icon: <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-warning" /> },
              { title: 'Wrong', items: grade.errors, icon: <X className="mt-0.5 size-3.5 shrink-0 text-loss" /> },
            ].map((group) => (
              <div key={group.title}>
                <div className="kicker mb-1.5">{group.title}</div>
                {group.items.length ? (
                  <ul className="flex flex-col gap-1">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                        {group.icon}
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12px] text-faint">—</div>
                )}
              </div>
            ))}
          </div>
          {grade.tip ? <div className="rounded-md border border-ion/25 bg-ion/[0.04] px-4 py-2.5 text-[13px] text-ink"><strong>Next time:</strong> {grade.tip}</div> : null}
          <details className="rounded-md border border-line px-4 py-3">
            <summary className="cursor-pointer text-[12.5px] text-muted">Compare with the model answer</summary>
            <div className="mt-3">
              <ModelAnswer question={question} />
            </div>
          </details>
        </motion.div>
      ) : null}
      {fallback ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex flex-col gap-4">
          <div className="rounded-md border border-warning/25 bg-warning/[0.05] px-4 py-2.5 text-[12.5px] text-ink-2">
            Grok couldn’t grade this ({fallback.reason}). Here’s a key-point check instead: you covered about {Math.round(fallback.score * 100)}% of what a strong answer includes.
          </div>
          <ModelAnswer question={question} highlight={fallback.covered} />
        </motion.div>
      ) : null}
    </Panel>
  );
}

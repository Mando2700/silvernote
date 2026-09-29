'use client';

import { Check, RotateCcw, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { checkNumber, type Lesson } from '@/lib/learn/curriculum';
import { cn } from '@/lib/utils';

type Answers = Record<string, number | string>;

function isCorrect(question: Lesson['quiz'][number], answer: number | string | undefined) {
  if (answer === undefined || answer === '') return false;
  return question.kind === 'choice' ? answer === question.answer : checkNumber(String(answer), question.answer, question.tolerance);
}

/** End-of-lesson check: every question answered, then graded with explanations; the best score is kept. */
export function Quiz({ lesson, best, onSubmit }: { lesson: Lesson; best: number | null; onSubmit: (score: number, answers: Answers) => Promise<unknown> }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const total = lesson.quiz.length;
  const answered = lesson.quiz.filter((question) => answers[question.id] !== undefined && answers[question.id] !== '').length;
  const correct = lesson.quiz.filter((question) => isCorrect(question, answers[question.id])).length;

  const submit = async () => {
    setSubmitted(true);
    setSaving(true);
    await onSubmit(correct / total, answers).finally(() => setSaving(false));
  };

  return (
    <div className="flex flex-col gap-3">
      {lesson.quiz.map((question, index) => {
        const answer = answers[question.id];
        const right = submitted && isCorrect(question, answer);
        return (
          <div key={question.id} className={cn('rounded-md border p-4 transition-colors', !submitted ? 'border-line bg-surface-1' : right ? 'border-gain/30 bg-gain/[0.035]' : 'border-loss/30 bg-loss/[0.035]')}>
            <div className="mb-3 flex gap-3">
              <span className="font-mono text-[11px] text-faint">Q{index + 1}</span>
              <span className="text-[13.5px] leading-relaxed text-ink">{question.prompt}</span>
            </div>
            {question.kind === 'choice' ? (
              <div className="grid gap-1.5 pl-7 sm:grid-cols-2">
                {question.options.map((option, optionIndex) => {
                  const chosen = answer === optionIndex;
                  const isAnswer = submitted && optionIndex === question.answer;
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={submitted}
                      onClick={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                      className={cn(
                        'flex items-center gap-2 rounded-sm border px-3 py-2 text-left text-[12.5px] transition-colors disabled:cursor-default',
                        isAnswer ? 'border-gain/50 bg-gain/10 text-ink' : chosen && submitted ? 'border-loss/50 bg-loss/10 text-ink' : chosen ? 'border-brand/60 bg-brand-wash text-ink' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                      )}
                    >
                      <span className={cn('grid size-4 shrink-0 place-items-center rounded-full border', chosen ? 'border-brand bg-brand/20' : 'border-line-strong')}>
                        {isAnswer ? <Check className="size-2.5 text-gain" /> : chosen && submitted ? <X className="size-2.5 text-loss" /> : chosen ? <span className="size-1.5 rounded-full bg-brand" /> : null}
                      </span>
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2 pl-7">
                <input
                  inputMode="decimal"
                  disabled={submitted}
                  value={String(answer ?? '')}
                  onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  placeholder="Your answer"
                  className="h-8 w-40 rounded-sm border border-line-strong bg-surface-1 px-2.5 font-mono text-[13px] text-ink outline-none focus:border-brand/60 disabled:opacity-80"
                />
                {question.unit ? <span className="font-mono text-[12px] text-muted">{question.unit}</span> : null}
                {submitted ? (
                  <span className={cn('ml-2 font-mono text-[12px]', right ? 'text-gain' : 'text-loss')}>
                    {right ? '✓' : '✗'} {question.answer.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    {question.unit ?? ''}
                  </span>
                ) : null}
              </div>
            )}
            {submitted ? (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 ml-7 border-l-2 border-line-strong pl-3 text-[12.5px] leading-relaxed text-ink-2">
                {question.explain}
              </motion.div>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-1 px-4 py-3">
        {submitted ? (
          <div className="flex items-center gap-3">
            <span className={cn('font-mono text-[20px] font-semibold', correct === total ? 'text-gain' : correct / total >= 0.6 ? 'text-brand-bright' : 'text-loss')}>
              {correct}/{total}
            </span>
            <span className="text-[12.5px] text-muted">
              {correct === total ? 'Perfect — lesson mastered.' : correct / total >= 0.6 ? 'Lesson complete. Retry for full marks.' : 'Lesson complete — review the explanations and retry.'}
              {best !== null ? ` Best so far: ${Math.round(Math.max(best, correct / total) * 100)}%.` : ''}
            </span>
          </div>
        ) : (
          <span className="text-[12.5px] text-muted">
            {answered}/{total} answered{best !== null ? ` · best score ${Math.round(best * 100)}%` : ''}
          </span>
        )}
        {submitted ? (
          <Button
            variant="outline"
            icon={<RotateCcw className="size-3.5" />}
            onClick={() => {
              setAnswers({});
              setSubmitted(false);
            }}
          >
            Retry
          </Button>
        ) : (
          <Button variant="primary" disabled={answered < total} loading={saving} onClick={submit}>
            Check answers & complete
          </Button>
        )}
      </div>
    </div>
  );
}

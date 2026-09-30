'use client';

import { Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';

import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { checkNumber, type Lesson } from '@/lib/learn/curriculum';
import { cn } from '@/lib/utils';

type Answers = Record<string, number | string>;

function isCorrect(question: Lesson['quiz'][number], answer: number | string | undefined) {
  if (answer === undefined || answer === '') return false;
  return question.kind === 'choice' ? answer === question.answer : checkNumber(String(answer), question.answer, question.tolerance);
}

function answerText(question: Lesson['quiz'][number], answer: number | string | undefined) {
  if (answer === undefined || answer === '') return 'no answer yet';
  return question.kind === 'choice' ? `"${question.options[Number(answer)]}"` : `${answer}${question.unit ?? ''}`;
}

function correctText(question: Lesson['quiz'][number]) {
  return question.kind === 'choice' ? `"${question.options[question.answer]}"` : `${question.answer.toLocaleString('en-US', { maximumFractionDigits: 4 })}${question.unit ?? ''}`;
}

function seededRandom(seed: string) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Authored quizzes list the correct option in a fixed slot, which makes it guessable. Shuffle each
 * choice question's options (seeded, so server and client agree; the seed changes on retry) and
 * remap the answer index so grading and prompts keep working on what is shown.
 */
function shuffleOptions(lesson: Lesson, round: number): Lesson {
  return {
    ...lesson,
    quiz: lesson.quiz.map((question) => {
      if (question.kind !== 'choice') return question;
      const random = seededRandom(`${question.id}:${round}`);
      const order = question.options.map((_, index) => index);
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      return { ...question, options: order.map((index) => question.options[index]), answer: order.indexOf(question.answer) };
    }),
  };
}

/** Grok prompt for one question: a hint that doesn't give the answer away while the test is open, a full walkthrough once graded. */
function grokPrompt(lesson: Lesson, question: Lesson['quiz'][number], answer: number | string | undefined, submitted: boolean) {
  const options = question.kind === 'choice' ? `\nOptions:\n${question.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n')}` : '';
  const header = `I'm taking the quiz for the lesson "${lesson.title}".\nQuestion: ${question.prompt}${options}`;
  if (!submitted) {
    return `${header}\n\nMy current answer: ${answerText(question, answer)}.\nGive me a hint that points me at the right concept or first step, like a tutor would. Do NOT tell me the answer, which option is correct, or whether my current answer is right.`;
  }
  const right = isCorrect(question, answer);
  return `${header}\n\nI answered ${answerText(question, answer)}; the correct answer is ${correctText(question)} (${right ? 'I got it right' : 'I got it wrong'}).\nThe lesson's explanation: ${question.explain}\n\nWalk me through it step by step${right ? ' and check my reasoning holds up in a harder variant' : ' and show exactly where my answer goes wrong'}, tie it to a real company if it helps, then give me one similar practice question to try.`;
}

/** End-of-lesson check: every question answered, then graded with explanations; the best score is kept. */
export function Quiz({ lesson: authored, best, onSubmit }: { lesson: Lesson; best: number | null; onSubmit: (score: number, answers: Answers) => Promise<unknown> }) {
  const [round, setRound] = useState(0);
  const lesson = useMemo(() => shuffleOptions(authored, round), [authored, round]);
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const { askAssistant } = useShell();
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
              <span className="flex-1 text-[13.5px] leading-relaxed text-ink">{question.prompt}</span>
              <button
                type="button"
                onClick={() => askAssistant(grokPrompt(lesson, question, answer, submitted))}
                title={submitted ? 'Have Grok walk you through this question' : 'Get a hint from Grok — it won’t give the answer away'}
                className="-mt-0.5 flex h-6 shrink-0 items-center gap-1 self-start rounded-sm border border-line px-2 text-[11px] text-muted transition-colors hover:border-brand/40 hover:bg-brand-wash hover:text-ink"
              >
                <Sparkles className="size-3 text-brand" />
                {submitted ? 'Explain with Grok' : 'Hint from Grok'}
              </button>
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
              setRound((current) => current + 1);
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

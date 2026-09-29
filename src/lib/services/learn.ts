import 'server-only';

import { z } from 'zod';

import { companyContext } from '@/lib/ai/context';
import { completeGrokJson, GrokError } from '@/lib/ai/grok';
import { HttpError } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { env } from '@/lib/env';
import { LESSON_BY_SLUG } from '@/lib/learn/curriculum';
import { MODEL_PITCH } from '@/lib/learn/examples';
import { DRILL_META, type DrillType } from '@/lib/learn/drills';
import { QUESTION_BY_ID } from '@/lib/learn/questions';
import { computeRank, type AttemptSummary, type ProgressItem } from '@/lib/learn/rank';
import { RUBRIC_WEIGHTS, scorePitch, type PitchDraft, type RubricResult } from '@/lib/learn/rubric';

type ProgressRow = Omit<ProgressItem, 'completed_at' | 'updated_at'> & { completed_at: Date | string | null; updated_at: Date | string };

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

export async function getProgress(userId: string): Promise<ProgressItem[]> {
  const rows = await q<ProgressRow>(
    'select item_id, kind, score, best, attempts, data, completed_at, updated_at from public.learn_progress where user_id = $1 order by updated_at desc',
    [userId],
  );
  return rows.map((row) => ({ ...row, data: row.data ?? {}, completed_at: iso(row.completed_at), updated_at: iso(row.updated_at) as string }));
}

async function attemptSummaries(userId: string): Promise<AttemptSummary[]> {
  const rows = await q<{ kind: 'pitch' | 'answer'; ref: string | null; score: number | null; graded: boolean; created_at: Date | string }>(
    'select kind, ref, score, grade is not null as graded, created_at from public.learn_attempts where user_id = $1',
    [userId],
  );
  return rows.map((row) => ({ ...row, created_at: iso(row.created_at) as string }));
}

export async function getLearnState(userId: string) {
  const [progress, attempts] = await Promise.all([getProgress(userId), attemptSummaries(userId)]);
  return { progress, rank: computeRank(progress, attempts) };
}

/** Start over: removes every lesson, drill and flashcard record and every saved pitch and graded answer. */
export async function resetLearn(userId: string) {
  await q('delete from public.learn_progress where user_id = $1', [userId]);
  await q('delete from public.learn_attempts where user_id = $1', [userId]);
  return getLearnState(userId);
}

async function upsertProgress(userId: string, itemId: string, kind: ProgressItem['kind'], patch: { score: number | null; completed: boolean; data: Record<string, unknown> }) {
  await q(
    `insert into public.learn_progress (user_id, item_id, kind, score, best, attempts, data, completed_at, updated_at)
     values ($1, $2, $3, $4, $4, 1, $5::jsonb, case when $6 then now() else null end, now())
     on conflict (user_id, item_id) do update set
       score = excluded.score,
       best = greatest(coalesce(public.learn_progress.best, 0), coalesce(excluded.score, 0)),
       attempts = public.learn_progress.attempts + 1,
       data = public.learn_progress.data || excluded.data,
       completed_at = coalesce(public.learn_progress.completed_at, excluded.completed_at),
       updated_at = now()`,
    [userId, itemId, kind, patch.score, JSON.stringify(patch.data), patch.completed],
  );
}

export const progressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lesson'), slug: z.string().max(60), score: z.number().min(0).max(1), answers: z.record(z.string(), z.union([z.number(), z.string()])).optional() }),
  z.object({ kind: z.literal('drill'), type: z.string().max(30), correct: z.boolean() }),
  z.object({ kind: z.literal('card'), id: z.string().max(60), rating: z.enum(['nailed', 'partial', 'missed']) }),
  z.object({ kind: z.literal('read'), slug: z.string().max(60), sections: z.array(z.string().max(60)).max(40), seconds: z.number().min(0).max(3600) }),
]);

/** Reading progress: merges the sections read and adds active reading time, without touching the quiz score. */
async function recordRead(userId: string, slug: string, sections: string[], seconds: number) {
  const lesson = LESSON_BY_SLUG.get(slug);
  if (!lesson) throw new HttpError(404, 'Unknown lesson.');
  const valid = new Set(lesson.sections.map((section) => section.id));
  const itemId = `lesson:${slug}`;
  const existing = await q1<{ data: { read?: string[]; seconds?: number } }>('select data from public.learn_progress where user_id = $1 and item_id = $2', [userId, itemId]);
  const read = [...new Set([...(existing?.data?.read ?? []), ...sections.filter((id) => valid.has(id))])];
  const total = Math.round((existing?.data?.seconds ?? 0) + seconds);
  await q(
    `insert into public.learn_progress (user_id, item_id, kind, score, best, attempts, data, completed_at, updated_at)
     values ($1, $2, 'lesson', null, null, 0, $3::jsonb, null, now())
     on conflict (user_id, item_id) do update set data = public.learn_progress.data || excluded.data, updated_at = now()`,
    [userId, itemId, JSON.stringify({ read, seconds: total })],
  );
}

export async function recordProgress(userId: string, input: z.infer<typeof progressSchema>) {
  if (input.kind === 'read') {
    await recordRead(userId, input.slug, input.sections, input.seconds);
  } else if (input.kind === 'lesson') {
    if (!LESSON_BY_SLUG.has(input.slug)) throw new HttpError(404, 'Unknown lesson.');
    await upsertProgress(userId, `lesson:${input.slug}`, 'lesson', { score: input.score, completed: true, data: { answers: input.answers ?? {} } });
  } else if (input.kind === 'drill') {
    if (!DRILL_META.has(input.type as DrillType)) throw new HttpError(404, 'Unknown drill.');
    const itemId = `drill:${input.type}`;
    const existing = await q1<{ data: { correct?: number; total?: number; streak?: number; bestStreak?: number } }>('select data from public.learn_progress where user_id = $1 and item_id = $2', [userId, itemId]);
    const correct = (existing?.data?.correct ?? 0) + (input.correct ? 1 : 0);
    const total = (existing?.data?.total ?? 0) + 1;
    const streak = input.correct ? (existing?.data?.streak ?? 0) + 1 : 0;
    const bestStreak = Math.max(existing?.data?.bestStreak ?? 0, streak);
    await upsertProgress(userId, itemId, 'drill', { score: correct / total, completed: correct > 0, data: { correct, total, streak, bestStreak } });
  } else {
    if (!QUESTION_BY_ID.has(input.id)) throw new HttpError(404, 'Unknown question.');
    const itemId = `card:${input.id}`;
    const existing = await q1<{ data: { history?: string[] } }>('select data from public.learn_progress where user_id = $1 and item_id = $2', [userId, itemId]);
    const history = [...(existing?.data?.history ?? []), input.rating].slice(-10);
    const value = input.rating === 'nailed' ? 1 : input.rating === 'partial' ? 0.5 : 0;
    await upsertProgress(userId, itemId, 'card', { score: value, completed: input.rating === 'nailed', data: { rating: input.rating, history } });
  }
  return getLearnState(userId);
}

// ─── Attempts ───────────────────────────────────────────────────────────────

export type AttemptRow = {
  id: string;
  kind: 'pitch' | 'answer';
  ref: string | null;
  title: string;
  content: Record<string, unknown>;
  rubric: RubricResult | null;
  grade: Record<string, unknown> | null;
  score: number | null;
  created_at: string;
};

export async function listAttempts(userId: string, kind: 'pitch' | 'answer', ref?: string | null) {
  const rows = await q<Omit<AttemptRow, 'created_at'> & { created_at: Date | string }>(
    `select id, kind, ref, title, content, rubric, grade, score, created_at from public.learn_attempts
     where user_id = $1 and kind = $2 and ($3::text is null or ref = $3) order by created_at desc limit 60`,
    [userId, kind, ref ?? null],
  );
  return rows.map((row) => ({ ...row, created_at: iso(row.created_at) as string }));
}

export async function deleteAttempt(userId: string, id: string) {
  const [row] = await q<{ id: string }>('delete from public.learn_attempts where id = $1 and user_id = $2 returning id', [id, userId]);
  if (!row) throw new HttpError(404, 'Attempt not found.');
}

export const pitchSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.\-]{1,16}$/),
  direction: z.enum(['long', 'short']),
  price: z.number().positive().nullable(),
  target: z.number().positive().nullable(),
  bull: z.number().positive().nullable(),
  bear: z.number().positive().nullable(),
  horizonMonths: z.number().int().min(1).max(60),
  summary: z.string().max(3000),
  variant: z.string().max(5000),
  thesis: z.string().max(8000),
  catalysts: z.string().max(5000),
  valuation: z.string().max(6000),
  risks: z.string().max(6000),
  disconfirming: z.string().max(4000),
});

const pitchGradeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overall', 'verdict', 'categories', 'strengths', 'gaps', 'pmQuestions', 'factCheck'],
  properties: {
    overall: { type: 'integer', description: '0–100 overall grade.' },
    verdict: { type: 'string', description: 'One sentence: would a PM take this idea to the next meeting, and why.' },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'score', 'feedback'],
        properties: {
          key: { type: 'string', enum: [...RUBRIC_WEIGHTS.map((item) => item.key), 'communication'] },
          score: { type: 'integer', description: '0–10.' },
          feedback: { type: 'string', description: 'Specific, actionable feedback in one or two sentences.' },
        },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    pmQuestions: { type: 'array', items: { type: 'string' }, description: 'The three hardest questions a PM would ask.' },
    factCheck: { type: 'array', items: { type: 'string' }, description: 'Claims that conflict with the DATA, or [] if none.' },
  },
} as const;

export type PitchGrade = {
  overall: number;
  verdict: string;
  categories: Array<{ key: string; score: number; feedback: string }>;
  strengths: string[];
  gaps: string[];
  pmQuestions: string[];
  factCheck: string[];
  model: string;
};

const GRADER_SYSTEM = `You are a demanding but fair portfolio manager at a long/short equity fund, grading a practice stock pitch written by an analyst in training. You grade the way hedge-fund interviewers and university pitch competitions do.

Grade each category 0–10:
- recommendation: clear long/short call, target price and horizon that are consistent with each other.
- variant: a specific, well-founded view that differs from consensus, with numbers. A consensus idea ("great company") scores ≤ 3.
- thesis: 2–4 pillars, each backed by evidence.
- catalysts: dated, hard catalysts inside the horizon that will close the gap.
- valuation: a named method with the math shown, and bull/base/bear values showing an asymmetric payoff.
- risks: company-specific risks, quantified, with mitigants.
- disconfirming: measurable kill criteria decided in advance.
- communication: concise, ordered, easy to follow in two minutes.

The overall grade (0–100) is your holistic judgment weighted toward idea quality (variant view, valuation, catalysts). 90+ is fund-ready, 75–89 strong, 60–74 promising but incomplete, below 60 not yet a pitch.
Check every figure the analyst cites against the DATA block about the company and list real conflicts in factCheck (empty if none). DATA is a partial snapshot: analysts cite facts from filings, calls and their own research that it won't contain. Treat those as plausible unless they are wildly implausible, and never lower a score just because DATA doesn't confirm a figure. Judge catalyst timing against today's date given in the pitch. Be concrete: quote their words when criticizing. Keep each feedback item short.`;

export async function gradePitch(userId: string, draft: PitchDraft, rubric: RubricResult): Promise<PitchGrade> {
  if (!env.xaiKey) throw new HttpError(400, 'Grok isn’t connected. Add XAI_API_KEY to .env.local and restart the server.');
  // The model pitch in the case library is on a fictional company: grade its reasoning, not its data.
  const data =
    draft.symbol === MODEL_PITCH.symbol
      ? `${MODEL_PITCH.company} is a fictional training case with no market data. Grade reasoning, structure and internal consistency only; leave factCheck empty unless the pitch contradicts itself.`
      : await companyContext(userId, draft.symbol, null, true).catch(() => `No data available for ${draft.symbol}.`);
  const settings = await q1<{ data: { aiModel?: string | null } }>('select data from public.user_settings where user_id = $1', [userId]);
  const model = settings?.data?.aiModel || env.xaiFastModel;
  const pitch = [
    `Today: ${new Date().toISOString().slice(0, 10)}. Company: ${draft.symbol}. Recommendation: ${draft.direction.toUpperCase()}. Price when written: ${draft.price ?? 'n/a'}. Target: ${draft.target ?? 'none'} over ${draft.horizonMonths} months. Bull: ${draft.bull ?? 'n/a'}. Bear: ${draft.bear ?? 'n/a'}.`,
    `## Summary\n${draft.summary || '(empty)'}`,
    `## Variant view\n${draft.variant || '(empty)'}`,
    `## Thesis\n${draft.thesis || '(empty)'}`,
    `## Catalysts\n${draft.catalysts || '(empty)'}`,
    `## Valuation\n${draft.valuation || '(empty)'}`,
    `## Risks & mitigants\n${draft.risks || '(empty)'}`,
    `## Kill criteria\n${draft.disconfirming || '(empty)'}`,
    `\nFor reference, an automated structure check scored it ${rubric.total}/100 (it checks form only).`,
  ].join('\n\n');
  let text: string;
  try {
    text = await completeGrokJson({
      system: `${GRADER_SYSTEM}\n\n<DATA>\n${data}\n</DATA>`,
      prompt: pitch,
      schemaName: 'pitch_grade',
      schema: pitchGradeSchema,
      model,
      maxTokens: 3500,
    });
  } catch (error) {
    if (error instanceof GrokError) throw new HttpError(error.status === 401 ? 400 : 502, error.status === 401 ? 'The xAI API rejected the key.' : `Grok couldn’t grade the pitch: ${error.message}`);
    throw error;
  }
  const parsed = JSON.parse(text) as Omit<PitchGrade, 'model'>;
  const clampInt = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  return {
    overall: clampInt(parsed.overall, 100),
    verdict: String(parsed.verdict ?? ''),
    categories: (parsed.categories ?? []).map((item) => ({ key: String(item.key), score: clampInt(item.score, 10), feedback: String(item.feedback ?? '') })),
    strengths: (parsed.strengths ?? []).map(String).slice(0, 6),
    gaps: (parsed.gaps ?? []).map(String).slice(0, 6),
    pmQuestions: (parsed.pmQuestions ?? []).map(String).slice(0, 5),
    factCheck: (parsed.factCheck ?? []).map(String).slice(0, 6),
    model,
  };
}

/** Scores the pitch, asks Grok for a grade when requested, and saves the attempt. */
export async function submitPitch(userId: string, draft: PitchDraft, options: { grade: boolean }) {
  const rubric = scorePitch(draft);
  const grade = options.grade ? await gradePitch(userId, draft, rubric) : null;
  const direction = draft.direction === 'long' ? 'Long' : 'Short';
  const [row] = await q<{ id: string }>(
    `insert into public.learn_attempts (user_id, kind, ref, title, content, rubric, grade, score)
     values ($1, 'pitch', $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) returning id`,
    [userId, draft.symbol, `${direction} ${draft.symbol}${draft.target ? ` → $${draft.target}` : ''}`, JSON.stringify(draft), JSON.stringify(rubric), grade ? JSON.stringify(grade) : null, grade ? grade.overall : rubric.total],
  );
  return { id: row.id, rubric, grade };
}

// ─── Written interview answers ──────────────────────────────────────────────

const answerGradeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'verdict', 'covered', 'missed', 'errors', 'tip'],
  properties: {
    score: { type: 'integer', description: '0–10.' },
    verdict: { type: 'string', description: 'One sentence an interviewer would say.' },
    covered: { type: 'array', items: { type: 'string' } },
    missed: { type: 'array', items: { type: 'string' } },
    errors: { type: 'array', items: { type: 'string' }, description: 'Factually or technically wrong statements, or [].' },
    tip: { type: 'string', description: 'The single most useful fix for next time.' },
  },
} as const;

export type AnswerGrade = { score: number; verdict: string; covered: string[]; missed: string[]; errors: string[]; tip: string; model: string };

export async function gradeAnswer(userId: string, questionId: string, answer: string) {
  const question = QUESTION_BY_ID.get(questionId);
  if (!question) throw new HttpError(404, 'Unknown question.');
  if (!env.xaiKey) throw new HttpError(400, 'Grok isn’t connected. Add XAI_API_KEY to .env.local and restart the server.');
  const model = env.xaiFastModel;
  let text: string;
  try {
    text = await completeGrokJson({
      system:
        'You are an investment-banking interviewer grading a candidate’s answer to a technical question. Grade 0–10 against the key points and technical accuracy: 9–10 is what you’d expect from a top candidate, 6–8 acceptable with gaps, below 6 would fail the round. Penalize wrong statements more than omissions. Be brief and specific.',
      prompt: `QUESTION: ${question.question}\n\nKEY POINTS A STRONG ANSWER COVERS:\n${question.keyPoints.map((point) => `- ${point}`).join('\n')}\n\nREFERENCE ANSWER:\n${question.answer}\n\nCANDIDATE’S ANSWER:\n${answer}`,
      schemaName: 'answer_grade',
      schema: answerGradeSchema,
      model,
      maxTokens: 1200,
      timeoutMs: 45_000,
    });
  } catch (error) {
    if (error instanceof GrokError) throw new HttpError(error.status === 401 ? 400 : 502, error.status === 401 ? 'The xAI API rejected the key.' : `Grok couldn’t grade the answer: ${error.message}`);
    throw error;
  }
  const parsed = JSON.parse(text) as Omit<AnswerGrade, 'model'>;
  const grade: AnswerGrade = {
    score: Math.max(0, Math.min(10, Math.round(Number(parsed.score) || 0))),
    verdict: String(parsed.verdict ?? ''),
    covered: (parsed.covered ?? []).map(String).slice(0, 8),
    missed: (parsed.missed ?? []).map(String).slice(0, 8),
    errors: (parsed.errors ?? []).map(String).slice(0, 5),
    tip: String(parsed.tip ?? ''),
    model,
  };
  await q(
    `insert into public.learn_attempts (user_id, kind, ref, title, content, grade, score) values ($1, 'answer', $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [userId, question.id, question.question.slice(0, 200), JSON.stringify({ answer }), JSON.stringify(grade), grade.score],
  );
  return grade;
}

import { describe, expect, it } from 'vitest';

import { checkNumber, LESSONS, TRACKS } from './curriculum';
import { DRILL_TYPES, generateDrill } from './drills';
import { MODEL_PITCH } from './examples';
import { courseSummary, formatMinutes, lessonProgress, rankEtas, readingPace } from './progress';
import { keyPointCoverage, QUESTIONS } from './questions';
import { computeRank, RANKS, type ProgressItem } from './rank';
import { isPitchEmpty, scorePitch, type PitchDraft } from './rubric';

describe('curriculum', () => {
  it('has unique slugs, known tracks and valid quizzes', () => {
    const slugs = new Set(LESSONS.map((lesson) => lesson.slug));
    expect(slugs.size).toBe(LESSONS.length);
    const quizIds = LESSONS.flatMap((lesson) => lesson.quiz.map((question) => question.id));
    expect(new Set(quizIds).size).toBe(quizIds.length);
    for (const lesson of LESSONS) {
      expect(TRACKS.some((track) => track.id === lesson.track)).toBe(true);
      expect(lesson.quiz.length).toBeGreaterThanOrEqual(4);
      for (const question of lesson.quiz) {
        if (question.kind === 'choice') expect(question.answer).toBeLessThan(question.options.length);
        else expect(question.tolerance).toBeGreaterThan(0);
      }
    }
  });

  it('parses typed numbers leniently', () => {
    expect(checkNumber('12.5%', 12.47, 0.25)).toBe(true);
    expect(checkNumber('$1,576.9', 1576.9, 2)).toBe(true);
    expect(checkNumber('3x', 3, 0.01)).toBe(true);
    expect(checkNumber('−7', -7, 0.05)).toBe(true);
    expect(checkNumber('15', 12.47, 0.25)).toBe(false);
    expect(checkNumber('', 0, 1)).toBe(false);
  });

  it('keeps quiz numeric answers consistent with the math they explain', () => {
    const answer = (id: string) => {
      const question = LESSONS.flatMap((lesson) => lesson.quiz).find((item) => item.id === id);
      return question?.kind === 'number' ? question.answer : NaN;
    };
    expect(answer('tvm-2')).toBeCloseTo(1000 / 1.08 ** 5, 1);
    expect(answer('tvm-5')).toBeCloseTo(((80 / 50) ** 0.25 - 1) * 100, 1);
    expect(answer('dcf-2')).toBeCloseTo((100 * 1.025) / 0.065, 0);
    expect(answer('div-1')).toBeCloseTo(Math.sqrt(0.02) * 100, 1);
    expect(answer('var-4')).toBeCloseTo(10_000 * Math.sqrt(10), -2);
  });
});

describe('drills', () => {
  it('generates every type deterministically with a checkable answer', () => {
    for (const { type } of DRILL_TYPES) {
      for (let seed = 1; seed < 40; seed += 1) {
        const a = generateDrill(type, seed);
        const b = generateDrill(type, seed);
        expect(a).toEqual(b);
        expect(Number.isFinite(a.answer)).toBe(true);
        expect(a.steps.length).toBeGreaterThan(0);
        expect(checkNumber(String(a.answer), a.answer, a.tolerance)).toBe(true);
      }
    }
  });

  it('solves the paper LBO the way the steps describe', () => {
    const drill = generateDrill('lbo', 11);
    const moic = Number(drill.steps.at(-2)?.match(/MOIC = ([\d.]+)×/)?.[1]);
    const years = Number(drill.given.find((item) => item.label === 'Hold')?.value.split(' ')[0]);
    expect((moic ** (1 / years) - 1) * 100).toBeCloseTo(drill.answer, 0);
  });

  it('prices a par bond at par', () => {
    for (let seed = 1; seed < 200; seed += 1) {
      const drill = generateDrill('bond', seed);
      const coupon = drill.given.find((item) => item.label === 'Coupon (annual)')?.value.split(' ')[0];
      const yieldValue = drill.given.find((item) => item.label === 'Yield')?.value;
      if (coupon === yieldValue) expect(drill.answer).toBeCloseTo(1000, 1);
    }
  });
});

describe('pitch rubric', () => {
  const empty: PitchDraft = { symbol: 'TEST', direction: 'long', price: 100, target: null, bull: null, bear: null, horizonMonths: 12, summary: '', variant: '', thesis: '', catalysts: '', valuation: '', risks: '', disconfirming: '' };

  it('scores an empty pitch near zero and flags what is missing', () => {
    const result = scorePitch(empty);
    expect(isPitchEmpty(empty)).toBe(true);
    expect(result.total).toBeLessThan(10);
    expect(result.items.find((item) => item.key === 'recommendation')?.notes.join(' ')).toMatch(/target/i);
  });

  it('scores the model pitch highly with asymmetric payoff', () => {
    const result = scorePitch(MODEL_PITCH);
    expect(result.total).toBeGreaterThanOrEqual(85);
    expect(result.skew).toBeCloseTo((72 - 42) / (42 - 35), 5);
    expect(result.upside).toBeCloseTo(58 / 42 - 1, 5);
  });

  it('catches a target that contradicts the direction', () => {
    const result = scorePitch({ ...MODEL_PITCH, direction: 'short' });
    expect(result.items.find((item) => item.key === 'recommendation')?.notes.join(' ')).toMatch(/contradicts/);
  });
});

describe('interview bank', () => {
  it('has unique ids and key points', () => {
    expect(new Set(QUESTIONS.map((question) => question.id)).size).toBe(QUESTIONS.length);
    for (const question of QUESTIONS) expect(question.keyPoints.length).toBeGreaterThanOrEqual(3);
  });

  it('measures key-point coverage', () => {
    const question = QUESTIONS.find((item) => item.id === 'ev-buyback')!;
    const good = keyPointCoverage('Equity value is down $100M because shares are retired, cash is down $100M, so EV is unchanged: the operating business is unaffected.', question.keyPoints);
    const bad = keyPointCoverage('The stock goes up.', question.keyPoints);
    expect(good.score).toBeGreaterThan(0.7);
    expect(bad.score).toBeLessThan(0.3);
  });
});

describe('rank', () => {
  const lesson = (slug: string, best: number): ProgressItem => ({ item_id: `lesson:${slug}`, kind: 'lesson', score: best, best, attempts: 1, data: {}, completed_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z' });

  it('starts as an intern', () => {
    const rank = computeRank([], []);
    expect(rank.xp).toBe(0);
    expect(rank.rank).toBe('Intern');
    expect(rank.next?.title).toBe(RANKS[1].title);
  });

  it('adds lesson, drill and pitch XP and climbs the ladder', () => {
    const progress: ProgressItem[] = [
      ...LESSONS.slice(0, 5).map((item) => lesson(item.slug, 1)),
      { item_id: 'drill:lbo', kind: 'drill', score: 1, best: 1, attempts: 30, data: { correct: 30, total: 30 }, completed_at: null, updated_at: '2026-09-29T00:00:00Z' },
    ];
    const rank = computeRank(progress, [{ kind: 'pitch', ref: 'MSFT', score: 80, graded: true, created_at: '2026-09-29T00:00:00Z' }]);
    // 5 lessons × 100 + 25 capped drills × 12 + 80 × 4 + 25 for a graded pitch.
    expect(rank.xp).toBe(500 + 300 + 320 + 25);
    expect(rank.rank).toBe('Analyst II');
    expect(rank.mastery.foundations).toBeGreaterThan(0);
    expect(rank.lessonsDone).toBe(5);
  });
});

describe('progress and estimates', () => {
  const item = (id: string, patch: Partial<ProgressItem>): ProgressItem => ({ item_id: id, kind: 'lesson', score: null, best: null, attempts: 0, data: {}, completed_at: null, updated_at: '2026-09-29T00:00:00Z', ...patch });

  it('counts sections read up to 85% and the quiz as the rest', () => {
    const lesson = LESSONS[0];
    const half = lesson.sections.slice(0, Math.ceil(lesson.sections.length / 2)).map((section) => section.id);
    expect(lessonProgress(lesson, undefined)).toBe(0);
    expect(lessonProgress(lesson, item(`lesson:${lesson.slug}`, { data: { read: [...half, 'bogus'] } }))).toBeCloseTo((0.85 * half.length) / lesson.sections.length);
    expect(lessonProgress(lesson, item(`lesson:${lesson.slug}`, { completed_at: '2026-09-29T00:00:00Z' }))).toBe(1);
  });

  it('calibrates pace only after two timed lessons', () => {
    const [a, b] = LESSONS;
    const one = new Map([[`lesson:${a.slug}`, item(`lesson:${a.slug}`, { completed_at: 'x', data: { seconds: a.minutes * 120 } })]]);
    expect(readingPace(one)).toEqual({ factor: 1, calibrated: false });
    const two = new Map([...one, [`lesson:${b.slug}`, item(`lesson:${b.slug}`, { completed_at: 'x', data: { seconds: b.minutes * 120 } })]]);
    expect(readingPace(two).factor).toBeCloseTo(2);
  });

  it('sums course time and plans every rank above Intern', () => {
    const empty = new Map<string, ProgressItem>();
    const pace = readingPace(empty);
    const course = courseSummary(empty, pace);
    expect(course.minutesLeft).toBe(LESSONS.reduce((sum, lesson) => sum + lesson.minutes, 0));
    const etas = rankEtas(computeRank([], []), empty, pace);
    expect(etas.map((eta) => eta.title)).toEqual(RANKS.slice(1).map((rank) => rank.title));
    expect(etas.every((eta, index) => index === 0 || eta.minutes > etas[index - 1].minutes)).toBe(true);
    expect(etas[0].lessons).toBe(Math.ceil(400 / 92));
  });

  it('formats minutes', () => {
    expect(formatMinutes(0.4)).toBe('<1 min');
    expect(formatMinutes(12.4)).toBe('12 min');
    expect(formatMinutes(125)).toBe('2 h 5 min');
    expect(formatMinutes(240)).toBe('4 h');
  });
});

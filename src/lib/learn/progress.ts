/**
 * Progress and time estimates: how far through each lesson you are (sections actually read, then
 * the quiz), how long is left in a lesson, track, difficulty level or the whole course, and roughly
 * how long until the next analyst rank — all scaled to your own reading pace once there is enough
 * history to measure it.
 */

import type { CaseStudy } from '@/lib/learn/examples';
import { LESSONS, type Lesson, type TrackId } from '@/lib/learn/curriculum';
import { DRILL_TYPES } from '@/lib/learn/drills';
import { QUESTIONS } from '@/lib/learn/questions';
import { drillCorrect, RANKS, type ProgressItem, type RankSummary } from '@/lib/learn/rank';

/** Reading the sections is most of a lesson; the quiz is the last stretch. */
const READ_SHARE = 0.85;

/** Typical minutes per unit of practice, used for the practice estimates and the rank plan. */
export const PRACTICE_MINUTES = { drill: 1.5, card: 1, written: 5, pitch: 60 } as const;

export type ById = Map<string, ProgressItem>;

export function readSections(item: ProgressItem | undefined): string[] {
  const read = item?.data?.read;
  return Array.isArray(read) ? read.filter((id): id is string => typeof id === 'string') : [];
}

export function lessonSeconds(item: ProgressItem | undefined) {
  return Math.max(0, Number(item?.data?.seconds ?? 0) || 0);
}

/** 0–1: the share of sections read (up to 85%), and 100% once the quiz is done. */
export function lessonProgress(lesson: Lesson, item: ProgressItem | undefined) {
  if (item?.completed_at) return 1;
  const ids = new Set(lesson.sections.map((section) => section.id));
  const read = readSections(item).filter((id) => ids.has(id)).length;
  return ids.size ? (READ_SHARE * read) / ids.size : 0;
}

export type Pace = { factor: number; calibrated: boolean };

/**
 * How your actual time compares with the estimates, from finished lessons with measured reading
 * time. Needs two such lessons before it moves off 1×, and is clamped to 0.5–2×.
 */
export function readingPace(byId: ById): Pace {
  let actual = 0;
  let expected = 0;
  let count = 0;
  for (const lesson of LESSONS) {
    const item = byId.get(`lesson:${lesson.slug}`);
    const seconds = lessonSeconds(item);
    if (!item?.completed_at || seconds < 60) continue;
    actual += seconds;
    expected += lesson.minutes * 60;
    count += 1;
  }
  if (count < 2 || !expected) return { factor: 1, calibrated: false };
  return { factor: Math.min(2, Math.max(0.5, actual / expected)), calibrated: true };
}

export function lessonMinutesLeft(lesson: Lesson, item: ProgressItem | undefined, pace: Pace) {
  return lesson.minutes * (1 - lessonProgress(lesson, item)) * pace.factor;
}

export type Summary = { lessons: number; done: number; started: number; progress: number; totalMinutes: number; minutesLeft: number };

export function summarize(lessons: Lesson[], byId: ById, pace: Pace): Summary {
  let progress = 0;
  let minutesLeft = 0;
  let done = 0;
  let started = 0;
  for (const lesson of lessons) {
    const item = byId.get(`lesson:${lesson.slug}`);
    const value = lessonProgress(lesson, item);
    progress += value;
    minutesLeft += lessonMinutesLeft(lesson, item, pace);
    if (item?.completed_at) done += 1;
    else if (value > 0) started += 1;
  }
  return {
    lessons: lessons.length,
    done,
    started,
    progress: lessons.length ? progress / lessons.length : 0,
    totalMinutes: lessons.reduce((sum, lesson) => sum + lesson.minutes, 0) * pace.factor,
    minutesLeft,
  };
}

export const trackSummary = (track: TrackId, byId: ById, pace: Pace) => summarize(LESSONS.filter((lesson) => lesson.track === track), byId, pace);
export const levelSummary = (level: Lesson['level'], byId: ById, pace: Pace) => summarize(LESSONS.filter((lesson) => lesson.level === level), byId, pace);
export const courseSummary = (byId: ById, pace: Pace) => summarize(LESSONS, byId, pace);

/** The lesson to resume: the most recently touched unfinished one, else the first not yet done. */
export function resumeLesson(byId: ById) {
  const inProgress = LESSONS.map((lesson) => ({ lesson, item: byId.get(`lesson:${lesson.slug}`) }))
    .filter(({ lesson, item }) => !item?.completed_at && lessonProgress(lesson, item) > 0)
    .sort((a, b) => (b.item?.updated_at ?? '').localeCompare(a.item?.updated_at ?? ''));
  return inProgress[0]?.lesson ?? LESSONS.find((lesson) => !byId.get(`lesson:${lesson.slug}`)?.completed_at) ?? null;
}

export type RankEta = { title: string; xp: number; minutes: number; lessons: number; drills: number; cards: number; pitches: number };

/**
 * A rough plan to each rank above yours: finish lessons in course order (assuming ~80% on the quiz),
 * then drills (~80% right), then flashcards, then graded pitches. Returns time and what it takes.
 */
export function rankEtas(rank: RankSummary, byId: ById, pace: Pace): RankEta[] {
  type Step = { kind: 'lessons' | 'drills' | 'cards' | 'pitches'; xp: number; minutes: number };
  const steps: Step[] = [];
  for (const lesson of LESSONS) {
    const item = byId.get(`lesson:${lesson.slug}`);
    if (item?.completed_at) continue;
    steps.push({ kind: 'lessons', xp: 60 + 40 * 0.8, minutes: lessonMinutesLeft(lesson, item, pace) });
  }
  for (const drill of DRILL_TYPES) {
    const remaining = Math.max(0, 25 - drillCorrect(byId.get(`drill:${drill.type}`)));
    for (let i = 0; i < remaining; i += 1) steps.push({ kind: 'drills', xp: 12, minutes: PRACTICE_MINUTES.drill / 0.8 });
  }
  for (const question of QUESTIONS) {
    if (byId.get(`card:${question.id}`)?.data?.rating === 'nailed') continue;
    steps.push({ kind: 'cards', xp: 8, minutes: PRACTICE_MINUTES.card });
  }
  const etas: RankEta[] = [];
  let xp = rank.xp;
  let minutes = 0;
  const counts = { lessons: 0, drills: 0, cards: 0, pitches: 0 };
  let index = 0;
  for (const target of RANKS) {
    if (target.xp <= rank.xp) continue;
    while (xp < target.xp) {
      // Once the finite work runs out, graded pitches (~70/100 on a new company) carry you the rest.
      const step = steps[index] ?? { kind: 'pitches' as const, xp: 25 + 70 * 4, minutes: PRACTICE_MINUTES.pitch };
      index += 1;
      xp += step.xp;
      minutes += step.minutes;
      counts[step.kind] += 1;
    }
    etas.push({ title: target.title, xp: target.xp, minutes, ...counts });
  }
  return etas;
}

/** "What it takes" for a rank ETA, e.g. "3 lessons + 12 drills". */
export function describeEta(eta: RankEta, previous?: RankEta) {
  const parts: string[] = [];
  const delta = (key: 'lessons' | 'drills' | 'cards' | 'pitches') => eta[key] - (previous?.[key] ?? 0);
  const add = (count: number, one: string, many: string) => count > 0 && parts.push(`${count} ${count === 1 ? one : many}`);
  add(delta('lessons'), 'lesson', 'lessons');
  add(delta('drills'), 'drill', 'drills');
  add(delta('cards'), 'flashcard', 'flashcards');
  add(delta('pitches'), 'graded pitch', 'graded pitches');
  return parts.join(' + ');
}

/** Minutes to read a case study at ~220 words a minute. */
export function caseMinutes(study: CaseStudy) {
  const text = Object.values(study)
    .flatMap((value) => (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : item.label)) : typeof value === 'string' ? [value] : []))
    .join(' ');
  return Math.max(2, Math.round(text.split(/\s+/).length / 220));
}

/** 7 → "7 min", 65 → "1 h 5 min", 0.4 → "<1 min". */
export function formatMinutes(minutes: number) {
  if (minutes <= 0) return '0 min';
  if (minutes < 1) return '<1 min';
  const rounded = minutes < 60 ? Math.round(minutes) : Math.round(minutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rounded} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

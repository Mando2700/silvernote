/**
 * Analyst rank: experience points from lessons, drills, flashcards, graded answers and pitches,
 * mapped onto the banking ladder, plus mastery per track.
 */

import { LESSONS, TRACKS, type TrackId } from '@/lib/learn/curriculum';
import { DRILL_TYPES } from '@/lib/learn/drills';

export type ProgressItem = {
  item_id: string;
  kind: 'lesson' | 'drill' | 'card';
  score: number | null;
  best: number | null;
  attempts: number;
  data: Record<string, unknown>;
  completed_at: string | null;
  updated_at: string;
};

export type AttemptSummary = { kind: 'pitch' | 'answer'; ref: string | null; score: number | null; graded: boolean; created_at: string };

export const RANKS = [
  { title: 'Intern', xp: 0 },
  { title: 'Analyst I', xp: 400 },
  { title: 'Analyst II', xp: 1000 },
  { title: 'Associate', xp: 2000 },
  { title: 'Vice President', xp: 3500 },
  { title: 'Director', xp: 5500 },
  { title: 'Managing Director', xp: 8000 },
] as const;

/** XP for one lesson: 60 for finishing it, up to 40 more for the best quiz score. */
export function lessonXp(item: ProgressItem | undefined) {
  if (!item?.completed_at) return 0;
  return 60 + Math.round(40 * Math.max(0, Math.min(1, item.best ?? 0)));
}

const DRILL_XP = 12;
const DRILL_CAP = 25;

export function drillCorrect(item: ProgressItem | undefined) {
  return Math.max(0, Number(item?.data?.correct ?? 0) || 0);
}

export function computeRank(progress: ProgressItem[], attempts: AttemptSummary[]) {
  const byId = new Map(progress.map((item) => [item.item_id, item]));
  const lessons = LESSONS.reduce((sum, lesson) => sum + lessonXp(byId.get(`lesson:${lesson.slug}`)), 0);
  const drills = DRILL_TYPES.reduce((sum, drill) => sum + DRILL_XP * Math.min(DRILL_CAP, drillCorrect(byId.get(`drill:${drill.type}`))), 0);
  const cards = progress
    .filter((item) => item.kind === 'card')
    .reduce((sum, item) => sum + (item.data?.rating === 'nailed' ? 8 : item.data?.rating === 'partial' ? 4 : 0), 0);

  // Graded written answers: best score per question (0–10) × 3.
  const bestAnswer = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.kind !== 'answer' || attempt.score === null || !attempt.ref) continue;
    bestAnswer.set(attempt.ref, Math.max(bestAnswer.get(attempt.ref) ?? 0, attempt.score));
  }
  const answers = [...bestAnswer.values()].reduce((sum, score) => sum + Math.round(score * 3), 0);

  // Pitches: best score per company (0–100) × 4, plus 25 per graded pitch (first ten).
  const bestPitch = new Map<string, number>();
  let graded = 0;
  for (const attempt of attempts) {
    if (attempt.kind !== 'pitch' || attempt.score === null) continue;
    const key = attempt.ref ?? 'unknown';
    bestPitch.set(key, Math.max(bestPitch.get(key) ?? 0, attempt.score));
    if (attempt.graded) graded += 1;
  }
  const pitches = [...bestPitch.values()].reduce((sum, score) => sum + Math.round(score * 4), 0) + 25 * Math.min(10, graded);

  const xp = lessons + drills + cards + answers + pitches;
  let index = 0;
  for (let i = 0; i < RANKS.length; i += 1) if (xp >= RANKS[i].xp) index = i;
  const current = RANKS[index];
  const next = RANKS[index + 1] ?? null;
  const progressToNext = next ? (xp - current.xp) / (next.xp - current.xp) : 1;

  const mastery = Object.fromEntries(
    TRACKS.map((track) => {
      const trackLessons = LESSONS.filter((lesson) => lesson.track === track.id);
      const lessonScore = trackLessons.length ? trackLessons.reduce((sum, lesson) => sum + lessonXp(byId.get(`lesson:${lesson.slug}`)) / 100, 0) / trackLessons.length : 0;
      const trackDrills = DRILL_TYPES.filter((drill) => drill.track === track.id);
      // Ten correct answers per drill type counts as fluent.
      const drillScore = trackDrills.length ? trackDrills.reduce((sum, drill) => sum + Math.min(1, drillCorrect(byId.get(`drill:${drill.type}`)) / 10), 0) / trackDrills.length : 0;
      return [track.id, Math.round((lessonScore * 0.7 + drillScore * 0.3) * 100)];
    }),
  ) as Record<TrackId, number>;

  return {
    xp,
    rank: current.title,
    rankIndex: index,
    next: next ? { title: next.title, xp: next.xp } : null,
    progressToNext,
    breakdown: { lessons, drills, cards, answers, pitches },
    mastery,
    lessonsDone: LESSONS.filter((lesson) => byId.get(`lesson:${lesson.slug}`)?.completed_at).length,
    drillsCorrect: DRILL_TYPES.reduce((sum, drill) => sum + drillCorrect(byId.get(`drill:${drill.type}`)), 0),
    cardsReviewed: progress.filter((item) => item.kind === 'card').length,
    bestPitch: bestPitch.size ? Math.max(...bestPitch.values()) : null,
  };
}

export type RankSummary = ReturnType<typeof computeRank>;

import { route } from '@/lib/api';
import { getLearnState, resetLearn } from '@/lib/services/learn';

export const dynamic = 'force-dynamic';

/** Progress on every lesson, drill and flashcard, plus the analyst rank derived from it. */
export const GET = route(async ({ user }) => getLearnState(user.id));

/** Reset all Learn progress, saved pitches and graded answers. */
export const DELETE = route(async ({ user }) => resetLearn(user.id));

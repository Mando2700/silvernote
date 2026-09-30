import { body, route } from '@/lib/api';
import { decisionSchema } from '@/lib/journal-schema';
import { createDecision, listDecisions } from '@/lib/services/journal';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => listDecisions(user.id));

export const POST = route(async ({ request, user }) => createDecision(user.id, await body(request, decisionSchema)));

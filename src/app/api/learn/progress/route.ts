import { body, route } from '@/lib/api';
import { progressSchema, recordProgress } from '@/lib/services/learn';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ request, user }) => recordProgress(user.id, await body(request, progressSchema)));

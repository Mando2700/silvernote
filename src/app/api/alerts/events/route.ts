import { route } from '@/lib/api';
import { listAlertEvents, markEventsRead } from '@/lib/services/alerts';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const events = await listAlertEvents(user.id, 60);
  return { events, unread: events.filter((event) => !event.read_at).length };
});

export const POST = route(async ({ user }) => {
  await markEventsRead(user.id);
  return { ok: true };
});

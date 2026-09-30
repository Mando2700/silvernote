import { route } from '@/lib/api';
import { env } from '@/lib/env';
import { notify, pushEnabled, telegramEnabled } from '@/lib/services/notify';

export const dynamic = 'force-dynamic';

/** Which channels are configured on the server (and the public VAPID key the browser subscribes with). */
export const GET = route(async () => ({ push: pushEnabled(), telegram: telegramEnabled(), vapidPublicKey: env.vapidPublicKey || null }));

/** Send a test notice over every enabled channel. */
export const POST = route(async ({ user }) => notify(user.id, { title: 'SilverNote', body: 'Notifications are working.', url: '/' }));

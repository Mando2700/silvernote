import { route } from '@/lib/api';
import { listModels } from '@/lib/ai/grok';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ configured: Boolean(env.xaiKey), default: env.xaiModel, models: await listModels().catch(() => []) }));

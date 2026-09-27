import type { Metadata } from 'next';

import { AssistantPage } from '@/components/assistant/assistant-page';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Grok' };

export default function Assistant() {
  return <AssistantPage configured={Boolean(env.xaiKey)} model={env.xaiModel} />;
}

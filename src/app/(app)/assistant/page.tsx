import type { Metadata } from 'next';

import { AssistantPage } from '@/components/assistant/assistant-page';
import { KeepAlive } from '@/components/shell/keep-alive';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Grok' };

export default function Assistant() {
  return (
    <KeepAlive>
      <AssistantPage configured={Boolean(env.xaiKey)} models={{ fast: env.xaiFastLiteModel, standard: env.xaiFastModel, thinking: env.xaiModel }} />
    </KeepAlive>
  );
}

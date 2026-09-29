import type { Metadata } from 'next';

import { LearnHub } from '@/components/learn/learn-hub';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Learn' };

export default function LearnPage() {
  return (
    <KeepAlive>
      <LearnHub />
    </KeepAlive>
  );
}

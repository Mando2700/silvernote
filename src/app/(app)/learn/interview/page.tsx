import type { Metadata } from 'next';

import { InterviewPrep } from '@/components/learn/interview';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Interview prep · Learn' };

export default function InterviewPage() {
  return (
    <KeepAlive>
      <InterviewPrep />
    </KeepAlive>
  );
}

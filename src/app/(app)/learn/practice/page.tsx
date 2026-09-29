import type { Metadata } from 'next';

import { PracticeLab } from '@/components/learn/practice';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Practice lab · Learn' };

export default function PracticePage() {
  return (
    <KeepAlive>
      <PracticeLab />
    </KeepAlive>
  );
}

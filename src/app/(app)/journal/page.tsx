import type { Metadata } from 'next';

import { Journal } from '@/components/journal/journal';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Decision journal' };

export default function JournalPage() {
  return (
    <KeepAlive>
      <Journal />
    </KeepAlive>
  );
}

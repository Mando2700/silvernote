import type { Metadata } from 'next';

import { Lab } from '@/components/lab/lab';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Research lab' };

export default function LabPage() {
  return (
    <KeepAlive>
      <Lab />
    </KeepAlive>
  );
}

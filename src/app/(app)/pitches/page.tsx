import type { Metadata } from 'next';

import { PitchList } from '@/components/pitch/pitch-list';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Pitches' };

export default function PitchesPage() {
  return (
    <KeepAlive>
      <PitchList />
    </KeepAlive>
  );
}

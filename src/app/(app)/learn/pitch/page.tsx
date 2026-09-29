import type { Metadata } from 'next';

import { PitchStudio } from '@/components/learn/pitch-studio';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Pitch studio · Learn' };

export default function PitchStudioPage() {
  return (
    <KeepAlive>
      <PitchStudio />
    </KeepAlive>
  );
}

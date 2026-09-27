import type { Metadata } from 'next';

import { PitchList } from '@/components/pitch/pitch-list';

export const metadata: Metadata = { title: 'Pitches' };

export default function PitchesPage() {
  return <PitchList />;
}

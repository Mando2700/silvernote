import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PitchBuilder } from '@/components/pitch/pitch-builder';

export const metadata: Metadata = { title: 'Pitch' };

export default async function PitchPage({ params }: PageProps<'/pitches/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <PitchBuilder id={id} />;
}

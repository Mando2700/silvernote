import type { Metadata } from 'next';

import { Notes } from '@/components/notes/notes';

export const metadata: Metadata = { title: 'Notes & theses' };

export default function NotesPage() {
  return <Notes />;
}

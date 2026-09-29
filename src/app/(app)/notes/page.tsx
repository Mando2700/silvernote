import type { Metadata } from 'next';

import { Notes } from '@/components/notes/notes';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Notes & theses' };

export default function NotesPage() {
  return (
    <KeepAlive>
      <Notes />
    </KeepAlive>
  );
}

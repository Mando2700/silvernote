import type { Metadata } from 'next';

import { CaseLibrary } from '@/components/learn/case-library';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Case library · Learn' };

export default function CaseLibraryPage() {
  return (
    <KeepAlive>
      <CaseLibrary />
    </KeepAlive>
  );
}

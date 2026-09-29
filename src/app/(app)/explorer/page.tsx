import type { Metadata } from 'next';

import { Explorer } from '@/components/explorer/explorer';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Explorer' };

export default function ExplorerPage() {
  return (
    <KeepAlive>
      <Explorer />
    </KeepAlive>
  );
}

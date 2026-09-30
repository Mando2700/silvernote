import type { Metadata } from 'next';

import { Macro } from '@/components/macro/macro';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Macro' };

export default function MacroPage() {
  return (
    <KeepAlive>
      <Macro />
    </KeepAlive>
  );
}

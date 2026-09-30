import type { Metadata } from 'next';

import { KeepAlive } from '@/components/shell/keep-alive';
import { Terminal } from '@/components/terminal/terminal';

export const metadata: Metadata = { title: 'Terminal' };

export default function TerminalPage() {
  return (
    <KeepAlive>
      <Terminal />
    </KeepAlive>
  );
}

import type { Metadata } from 'next';

import { Settings } from '@/components/settings/settings';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <KeepAlive>
      <Settings />
    </KeepAlive>
  );
}

import type { Metadata } from 'next';

import { Watchlists } from '@/components/watchlists/watchlists';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Watchlists' };

export default function WatchlistsPage() {
  return (
    <KeepAlive>
      <Watchlists />
    </KeepAlive>
  );
}

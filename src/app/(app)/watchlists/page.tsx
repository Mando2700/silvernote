import type { Metadata } from 'next';

import { Watchlists } from '@/components/watchlists/watchlists';

export const metadata: Metadata = { title: 'Watchlists' };

export default function WatchlistsPage() {
  return <Watchlists />;
}

import type { Metadata } from 'next';

import { News } from '@/components/news/news';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'News' };

export default function NewsPage() {
  return (
    <KeepAlive>
      <News />
    </KeepAlive>
  );
}

import type { Metadata } from 'next';

import { News } from '@/components/news/news';

export const metadata: Metadata = { title: 'News' };

export default function NewsPage() {
  return <News />;
}

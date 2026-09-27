import type { Metadata } from 'next';

import { Explorer } from '@/components/explorer/explorer';

export const metadata: Metadata = { title: 'Explorer' };

export default function ExplorerPage() {
  return <Explorer />;
}

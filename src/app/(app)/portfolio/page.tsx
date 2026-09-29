import type { Metadata } from 'next';

import { PortfolioView } from '@/components/portfolio/portfolio';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Portfolio' };

export default function PortfolioPage() {
  return (
    <KeepAlive>
      <PortfolioView />
    </KeepAlive>
  );
}

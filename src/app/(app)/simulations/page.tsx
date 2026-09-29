import type { Metadata } from 'next';

import { Simulations } from '@/components/simulations/simulations';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Simulations' };

export default function SimulationsPage() {
  return (
    <KeepAlive>
      <Simulations />
    </KeepAlive>
  );
}

import type { Metadata } from 'next';

import { Simulations } from '@/components/simulations/simulations';

export const metadata: Metadata = { title: 'Simulations' };

export default function SimulationsPage() {
  return <Simulations />;
}

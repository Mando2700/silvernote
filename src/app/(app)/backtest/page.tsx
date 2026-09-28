import type { Metadata } from 'next';

import { Backtest } from '@/components/backtest/backtest';

export const metadata: Metadata = { title: 'Backtest' };

export default function BacktestPage() {
  return <Backtest />;
}

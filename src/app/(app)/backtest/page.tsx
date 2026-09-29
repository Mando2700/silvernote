import type { Metadata } from 'next';

import { Backtest } from '@/components/backtest/backtest';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Backtest' };

export default function BacktestPage() {
  return (
    <KeepAlive>
      <Backtest />
    </KeepAlive>
  );
}

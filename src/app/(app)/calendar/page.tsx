import type { Metadata } from 'next';

import { Calendar } from '@/components/calendar/calendar';
import { KeepAlive } from '@/components/shell/keep-alive';

export const metadata: Metadata = { title: 'Calendar' };

export default function CalendarPage() {
  return (
    <KeepAlive>
      <Calendar />
    </KeepAlive>
  );
}

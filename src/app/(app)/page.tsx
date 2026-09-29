import { Dashboard } from '@/components/dashboard/dashboard';
import { KeepAlive } from '@/components/shell/keep-alive';

export default function DashboardPage() {
  return (
    <KeepAlive>
      <Dashboard />
    </KeepAlive>
  );
}

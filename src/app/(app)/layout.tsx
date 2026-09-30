import { redirect } from 'next/navigation';

import { AppShell } from '@/components/shell/app-shell';
import { getSessionUser } from '@/lib/auth';
import { q1 } from '@/lib/db';
import { startScheduler } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  startScheduler();
  const settings = await q1<{ data: { marketColors?: string; motion?: string; density?: string } }>('select data from public.user_settings where user_id = $1', [user.id]).catch(() => null);
  const market = settings?.data?.marketColors === 'blue-orange' ? 'blue-orange' : 'red-green';
  const motion = ['full', 'reduced'].includes(settings?.data?.motion ?? '') ? settings?.data?.motion : 'system';
  const density = settings?.data?.density === 'compact' ? 'compact' : 'comfortable';
  return (
    <>
      {/* Apply saved display preferences before first paint (the client provider keeps them in sync afterwards). */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.dataset.market=${JSON.stringify(market)};document.documentElement.dataset.motion=${JSON.stringify(motion)};document.documentElement.dataset.density=${JSON.stringify(density)};`,
        }}
      />
      <AppShell user={{ email: user.email, local: user.local }}>{children}</AppShell>
    </>
  );
}

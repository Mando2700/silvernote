import { Link2Off } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { LiveRefresh } from '@/components/portfolio/share/live-refresh';
import { ShareLockScreen } from '@/components/portfolio/share/lock-screen';
import { SharedPortfolio } from '@/components/portfolio/share/shared-view';
import { BrandMark, Wordmark } from '@/components/shell/brand';
import { Panel } from '@/components/ui/primitives';
import { getSessionUser } from '@/lib/auth';
import { shortDate } from '@/lib/format';
import { accessCookieName, hasAccess, shareStatus } from '@/lib/share/access';
import { getShareByToken, getShareView, recordView } from '@/lib/services/shares';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps<'/s/[token]'>): Promise<Metadata> {
  const { token } = await params;
  const share = await getShareByToken(token);
  // A protected or unavailable link says nothing about the portfolio behind it.
  const title = share && !share.passcode_hash && shareStatus(share) === 'ok' && share.title ? share.title : 'Shared portfolio';
  return { title, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

function Frame({ children, badge }: { children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BrandMark size={22} />
          <Wordmark />
        </div>
        {badge}
      </header>
      {children}
      <footer className="border-t border-line pt-4 text-center text-[11px] text-faint">Read-only view shared from SilverNote. For information only, not investment advice.</footer>
    </main>
  );
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <Frame>
      <Panel className="mx-auto mt-6 flex w-full max-w-sm flex-col items-center gap-3 p-8 text-center">
        <div className="grid size-10 place-items-center rounded-md border border-line-strong bg-surface-3 text-muted">
          <Link2Off className="size-4" />
        </div>
        <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
        <p className="text-[12.5px] text-muted">{body}</p>
      </Panel>
    </Frame>
  );
}

export default async function SharedPortfolioPage({ params }: PageProps<'/s/[token]'>) {
  const { token } = await params;
  const share = await getShareByToken(token);
  if (!share) notFound();

  const status = shareStatus(share);
  if (status === 'revoked') return <Unavailable title="This link was turned off" body="The person who shared it has stopped sharing this portfolio." />;
  if (status === 'expired') return <Unavailable title="This link has expired" body="Ask the person who shared it for a new link." />;

  const cookieStore = await cookies();
  if (!hasAccess(share, cookieStore.get(accessCookieName(share.id))?.value)) {
    return (
      <Frame>
        <ShareLockScreen token={share.token} />
      </Frame>
    );
  }

  const view = await getShareView(share);
  if (!view) return <Unavailable title="This portfolio is no longer available" body="It may have been deleted by its owner." />;

  // Looking at your own link does not count as a view.
  if (!(await getSessionUser().catch(() => null))) void recordView(share.id).catch(() => {});

  const live = share.mode === 'live';
  return (
    <Frame
      badge={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 text-[11px] text-ink-2">
          <span className={live ? 'size-1.5 rounded-full bg-ion shadow-[0_0_8px_var(--color-ion)]' : 'size-1.5 rounded-full bg-faint'} />
          {live ? 'Live · updates every minute' : `Snapshot · ${shortDate(view.asOf)}`}
        </span>
      }
    >
      <SharedPortfolio view={{ ...view, title: share.title || view.title }} message={share.message} logoSrc={(symbol) => `/api/share/${share.token}/logo/${encodeURIComponent(symbol)}`} />
      {live ? <LiveRefresh /> : null}
    </Frame>
  );
}

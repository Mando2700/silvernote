import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CompanyView } from '@/components/company/company-view';
import { Page } from '@/components/shell/page';
import { KeepAlive } from '@/components/shell/keep-alive';
import { ASSET_KIND_LABEL, getAsset } from '@/lib/data/assets';
import { q1 } from '@/lib/db';
import { getSecurity } from '@/lib/services/universe';

function parseSymbol(raw: string) {
  const symbol = decodeURIComponent(raw).trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,16}$/.test(symbol) ? symbol : null;
}

export async function generateMetadata({ params }: PageProps<'/company/[symbol]'>): Promise<Metadata> {
  const symbol = parseSymbol((await params).symbol);
  return { title: (symbol && getAsset(symbol)?.name) ?? symbol ?? 'Company' };
}

export default async function CompanyPage({ params }: PageProps<'/company/[symbol]'>) {
  const symbol = parseSymbol((await params).symbol);
  if (!symbol) notFound();
  // One indexed lookup so the header can render in the same commit as the navigation (shared-element morph).
  const [security, score] = await Promise.all([
    getSecurity(symbol),
    q1<{ overall: number; label: string }>('select overall, label from public.scores where symbol = $1', [symbol]),
  ]);
  const asset = getAsset(symbol);
  // The app shell keeps this view mounted (state and scroll intact) after you navigate away.
  return (
    <KeepAlive>
      <Page>
        <CompanyView
          initial={{
            symbol,
            name: asset?.name ?? security?.name ?? symbol,
            sector: asset ? ASSET_KIND_LABEL[asset.kind] : (security?.sector ?? null),
            industry: security?.industry ?? null,
            price: security?.price ?? null,
            changePct: security?.change_pct ?? null,
            score: score?.overall ?? null,
            scoreLabel: score?.label ?? null,
          }}
        />
      </Page>
    </KeepAlive>
  );
}

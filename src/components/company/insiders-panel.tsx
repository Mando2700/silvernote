'use client';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge, EmptyState, Panel, PanelHeader, Segmented, Skeleton, Stat } from '@/components/ui/primitives';
import { money, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type Trade = { accession: string; filedAt: string; owner: string; role: string; date: string; code: string; kind: 'buy' | 'sell' | 'other'; shares: number; price: number | null; value: number | null; ownedAfter: number | null };
type Insiders = { trades: Trade[]; summary: { days: number; buyers: number; sellers: number; boughtValue: number; soldValue: number; netValue: number } };
type RiskChanges = {
  added: string[];
  removed: string[];
  modified: Array<{ before: string; after: string }>;
  unchanged: number;
  previousCount: number;
  currentCount: number;
  current: { filedAt: string; url: string };
  previous: { filedAt: string; url: string };
};

const CODE_LABEL: Record<string, string> = { P: 'Buy', S: 'Sell', A: 'Award', M: 'Exercise', F: 'Tax withheld', G: 'Gift', D: 'To issuer', C: 'Conversion', X: 'Exercise' };

function Insiders({ symbol }: { symbol: string }) {
  const { data, isLoading } = useSWR<Insiders>(`/api/company/${symbol}/insiders`);
  const [filter, setFilter] = useState<'market' | 'all'>('market');
  const trades = (data?.trades ?? []).filter((row) => filter === 'all' || row.kind !== 'other');
  return (
    <Panel>
      <PanelHeader
        kicker="SEC Form 4"
        title="Insider transactions"
        actions={<Segmented size="xs" value={filter} onChange={setFilter} options={[{ value: 'market', label: 'Open market' }, { value: 'all', label: 'All' }]} />}
      />
      {isLoading && !data ? (
        <Skeleton className="mx-4 mb-4 h-60" />
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-4 px-4 pb-3">
            <Stat label={`Bought (${data.summary.days}d)`} value={<span className="text-gain">{money(data.summary.boughtValue, { compact: true })}</span>} sub={<span className="text-muted">{data.summary.buyers} insiders</span>} />
            <Stat label={`Sold (${data.summary.days}d)`} value={<span className="text-loss">{money(data.summary.soldValue, { compact: true })}</span>} sub={<span className="text-muted">{data.summary.sellers} insiders</span>} />
            <Stat label="Net" value={<span className={data.summary.netValue >= 0 ? 'text-gain' : 'text-loss'}>{money(data.summary.netValue, { compact: true })}</span>} />
          </div>
          {trades.length ? (
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead className="sticky top-0 bg-surface-2">
                  <tr className="border-y border-line text-left text-[11px] text-muted">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Insider</th>
                    <th className="px-2 py-2 font-medium">Type</th>
                    <th className="px-2 py-2 text-right font-medium">Shares</th>
                    <th className="px-2 py-2 text-right font-medium">Price</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((row, index) => (
                    <tr key={`${row.accession}-${index}`} className="border-b border-line">
                      <td className="px-4 py-1.5 text-muted">{shortDate(row.date)}</td>
                      <td className="px-2 py-1.5">
                        <div className="text-ink-2">{row.owner}</div>
                        <div className="text-[10.5px] text-faint">{row.role}</div>
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={row.kind === 'buy' ? 'gain' : row.kind === 'sell' ? 'loss' : 'neutral'}>{CODE_LABEL[row.code] ?? row.code}</Badge>
                      </td>
                      <td className="num px-2 py-1.5 text-right">{row.shares.toLocaleString()}</td>
                      <td className="num px-2 py-1.5 text-right">{row.price ? `$${row.price.toFixed(2)}` : '—'}</td>
                      <td className={cn('num px-4 py-1.5 text-right', row.kind === 'buy' ? 'text-gain' : row.kind === 'sell' ? 'text-loss' : 'text-muted')}>{row.value ? money(row.value, { compact: true }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 pb-4 text-[12px] text-muted">No {filter === 'market' ? 'open-market ' : ''}insider transactions in the latest Form 4 filings.</p>
          )}
          <p className="px-4 py-2 text-[11px] text-faint">Open-market buys (code P) carry the most signal: insiders sell for many reasons, but buy for one.</p>
        </>
      ) : null}
    </Panel>
  );
}

function RiskFactors({ symbol }: { symbol: string }) {
  const { data, isLoading } = useSWR<{ changes: RiskChanges | null }>(`/api/company/${symbol}/risk-factors`);
  const [view, setView] = useState<'added' | 'modified' | 'removed'>('added');
  const changes = data?.changes;
  return (
    <Panel>
      <PanelHeader
        kicker={changes ? `10-K ${changes.current.filedAt} vs ${changes.previous.filedAt}` : 'Item 1A, year over year'}
        title="What changed in the risk factors"
        actions={
          changes ? (
            <Segmented
              size="xs"
              value={view}
              onChange={setView}
              options={[
                { value: 'added', label: `New ${changes.added.length}` },
                { value: 'modified', label: `Reworded ${changes.modified.length}` },
                { value: 'removed', label: `Dropped ${changes.removed.length}` },
              ]}
            />
          ) : null
        }
      />
      {isLoading && !data ? (
        <Skeleton className="mx-4 mb-4 h-60" />
      ) : !changes ? (
        <EmptyState title="Not enough annual reports" body="Needs two 10-K filings on EDGAR (foreign filers use 20-F, which isn't compared yet)." />
      ) : (
        <div className="max-h-[520px] overflow-auto px-4 pb-4">
          {view === 'added' &&
            changes.added.map((text, index) => (
              <p key={index} className="border-l-2 border-gain/60 py-1.5 pl-3 text-[12.5px] leading-relaxed text-ink-2">
                {text}
              </p>
            ))}
          {view === 'removed' &&
            changes.removed.map((text, index) => (
              <p key={index} className="border-l-2 border-loss/60 py-1.5 pl-3 text-[12.5px] leading-relaxed text-muted line-through decoration-loss/40">
                {text}
              </p>
            ))}
          {view === 'modified' &&
            changes.modified.map((pair, index) => (
              <div key={index} className="border-l-2 border-warning/60 py-1.5 pl-3 text-[12.5px] leading-relaxed">
                <p className="text-ink-2">{pair.after}</p>
                <details className="mt-1 text-[11.5px] text-muted">
                  <summary className="cursor-pointer">Last year&apos;s wording</summary>
                  {pair.before}
                </details>
              </div>
            ))}
          <div className="mt-3 flex gap-4 text-[11.5px]">
            <a href={changes.current.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-soft hover:underline">
              Current 10-K <ExternalLink className="size-3" />
            </a>
            <a href={changes.previous.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-soft hover:underline">
              Prior 10-K <ExternalLink className="size-3" />
            </a>
            <span className="text-faint">{changes.unchanged} paragraphs unchanged</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Filings intelligence: Form 4 insider activity and year-over-year risk-factor changes. */
export function InsidersPanel({ symbol }: { symbol: string }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Insiders symbol={symbol} />
      <RiskFactors symbol={symbol} />
    </div>
  );
}

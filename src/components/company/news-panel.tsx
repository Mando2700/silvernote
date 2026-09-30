'use client';

import { ArrowUpRight, FileText, Quote, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Panel, PanelHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { cite } from '@/lib/citation';
import type { Filing, NewsItem } from '@/lib/data/types';
import { relativeTime, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type NewsResponse = {
  news: NewsItem[];
  filings: Filing[];
  analyst: null | {
    recommendations: Array<{ period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>;
    surprises: Array<{ period: string; actual: number | null; estimate: number | null; surprisePercent: number | null }>;
  };
};

const KEY_FORMS = /^(10-K|10-Q|8-K|20-F|6-K|40-F|DEF 14A|S-1|424B)/;

export function NewsList({ items, compact = false }: { items: NewsItem[]; compact?: boolean }) {
  if (!items.length) return <div className="px-4 py-8 text-center text-[12px] text-muted">No recent headlines.</div>;
  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="group flex gap-3 border-t border-line px-4 py-2.5 first:border-t-0 hover:bg-white/[0.025]">
          <div className="min-w-0 flex-1">
            <div className={cn('text-ink-2 group-hover:text-ink', compact ? 'line-clamp-1 text-[12.5px]' : 'text-[13px] leading-snug')}>{item.title}</div>
            {!compact && item.summary ? <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{item.summary}</div> : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
              <span>{item.source}</span>
              <span>·</span>
              <span>{relativeTime(item.publishedAt)}</span>
              {item.symbols.slice(0, 5).map((symbol) => (
                <span key={symbol} className="font-mono text-[10px] text-muted">
                  {symbol}
                </span>
              ))}
            </div>
          </div>
          <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-faint group-hover:text-brand" />
        </a>
      ))}
    </div>
  );
}

export function NewsPanel({ symbol, name }: { symbol: string; name: string }) {
  const { data, isLoading } = useSWR<NewsResponse>(`/api/company/${symbol}/news`);
  const [filter, setFilter] = useState<'key' | 'all'>('key');
  const { askAssistant } = useShell();

  const filings = (data?.filings ?? []).filter((filing) => filter === 'all' || KEY_FORMS.test(filing.form)).slice(0, 40);
  const latestRecommendation = data?.analyst?.recommendations[0];

  return (
    <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
      <Panel>
        <PanelHeader kicker="Headlines" title={`${name} in the news`} />
        {isLoading && !data ? <Skeleton className="mx-4 mb-4 h-72" /> : <NewsList items={data?.news ?? []} />}
      </Panel>
      <div className="flex flex-col gap-4">
        {latestRecommendation ? (
          <Panel>
            <PanelHeader kicker={`Analyst consensus · ${latestRecommendation.period}`} title="Recommendations" />
            <div className="px-4 pb-4">
              {(() => {
                const rows = [
                  { label: 'Strong buy', value: latestRecommendation.strongBuy },
                  { label: 'Buy', value: latestRecommendation.buy },
                  { label: 'Hold', value: latestRecommendation.hold },
                  { label: 'Sell', value: latestRecommendation.sell },
                  { label: 'Strong sell', value: latestRecommendation.strongSell },
                ];
                const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
                return (
                  <div className="flex flex-col gap-1.5">
                    {rows.map((row) => (
                      <div key={row.label} className="grid grid-cols-[80px_1fr_28px] items-center gap-2 text-[12px]">
                        <span className="text-ink-2">{row.label}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full bg-[#5d6470]" style={{ width: `${(row.value / total) * 100}%` }} />
                        </div>
                        <span className="num text-right text-muted">{row.value}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {data?.analyst?.surprises.length ? (
                <div className="mt-4 border-t border-line pt-3">
                  <div className="mb-2 text-[11.5px] text-muted">EPS surprises</div>
                  <div className="grid grid-cols-4 gap-2">
                    {data.analyst.surprises.slice(0, 4).map((surprise) => (
                      <div key={surprise.period} className="rounded-sm border border-line bg-surface-1 p-2">
                        <div className="font-mono text-[10px] text-faint">{surprise.period}</div>
                        <div className="num text-[12px] text-ink">{surprise.actual ?? '—'}</div>
                        <div className={cn('num text-[10.5px]', (surprise.surprisePercent ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>
                          {surprise.surprisePercent !== null ? `${surprise.surprisePercent >= 0 ? '+' : '−'}${Math.abs(surprise.surprisePercent).toFixed(1)}%` : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>
        ) : null}
        <Panel>
          <PanelHeader
            kicker="SEC EDGAR"
            title="Filings"
            actions={
              <Segmented
                size="xs"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'key', label: 'Key forms' },
                  { value: 'all', label: 'All' },
                ]}
              />
            }
          />
          {filings.length ? (
            <div className="flex flex-col">
              {filings.map((filing) => (
                <div key={filing.accession} className="group flex items-center gap-3 border-t border-line px-4 py-2 hover:bg-white/[0.025]">
                  <FileText className="size-3.5 shrink-0 text-muted" />
                  <Badge tone={/10-K|20-F|40-F/.test(filing.form) ? 'brand' : 'neutral'} className="w-14 justify-center">
                    {filing.form}
                  </Badge>
                  <a href={filing.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12px] text-ink-2 hover:text-ink">
                    {filing.description ?? filing.primaryDocument}
                  </a>
                  <span className="text-[11px] text-faint">{shortDate(filing.filedAt)}</span>
                  <button
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    title="Copy citation (APA)"
                    aria-label="Copy APA citation"
                    onClick={() => {
                      void navigator.clipboard.writeText(cite({ kind: 'filing', company: name, form: filing.form, filedAt: filing.filedAt, periodEnd: filing.reportDate, url: filing.url }, 'APA').replace(/\*/g, ''));
                      toast.success('APA citation copied');
                    }}
                  >
                    <Quote className="size-3.5 text-muted hover:text-ink" />
                  </button>
                  {/^(10-K|10-Q|8-K|20-F)/.test(filing.form) ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      icon={<Sparkles className="size-3 text-brand" />}
                      onClick={() =>
                        askAssistant(`Summarize ${symbol}'s ${filing.form} filed ${filing.filedAt}: key numbers, changes vs the prior period, risks and anything that challenges the thesis.\n[filing:${filing.url}]`, {
                          type: 'company',
                          symbol,
                          name,
                        })
                      }
                    >
                      Summarize
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : isLoading ? (
            <Skeleton className="mx-4 mb-4 h-40" />
          ) : (
            <EmptyState title="No SEC filings found" body="This security has no EDGAR filer record." />
          )}
        </Panel>
      </div>
    </div>
  );
}

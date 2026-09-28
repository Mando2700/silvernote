'use client';

import { ArrowUpRight, Briefcase, Eye, Newspaper, NotebookPen, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { MarketHeatmap, type HeatmapItem } from '@/components/charts/market-heatmap';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { Delta } from '@/components/motion/delta';
import { ExtendedMove } from '@/components/motion/extended-move';
import { ScoreRing } from '@/components/motion/score-ring';
import { Page } from '@/components/shell/page';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { EmptyState, Panel, PanelHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { useExtendedQuotes } from '@/lib/extended-client';
import { money, price, relativeTime, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';

const HeroCanvas = dynamic(() => import('@/components/hero/hero-canvas').then((module) => module.HeroCanvas), { ssr: false });

type MarketRow = { symbol: string; name: string; sector: string | null; price: number | null; changePct: number | null; marketCap: number | null; score: number | null };

type DashboardData = {
  heatmap: HeatmapItem[];
  breadth: { advancers: number; decliners: number; unchanged: number; total: number };
  sectors: Array<{ sector: string; marketCap: number; changePct: number | null; count: number }>;
  movers: { gainers: MarketRow[]; losers: MarketRow[] };
  leaders: Array<MarketRow & { scoreLabel: string | null }>;
  portfolio: null | { id: string; name: string; count: number; totalValue: number; dayChange: number; dayChangePct: number | null; unrealized: number; unrealizedPct: number | null; positions: number };
  watchlist: null | { id: string; name: string; items: Array<{ symbol: string; price: number | null; changePct: number | null; score: number | null }> };
  notes: Array<{ id: string; title: string; symbol: string | null; kind: string; at: string }>;
  news: Array<{ id: string; title: string; url: string; source: string; publishedAt: string; symbols: string[] }>;
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Late session';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function Hero({ data }: { data: DashboardData | undefined }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const breadth = data?.breadth;
  const advancingShare = breadth && breadth.total ? breadth.advancers / breadth.total : 0.5;
  const sorted = data ? [...data.sectors].filter((sector) => sector.changePct !== null).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)) : [];
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  return (
    <Panel className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_120%_at_70%_120%,rgba(205,212,222,0.1),transparent_60%)]" />
      <HeroCanvas className="absolute inset-0 opacity-90" />
      <div className="absolute inset-0 bg-gradient-to-r from-surface-2 via-surface-2/70 to-transparent" />
      <div className="relative grid gap-6 p-6 md:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="kicker">
            {greeting()} · {today}
          </div>
          {data?.portfolio ? (
            <>
              <div className="mt-4 text-[12px] text-muted">
                {data.portfolio.name} · {data.portfolio.positions} positions
              </div>
              <div className="mt-1 text-[52px] leading-none font-semibold tracking-[-0.035em] text-ink">
                <AnimatedNumber value={data.portfolio.totalValue} format={(value) => money(value, { digits: 0 })} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
                <span className="flex items-center gap-1.5">
                  <span className="text-muted">Today</span>
                  <Delta value={data.portfolio.dayChange} kind="money" digits={0} />
                  <Delta value={data.portfolio.dayChangePct} className="text-[12px]" />
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-muted">Unrealized</span>
                  <Delta value={data.portfolio.unrealized} kind="money" digits={0} />
                  <Delta value={data.portfolio.unrealizedPct} className="text-[12px]" />
                </span>
              </div>
              <div className="mt-5 flex gap-2">
                <Magnetic>
                  <Link href="/portfolio">
                    <Button variant="primary" icon={<Briefcase className="size-3.5" />}>
                      Open portfolio
                    </Button>
                  </Link>
                </Magnetic>
                <Link href="/explorer">
                  <Button variant="outline">Explore the market</Button>
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="mt-4 max-w-md text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink">
                Every US stock, scored, charted and <span className="text-silver">ready for your thesis.</span>
              </h1>
              <p className="mt-3 max-w-md text-[13px] leading-relaxed text-muted">
                Start a portfolio or a watchlist to see your numbers here. Everything else is live below.
              </p>
              <div className="mt-5 flex gap-2">
                <Magnetic>
                  <Link href="/portfolio">
                    <Button variant="primary" icon={<Plus className="size-3.5" />}>
                      Create a portfolio
                    </Button>
                  </Link>
                </Magnetic>
                <Link href="/explorer">
                  <Button variant="outline">Explore the market</Button>
                </Link>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col justify-end gap-4">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="kicker">Market breadth</span>
              <span className="text-[11.5px] text-muted">{breadth ? `${breadth.total.toLocaleString()} stocks` : ''}</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-4">
              <motion.div className="h-full bg-gain-fill" initial={{ width: '50%' }} animate={{ width: `${advancingShare * 100}%` }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
              <div className="w-[2px] bg-surface-2" />
              <div className="h-full flex-1 bg-loss-fill" />
            </div>
            <div className="mt-1.5 flex justify-between text-[12px]">
              <span className="text-gain">
                <span className="num">{breadth?.advancers.toLocaleString() ?? '—'}</span> advancing
              </span>
              <span className="text-loss">
                <span className="num">{breadth?.decliners.toLocaleString() ?? '—'}</span> declining
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-sm border border-line bg-surface-1/70 p-3 backdrop-blur">
              <div className="text-[11px] text-muted">Leading sector</div>
              <div className="mt-1 truncate text-[13.5px] font-medium text-ink">{best?.sector ?? '—'}</div>
              <Delta value={best?.changePct ?? null} alreadyPercent className="text-[12px]" />
            </div>
            <div className="rounded-sm border border-line bg-surface-1/70 p-3 backdrop-blur">
              <div className="text-[11px] text-muted">Lagging sector</div>
              <div className="mt-1 truncate text-[13.5px] font-medium text-ink">{worst?.sector ?? '—'}</div>
              <Delta value={worst?.changePct ?? null} alreadyPercent className="text-[12px]" />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SectorBars({ sectors }: { sectors: DashboardData['sectors'] }) {
  const max = Math.max(0.5, ...sectors.map((sector) => Math.abs(sector.changePct ?? 0)));
  return (
    <div className="flex flex-col gap-1.5 px-4 pb-4">
      {sectors.map((sector, index) => {
        const value = sector.changePct ?? 0;
        const width = (Math.abs(value) / max) * 50;
        return (
          <div key={sector.sector} className="grid grid-cols-[150px_1fr_56px] items-center gap-3" title={`${sector.sector}: ${signedPct(value, 2, true)} (${sector.count} stocks)`}>
            <span className="truncate text-[12px] text-ink-2">{sector.sector}</span>
            <div className="relative h-4">
              <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
              <motion.div
                className={cn('absolute top-1/2 h-2.5 -translate-y-1/2', value >= 0 ? 'rounded-r-[4px] bg-gain-fill' : 'rounded-l-[4px] bg-loss-fill')}
                style={value >= 0 ? { left: '50%' } : { right: '50%' }}
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ duration: 0.8, delay: index * 0.03, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <Delta value={value} alreadyPercent className="justify-end text-[12px]" />
          </div>
        );
      })}
    </div>
  );
}

function MarketList({ rows, empty, extended }: { rows: MarketRow[]; empty: string; extended: ReturnType<typeof useExtendedQuotes> }) {
  if (!rows.length) return <div className="px-4 py-6 text-center text-[12px] text-muted">{empty}</div>;
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <Link key={row.symbol} href={`/company/${row.symbol}`} className="group grid grid-cols-[20px_52px_1fr_auto_64px] items-center gap-3 border-t border-line px-4 py-2 hover:bg-white/[0.025]">
          <CompanyLogo symbol={row.symbol} size="sm" />
          <span className="font-mono text-[12px] font-semibold text-ink group-hover:text-white">{row.symbol}</span>
          <span className="truncate text-[12px] text-muted">{row.name}</span>
          <span className="num flex flex-col items-end gap-0.5 text-[12px] text-ink-2">
            {price(row.price)}
            <ExtendedMove quote={extended[row.symbol]} />
          </span>
          <Delta value={row.changePct} alreadyPercent className="justify-end text-[12px]" />
        </Link>
      ))}
    </div>
  );
}

export function Dashboard() {
  const { data, isLoading } = useSWR<DashboardData>('/api/dashboard', { refreshInterval: 60_000 });
  const [moverTab, setMoverTab] = useState<'gainers' | 'losers'>('gainers');
  const extended = useExtendedQuotes(data ? [...data.movers[moverTab], ...(data.watchlist?.items ?? [])].map((row) => row.symbol) : []);
  const heatmapItems = useMemo(() => data?.heatmap ?? [], [data]);

  return (
    <Page>
      <Hero data={data} />

      <Panel>
        <PanelHeader kicker="Live market" title="Market map" />
        <div className="px-4 pb-4">
          {heatmapItems.length ? (
            <MarketHeatmap items={heatmapItems} height={500} />
          ) : isLoading ? (
            <Skeleton className="h-[500px] w-full" />
          ) : (
            <EmptyState title="Building the market universe" body="SilverNote is downloading the US stock list and SEC fundamentals. This first run takes a couple of minutes; the map fills in automatically." />
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader
            kicker="Large caps · today"
            title="Movers"
            actions={
              <Segmented
                size="xs"
                value={moverTab}
                onChange={setMoverTab}
                options={[
                  { value: 'gainers', label: 'Gainers' },
                  { value: 'losers', label: 'Losers' },
                ]}
              />
            }
          />
          <MarketList rows={data ? data.movers[moverTab] : []} empty="No price data yet." extended={extended} />
        </Panel>

        <Panel>
          <PanelHeader kicker="Above $10B" title="SilverNote Score leaders" actions={<Link href="/explorer?sort=score" className="text-[11.5px] text-brand-soft hover:underline">See all</Link>} />
          {data?.leaders.length ? (
            <div className="flex flex-col">
              {data.leaders.map((row) => (
                <Link key={row.symbol} href={`/company/${row.symbol}`} className="group flex items-center gap-3 border-t border-line px-4 py-1.5 hover:bg-white/[0.025]">
                  <ScoreRing score={row.score} size="xs" />
                  <CompanyLogo symbol={row.symbol} size="xs" />
                  <span className="w-12 font-mono text-[12px] font-semibold text-ink group-hover:text-white">{row.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{row.name}</span>
                  <span className="text-[11px] text-faint">{row.scoreLabel}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-4 pb-5 text-[12px] leading-relaxed text-muted">Scores appear as the weekly sweep works through the universe (largest companies first).</div>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            kicker="Watchlist"
            title={data?.watchlist?.name ?? 'Watchlist'}
            actions={<Link href="/watchlists" className="text-[11.5px] text-brand-soft hover:underline">Open</Link>}
          />
          {data?.watchlist?.items.length ? (
            <div className="flex flex-col">
              {data.watchlist.items.map((item) => (
                <Link key={item.symbol} href={`/company/${item.symbol}`} className="group grid grid-cols-[20px_52px_1fr_64px_30px] items-center gap-3 border-t border-line px-4 py-2 hover:bg-white/[0.025]">
                  <CompanyLogo symbol={item.symbol} size="sm" />
                  <span className="font-mono text-[12px] font-semibold text-ink group-hover:text-white">{item.symbol}</span>
                  <span className="num flex flex-col items-end gap-0.5 text-[12px] text-ink-2">
                    {price(item.price)}
                    <ExtendedMove quote={extended[item.symbol]} />
                  </span>
                  <Delta value={item.changePct} alreadyPercent className="justify-end text-[12px]" />
                  <span className="num text-right text-[11px] text-muted">{item.score ?? '—'}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Eye className="size-4" />} title="No watchlist yet" body="Track ideas with custom columns, tags and alerts." action={<Link href="/watchlists"><Button size="sm">Create watchlist</Button></Link>} />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Panel>
          <PanelHeader kicker="Cap-weighted" title="Sector performance today" />
          {data ? <SectorBars sectors={data.sectors} /> : <Skeleton className="mx-4 mb-4 h-64" />}
        </Panel>
        <div className="grid gap-4">
          <Panel>
            <PanelHeader kicker="Research" title="Recent notes & thesis changes" actions={<Link href="/notes" className="text-[11.5px] text-brand-soft hover:underline">Workspace</Link>} />
            {data?.notes.length ? (
              <div className="flex flex-col pb-1">
                {data.notes.map((note) => (
                  <Link
                    key={`${note.kind}-${note.id}`}
                    href={note.kind === 'note' ? `/notes?note=${note.id}` : `/company/${note.symbol}?tab=workspace`}
                    className="flex items-center gap-3 border-t border-line px-4 py-2 hover:bg-white/[0.025]"
                  >
                    <NotebookPen className="size-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                      {note.kind === 'thesis' ? `Updated ${note.title}` : note.title || 'Untitled note'}
                    </span>
                    {note.symbol ? <span className="font-mono text-[11px] text-faint">{note.symbol}</span> : null}
                    <span className="w-16 text-right text-[11px] text-faint">{relativeTime(note.at)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="px-4 pb-5 text-[12px] text-muted">Your thesis edits and notes will show up here, timestamped.</div>
            )}
          </Panel>
          <Panel>
            <PanelHeader kicker="Headlines" title="Market news" actions={<Link href="/news" className="text-[11.5px] text-brand-soft hover:underline">All news</Link>} />
            {data?.news.length ? (
              <div className="flex flex-col pb-1">
                {data.news.map((item) => (
                  <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="group flex items-start gap-3 border-t border-line px-4 py-2 hover:bg-white/[0.025]">
                    <Newspaper className="mt-0.5 size-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-[12.5px] text-ink-2 group-hover:text-ink">{item.title}</span>
                      <span className="text-[11px] text-faint">
                        {item.source} · {relativeTime(item.publishedAt)}
                      </span>
                    </span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-faint group-hover:text-brand" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="px-4 pb-5 text-[12px] text-muted">Loading headlines…</div>
            )}
          </Panel>
        </div>
      </div>
    </Page>
  );
}

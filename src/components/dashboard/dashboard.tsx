'use client';

import { ArrowUpRight, Eye, Newspaper, NotebookPen, Plus, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { BriefModal, type Brief } from '@/components/briefs/brief-view';
import { BRAND, LineChart, type LineSeries } from '@/components/charts/svg';
import { MarketHeatmap, type HeatmapItem } from '@/components/charts/market-heatmap';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { Delta } from '@/components/motion/delta';
import { ExtendedMove } from '@/components/motion/extended-move';
import { ScoreRing } from '@/components/motion/score-ring';
import { MacroTape } from '@/components/macro/macro-tape';
import { useSearchParams } from '@/components/shell/keep-alive';
import { Page } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { EmptyState, Panel, PanelHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/client';
import { useExtendedQuotes } from '@/lib/extended-client';
import { useLivePrices } from '@/lib/live-client';
import { type LiveDetail, withLivePrices } from '@/lib/portfolio-live';
import { useBaseCurrency } from '@/lib/fx-client';
import { money, price, relativeTime, signedPct } from '@/lib/format';
import { regularSession, sessionHours } from '@/lib/session';
import { SERIES_COLORS } from '@/lib/theme';
import { cn } from '@/lib/utils';

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

type IntradayPoint = { t: number; value: number; invested: number; twr: number; benchmark: number; nasdaq: number; dow: number };

function timeLabel(t: number) {
  return new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Late session';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

type CalendarDay = {
  date: string;
  earnings: Array<{ symbol: string; time: 'pre' | 'post' | 'unknown'; epsForecast: number | null; mine: boolean }>;
  dividends: Array<{ symbol: string; amount: number | null; mine: boolean }>;
  economy: Array<{ name: string; time: string | null; major: boolean; consensus: string | null }>;
};

function isoIn(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}

/** Portfolio at a glance, with the total also in the base currency when it isn't USD. */
function PortfolioCard({ data }: { data: DashboardData | undefined }) {
  const base = useBaseCurrency();
  const id = data?.portfolio?.id;
  // Same source and live revaluation as the portfolio page, so both show the same total.
  const { data: saved } = useSWR<LiveDetail>(id ? `/api/portfolios/${id}` : null, { refreshInterval: 60_000 });
  const live = useLivePrices(useMemo(() => (saved?.holdings ?? []).map((holding) => holding.symbol), [saved]));
  const summary = useMemo(() => (saved ? withLivePrices(saved, live).summary : null), [saved, live]);
  const merged = data?.portfolio ? { ...data.portfolio, ...(summary ?? {}) } : data?.portfolio;
  // Includes the pre-market / after-hours move when a session is open.
  const portfolio = merged && summary ? { ...merged, totalValue: summary.totalValue + (summary.extended?.change ?? 0) } : merged;
  const breadth = data?.breadth;
  const sorted = data ? [...data.sectors].filter((sector) => sector.changePct !== null).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)) : [];
  return (
    <Panel className="hud flex flex-col justify-between gap-3 p-4">
      <div>
        <div className="kicker flex items-center gap-2">
          <span className="size-1.5 animate-pulse-dot rounded-full bg-ion" aria-hidden />
          {greeting()} · {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </div>
        {portfolio ? (
          <Link href="/portfolio" className="group mt-2 block">
            <div className="text-[11.5px] text-muted">
              {portfolio.name} · {portfolio.positions} positions
            </div>
            <div className="text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink">
              <AnimatedNumber value={portfolio.totalValue} format={(value) => money(value, { digits: 0 })} />
            </div>
            {base.rate ? <div className="num text-[12px] text-muted">≈ {base.format(portfolio.totalValue)}</div> : null}
            <div className="mt-1 flex flex-wrap gap-x-4 text-[12.5px]">
              <span className="flex items-center gap-1.5">
                <span className="text-muted">Today</span>
                <Delta value={portfolio.dayChange} kind="money" digits={0} />
                <Delta value={portfolio.dayChangePct} className="text-[11.5px]" />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-muted">Unrealized</span>
                <Delta value={portfolio.unrealized} kind="money" digits={0} />
              </span>
            </div>
          </Link>
        ) : (
          <div className="mt-3">
            <p className="text-[12.5px] text-muted">No portfolio yet. Record trades or import from a broker to see your numbers here.</p>
            <Link href="/portfolio">
              <Button size="sm" variant="primary" className="mt-2" icon={<Plus className="size-3.5" />}>
                Create a portfolio
              </Button>
            </Link>
          </div>
        )}
      </div>
      {breadth ? (
        <div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-4">
            <div className="h-full bg-gain-fill" style={{ width: `${(breadth.advancers / Math.max(1, breadth.total)) * 100}%` }} />
            <div className="h-full flex-1 bg-loss-fill" />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px]">
            <span className="text-gain">{breadth.advancers.toLocaleString()} up</span>
            <span className="truncate px-2 text-muted">
              {sorted[0] ? `${sorted[0].sector} leads` : ''}
            </span>
            <span className="text-loss">{breadth.decliners.toLocaleString()} down</span>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/** Events for the investor's own names over the next week, plus today's major US releases. */
function WeekAhead() {
  const { data } = useSWR<{ days: CalendarDay[] }>(`/api/calendar?from=${isoIn(0)}&to=${isoIn(7)}`, { refreshInterval: 15 * 60_000 });
  const today = data?.days[0]?.date === isoIn(0) ? data.days[0] : null;
  const items = (data?.days ?? []).flatMap((day) => [
    ...day.earnings.filter((row) => row.mine).map((row) => ({ key: `e-${row.symbol}`, date: day.date, symbol: row.symbol, text: `Earnings ${row.time === 'pre' ? 'before open' : row.time === 'post' ? 'after close' : ''}${row.epsForecast !== null ? ` · est $${row.epsForecast.toFixed(2)}` : ''}` })),
    ...day.dividends.filter((row) => row.mine).map((row) => ({ key: `d-${row.symbol}`, date: day.date, symbol: row.symbol, text: `Ex-dividend${row.amount ? ` $${row.amount}` : ''}` })),
  ]);
  const major = today?.economy.filter((row) => row.major).slice(0, 4) ?? [];
  return (
    <Panel className="flex flex-col">
      <PanelHeader kicker="Your names · next 7 days" title="Week ahead" actions={<Link href="/calendar" className="text-[11.5px] text-brand-soft hover:underline">Calendar</Link>} />
      <div className="flex-1 px-4 pb-3">
        {!data ? (
          <Skeleton className="h-24" />
        ) : items.length ? (
          items.slice(0, 6).map((item) => (
            <Link key={item.key} href={`/company/${item.symbol}`} className="flex items-center gap-2 border-t border-line py-1.5 text-[12px] hover:bg-white/[0.02]">
              <span className="w-14 shrink-0 text-[11px] text-faint">{new Date(`${item.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
              <CompanyLogo symbol={item.symbol} size="xs" />
              <span className="font-mono font-semibold text-ink">{item.symbol}</span>
              <span className="truncate text-muted">{item.text}</span>
            </Link>
          ))
        ) : (
          <p className="py-2 text-[12px] text-muted">No earnings or ex-dividend dates for your holdings and watchlists this week.</p>
        )}
        {major.length ? (
          <div className="mt-2 border-t border-line pt-2">
            <div className="kicker mb-1 text-[9.5px]">US data today</div>
            {major.map((row, index) => (
              <div key={`${row.name}-${index}`} className="truncate text-[11.5px] text-ink-2">
                <span className="num mr-1.5 text-faint">{row.time ?? ''}</span>
                {row.name}
                {row.consensus ? <span className="text-muted"> · cons {row.consensus}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** Grok's scheduled output: the morning brief first, then red teams and previews. */
function BriefsCard({ open }: { open: (brief: Brief) => void }) {
  const { data, mutate } = useSWR<Brief[]>('/api/briefs', { refreshInterval: 10 * 60_000 });
  const [generating, setGenerating] = useState(false);
  const latest = data?.find((brief) => brief.kind === 'morning');
  const others = (data ?? []).filter((brief) => brief !== latest).slice(0, 3);
  const generate = async () => {
    setGenerating(true);
    try {
      open(await api<Brief>('/api/briefs', { body: { kind: 'morning' } }));
      void mutate();
    } finally {
      setGenerating(false);
    }
  };
  return (
    <Panel className="flex flex-col">
      <PanelHeader
        kicker="Grok · written for you"
        title="Briefs"
        actions={
          <Button size="xs" variant="outline" icon={<Sparkles className="size-3 text-brand" />} loading={generating} onClick={() => void generate()}>
            Brief me now
          </Button>
        }
      />
      <div className="flex-1 px-4 pb-3">
        {latest ? (
          <button onClick={() => open(latest)} className="block w-full rounded-sm border border-line bg-surface-1/60 p-2.5 text-left hover:border-brand/30">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>{latest.title}</span>
              <span>{relativeTime(latest.created_at)}</span>
            </div>
            <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-ink-2">{latest.content.replace(/[#*_>`]/g, '').slice(0, 320)}</p>
          </button>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted">A morning brief lands here before each US open (and on your phone once notifications are on), with red-team reviews of your theses every Sunday.</p>
        )}
        {others.map((brief) => (
          <button key={brief.id} onClick={() => open(brief)} className="flex w-full items-center justify-between gap-2 border-t border-line py-1.5 text-left text-[12px] hover:bg-white/[0.02]">
            <span className="truncate text-ink-2">{brief.title}</span>
            <span className="shrink-0 text-[11px] text-faint">{relativeTime(brief.created_at)}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function Today({ data }: { data: DashboardData | undefined }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const params = useSearchParams();
  const wanted = params.get('brief');
  const { data: briefs } = useSWR<Brief[]>(wanted ? '/api/briefs' : null);
  // Opened from a notification (/?brief=morning): show the newest brief of that kind once.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (wanted && briefs && shownFor !== wanted) {
    setShownFor(wanted);
    const match = briefs.find((item) => item.kind === wanted);
    if (match) setBrief(match);
  }
  return (
    <div className="flex flex-col gap-3">
      <MacroTape />
      <div className="grid gap-3 lg:grid-cols-3">
        <PortfolioCard data={data} />
        <WeekAhead />
        <BriefsCard open={setBrief} />
      </div>
      <BriefModal brief={brief} onClose={() => setBrief(null)} />
    </div>
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

/** Today's session, marked to market minute by minute against the prior close (= the same feed the full portfolio chart uses on 1D). */
function PortfolioVsIndices({ portfolio }: { portfolio: NonNullable<DashboardData['portfolio']> }) {
  const { data } = useSWR<{ points: IntradayPoint[] }>(`/api/portfolios/${portfolio.id}/intraday`, { refreshInterval: 60_000 });
  const points = data?.points ?? [];
  if (data && points.length < 2) return null;

  const categories = points.map((point) => timeLabel(point.t));
  // Fixed open-to-close axis: the lines start at the left and advance as the session progresses.
  const session = points.length ? regularSession(points[points.length - 1].t) : null;
  const time = session
    ? {
        values: points.map((point) => point.t),
        domain: [Math.min(points[0].t, session.open), Math.max(points[points.length - 1].t, session.close)] as [number, number],
        ticks: sessionHours(session).map((at) => ({ at, label: timeLabel(at) })),
      }
    : undefined;
  const series: LineSeries[] = [
    { label: portfolio.name, values: points.map((point) => point.twr - 100), color: BRAND, emphasis: true },
    { label: 'S&P 500', values: points.map((point) => point.benchmark - 100), color: SERIES_COLORS[0] },
    { label: 'Nasdaq 100', values: points.map((point) => point.nasdaq - 100), color: SERIES_COLORS[2] },
    { label: 'Dow 30', values: points.map((point) => point.dow - 100), color: SERIES_COLORS[1], dashed: true },
  ];

  return (
    <Panel>
      <PanelHeader kicker="Today · intraday" title="Portfolio vs major indices" />
      <div className="px-4 pb-4">
        {points.length ? (
          <LineChart categories={categories} series={series} format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`} height={220} zeroLine time={time} />
        ) : (
          <Skeleton className="h-[220px] w-full" />
        )}
      </div>
    </Panel>
  );
}

function MarketList({ rows, empty, extended }: { rows: MarketRow[]; empty: string; extended: ReturnType<typeof useExtendedQuotes> }) {
  if (!rows.length) return <div className="px-4 py-6 text-center text-[12px] text-muted">{empty}</div>;
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <Link key={row.symbol} href={`/company/${row.symbol}`} className="row-glow group grid grid-cols-[20px_52px_1fr_auto_64px] items-center gap-3 border-t border-line px-4 py-2 transition-colors hover:bg-white/[0.03]">
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
      <Today data={data} />

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

      {data?.portfolio ? <PortfolioVsIndices portfolio={data.portfolio} /> : null}

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
                <Link key={row.symbol} href={`/company/${row.symbol}`} className="row-glow group flex items-center gap-3 border-t border-line px-4 py-1.5 transition-colors hover:bg-white/[0.03]">
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
                <Link key={item.symbol} href={`/company/${item.symbol}`} className="row-glow group grid grid-cols-[20px_52px_1fr_64px_30px] items-center gap-3 border-t border-line px-4 py-2 transition-colors hover:bg-white/[0.03]">
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
                    className="row-glow flex items-center gap-3 border-t border-line px-4 py-2 transition-colors hover:bg-white/[0.03]"
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
                  <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="row-glow group flex items-start gap-3 border-t border-line px-4 py-2 transition-colors hover:bg-white/[0.03]">
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

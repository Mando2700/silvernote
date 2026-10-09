'use client';

import { ExternalLink, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, ViewTransition } from 'react';
import useSWR from 'swr';

import { PriceChart, type ChartMarker } from '@/components/charts/price-chart';
import { useChartStudies } from '@/components/charts/stock-chart';
import { ColumnChart } from '@/components/charts/svg';
import { AlertButton, TradeButton, WatchlistMenu } from '@/components/company/actions';
import { AssetAboutPanel, AssetMarketPanel, AssetPerformancePanel, AssetSupplyPanel } from '@/components/company/asset-panels';
import { DcfPanel } from '@/components/company/dcf-panel';
import { InsidersPanel } from '@/components/company/insiders-panel';
import { CompsTool } from '@/components/lab/lab';
import { Financials } from '@/components/company/financials';
import { NewsList, NewsPanel } from '@/components/company/news-panel';
import { PeersPanel } from '@/components/company/peers-panel';
import { ScorePanel } from '@/components/company/score-panel';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { Delta } from '@/components/motion/delta';
import { ExtendedMove } from '@/components/motion/extended-move';
import { ScoreRing, type SubScoreSummary } from '@/components/motion/score-ring';
import { usePageActive, useSearchParams } from '@/components/shell/keep-alive';
import { useShell } from '@/components/shell/providers';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { FullscreenOverlay } from '@/components/ui/fullscreen-overlay';
import { Badge, Panel, PanelHeader, Segmented, Skeleton, Tabs } from '@/components/ui/primitives';
import { CompanyWorkspace, type WorkspaceData } from '@/components/workspace/company-workspace';
import { getAsset } from '@/lib/data/assets';
import type { Candle, CompanyProfile, NewsItem, Quote } from '@/lib/data/types';
import { useExtendedQuotes } from '@/lib/extended-client';
import { compactNumber, money, multiple, pct, price, relativeTime } from '@/lib/format';
import type { StandardizedStatements } from '@/lib/finance/statement-types';
import { useLivePrices } from '@/lib/live-client';
import { pushRecentStock } from '@/lib/recent-stocks';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'financials' | 'dcf' | 'comps' | 'score' | 'peers' | 'news' | 'insiders' | 'workspace';

type CompanyPayload = {
  symbol: string;
  security: { name: string; sector: string | null; industry: string | null; market_cap: number | null; price: number | null; change: number | null; change_pct: number | null; exchange: string | null; country: string | null; updated_at: string } | null;
  profile: CompanyProfile | null;
  quote: Quote | null;
  score: { overall: number; label: string; confidence: string; sub_scores: SubScoreSummary[]; payload: { shortSummary: string; strengths: string[]; weaknesses: string[] }; calculated_at: string } | null;
  watchlists: Array<{ id: string; name: string; member: boolean }>;
  workspace: { stance: string; conviction: number; target_price: number | null } | null;
  fundamentals: Record<string, number | string | null> | null;
};

export type CompanyInitial = {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  price: number | null;
  changePct: number | null;
  score: number | null;
  scoreLabel: string | null;
};

const RANGES = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y', '10y'] as const;

function n(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function KeyStats({ data, profileLoading }: { data: CompanyPayload | null; profileLoading: boolean }) {
  if (!data) return <Skeleton className="h-[236px] w-full" />;
  const f = data.fundamentals ?? {};
  const marketCap = data.security?.market_cap ?? null;
  const netIncome = n(f.net_income);
  const revenue = n(f.revenue);
  const fcf = n(f.fcf);
  const equity = n(f.total_equity);
  const debt = n(f.total_debt);
  const cash = n(f.cash);
  const ebitda = n(f.ebitda);
  const ev = marketCap !== null ? marketCap + (debt ?? 0) - (cash ?? 0) : null;
  const priceNow = data.quote?.price ?? data.security?.price ?? null;
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Market value', value: marketCap ? `$${compactNumber(marketCap, 2)}` : '—' },
    { label: 'P/E', value: marketCap && netIncome && netIncome > 0 ? multiple(marketCap / netIncome) : '—' },
    { label: 'Forward P/E', value: data.profile?.forwardPE ? multiple(data.profile.forwardPE) : '—' },
    { label: 'P/S', value: marketCap && revenue ? multiple(marketCap / revenue) : '—' },
    { label: 'EV / EBITDA', value: ev && ebitda && ebitda > 0 ? multiple(ev / ebitda) : '—' },
    { label: 'FCF yield', value: marketCap && fcf !== null ? pct(fcf / marketCap) : '—' },
    { label: 'Revenue (FY)', value: revenue ? `$${compactNumber(revenue)}` : '—' },
    { label: 'Net margin', value: revenue && netIncome !== null ? pct(netIncome / revenue) : '—' },
    { label: 'ROE', value: equity && equity > 0 && netIncome !== null ? pct(netIncome / equity) : '—' },
    { label: 'Debt / equity', value: equity && equity > 0 && debt !== null ? multiple(debt / equity, 2) : '—' },
    // Indicated (forward) yield when a quote source has it, else what the last fiscal year actually paid.
    data.profile?.dividendYield
      ? { label: 'Dividend yield (fwd)', value: pct(data.profile.dividendYield, 2) }
      : { label: 'Dividend yield (FY)', value: marketCap && n(f.dividends_paid) ? pct(Math.abs(n(f.dividends_paid) as number) / marketCap, 2) : '—' },
    { label: '1Y analyst target', value: data.profile?.oneYearTarget ? `$${price(data.profile.oneYearTarget)}` : '—' },
  ];
  const high = data.profile?.high52 ?? null;
  const low = data.profile?.low52 ?? null;
  const position = high && low && priceNow && high > low ? Math.min(1, Math.max(0, (priceNow - low) / (high - low))) : null;
  return (
    <Panel>
      <PanelHeader kicker={`Fiscal ${f.fiscal_year ?? '—'} · latest price`} title="Key statistics" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <div className="text-[11px] text-muted">{stat.label}</div>
            {profileLoading && stat.value === '—' ? <Skeleton className="mt-1 h-3.5 w-12" /> : <div className="num mt-0.5 text-[14px] font-medium text-ink">{stat.value}</div>}
          </div>
        ))}
      </div>
      {position !== null ? (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1.5 flex justify-between text-[11px] text-muted">
            <span>52-week range</span>
            <span className="num">
              ${price(low)} — ${price(high)}
            </span>
          </div>
          <div className="relative h-1.5 rounded-full bg-gradient-to-r from-white/5 via-white/10 to-white/5">
            <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-2 bg-brand shadow-[0_0_10px_rgba(205,212,222,0.48)]" style={{ left: `${position * 100}%` }} />
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

// `data` is the core payload (null until it lands) and `profile` the best profile so far: everything else on the tab loads on its own.
function Overview({ symbol, data, profile, profileLoading, descriptionLoading, onTab }: { symbol: string; data: CompanyPayload | null; profile: CompanyProfile | null; profileLoading: boolean; descriptionLoading: boolean; onTab: (tab: Tab) => void }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>('1y');
  const [mode, setMode] = useState<'area' | 'candles'>('area');
  const [fullscreen, setFullscreen] = useState(false);
  // Pages of older history loaded as the chart is zoomed out; a new symbol or range starts from one page.
  const [history, setHistory] = useState({ view: '', pages: 1 });
  const view = `${symbol}:${range}`;
  const pages = history.view === view ? history.pages : 1;
  const { data: candles } = useSWR<{ candles: Candle[]; range: string }>(
    `/api/company/${symbol}/candles?range=${range}${pages > 1 ? `&pages=${pages}` : ''}`,
  );
  const studies = useChartStudies(symbol, candles?.candles ?? [], range);
  const loadOlder = useCallback(() => setHistory((current) => ({ view, pages: current.view === view ? Math.min(current.pages * 2, 32) : 2 })), [view]);
  const { data: workspace } = useSWR<WorkspaceData>(`/api/workspaces/${symbol}`);
  // Commodities and crypto have no filings or company news feed.
  const asset = getAsset(symbol);
  const { data: statements } = useSWR<StandardizedStatements>(asset ? null : `/api/company/${symbol}/statements`);
  const { data: news } = useSWR<{ news: NewsItem[] }>(asset ? null : `/api/company/${symbol}/news?headlines=1`);

  const markers: ChartMarker[] = useMemo(() => {
    const seen = new Set<string>();
    return (workspace?.versions ?? [])
      .filter((version) => {
        const day = version.created_at.slice(0, 10);
        if (seen.has(day)) return false;
        seen.add(day);
        return true;
      })
      .map((version) => ({ t: Math.floor(Date.parse(version.created_at) / 1000), label: version.section === 'thesis' ? 'Thesis' : 'Note' }));
  }, [workspace]);

  const annual = [...(statements?.annual ?? [])].reverse().slice(-6);

  const chartBody = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
        <Segmented size="xs" value={range} onChange={setRange} options={RANGES.map((value) => ({ value, label: value.toUpperCase() }))} />
        <div className="flex flex-wrap items-center gap-1.5">
          {studies.toolbar}
          <Segmented
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'area', label: 'Line' },
              { value: 'candles', label: 'Candles' },
            ]}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            onClick={() => setFullscreen((value) => !value)}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          />
        </div>
      </div>
      <div className="px-4 pt-2 pb-3">
        {candles?.candles.length ? (
          <PriceChart
            candles={candles.candles}
            mode={mode}
            height={fullscreen ? 640 : 340}
            animationKey={symbol}
            rangeKey={candles.range}
            intraday={['1d', '1w', '1m', '3m'].includes(candles.range)}
            onReachStart={loadOlder}
            markers={markers}
            targetPrice={workspace?.meta?.target_price ?? null}
            overlays={studies.overlays}
            percentMode={studies.percentMode}
            drawings={studies.drawings}
            onPick={studies.onPick}
          />
        ) : (
          <Skeleton className="h-[340px] w-full" />
        )}
        {markers.length || workspace?.meta?.target_price ? (
          <div className="mt-2 flex items-center gap-4 text-[11px] text-muted">
            {markers.length ? (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-brand" /> Thesis commits
              </span>
            ) : null}
            {workspace?.meta?.target_price ? (
              <span className="flex items-center gap-1.5">
                <span className="h-px w-4 border-t border-dashed border-brand-soft" /> Your target ${price(workspace.meta.target_price)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
      {fullscreen ? (
        <FullscreenOverlay onClose={() => setFullscreen(false)}>
          <Panel className="flex h-full flex-col overflow-y-auto">{chartBody}</Panel>
        </FullscreenOverlay>
      ) : null}
      <div className="flex flex-col gap-4">
        {fullscreen ? null : <Panel>{chartBody}</Panel>}
        {asset ? (
          <>
            <AssetMarketPanel symbol={symbol} livePrice={data?.quote?.price ?? null} />
            <AssetPerformancePanel symbol={symbol} />
          </>
        ) : (
          <KeyStats data={data ? { ...data, profile } : null} profileLoading={profileLoading} />
        )}
        {annual.length ? (
          <Panel>
            <PanelHeader
              kicker="Annual"
              title="Revenue and free cash flow"
              actions={
                <Button size="xs" variant="ghost" onClick={() => onTab('financials')}>
                  Full statements
                </Button>
              }
            />
            <div className="px-4 pb-4">
              <ColumnChart
                categories={annual.map((period) => period.label)}
                series={[
                  { label: 'Revenue', values: annual.map((period) => period.revenue ?? null) },
                  { label: 'Free cash flow', values: annual.map((period) => period.freeCashFlow ?? null) },
                ]}
                format={(value) => money(value, { compact: true, currency: statements?.currency })}
                height={200}
              />
            </div>
          </Panel>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        {asset ? null : (
          <Panel>
            <PanelHeader
              kicker="SilverNote Score"
              title={!data ? 'Loading' : data.score ? `${data.score.label} · ${data.score.confidence} confidence` : 'Not scored yet'}
              actions={
                <Button size="xs" variant="ghost" onClick={() => onTab('score')}>
                  Breakdown
                </Button>
              }
            />
            <div className="flex items-center gap-4 px-4 pb-4">
              <ScoreRing score={data?.score?.overall ?? null} size="md" subScores={data?.score?.sub_scores} label={data?.score?.label} confidence={data?.score?.confidence} />
              <p className="text-[12.5px] leading-relaxed text-ink-2">{data ? (data.score?.payload?.shortSummary ?? 'Open the Score tab to calculate the full breakdown for this company.') : ''}</p>
            </div>
          </Panel>
        )}
        {asset ? (
          <>
            <AssetAboutPanel symbol={symbol} />
            <AssetSupplyPanel symbol={symbol} livePrice={data?.quote?.price ?? null} />
          </>
        ) : null}
        {asset ? null : (
          <Panel>
            <PanelHeader kicker={[profile?.sector, profile?.industry].filter(Boolean).join(' · ') || 'Company'} title="About" />
            <div className="px-4 pb-4">
              {descriptionLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ) : (
                <p className="line-clamp-[10] text-[12.5px] leading-relaxed text-ink-2">{profile?.description ?? 'No description available.'}</p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                {[
                  ['Exchange', profile?.exchange ?? data?.security?.exchange],
                  ['Country', profile?.country ?? data?.security?.country],
                  ['CEO', profile?.ceo],
                  ['Employees', profile?.employees ? profile.employees.toLocaleString() : null],
                  ['Fiscal year ends', profile?.fiscalYearEnd ? `${profile.fiscalYearEnd.slice(0, 2)}/${profile.fiscalYearEnd.slice(2)}` : null],
                  ['SIC', profile?.sicDescription],
                ]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label as string}>
                      <div className="text-[10.5px] text-faint">{label}</div>
                      <div className="truncate text-ink-2">{value}</div>
                    </div>
                  ))}
              </div>
              {profile?.website ? (
                <a href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] text-brand-soft hover:underline">
                  {profile.website.replace(/^https?:\/\//, '')} <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          </Panel>
        )}
        {asset ? null : (
          <Panel>
            <PanelHeader
              kicker="Latest"
              title="Headlines"
              actions={
                <Button size="xs" variant="ghost" onClick={() => onTab('news')}>
                  All news & filings
                </Button>
              }
            />
            {news ? (
              <NewsList items={news.news.slice(0, 5)} compact />
            ) : (
              <div className="flex flex-col gap-3 px-4 pb-4">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-5/6" />
                <Skeleton className="h-3.5 w-full" />
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

export function CompanyView({ initial }: { initial: CompanyInitial }) {
  const symbol = initial.symbol;
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = usePageActive();
  const asset = getAsset(symbol);
  const requestedTab = (searchParams.get('tab') as Tab) ?? 'overview';
  // Commodities and crypto only have the overview and the workspace.
  const tab: Tab = asset && requestedTab !== 'workspace' ? 'overview' : requestedTab;
  // The profile comes from slow providers on a cold symbol, so it loads on its own and the page never waits for it.
  const { data: core, mutate } = useSWR<CompanyPayload>(`/api/company/${symbol}?lean=1`, { refreshInterval: 30_000 });
  // A quick first pass (description, identity) lands before the full one (forward P/E, 52-week range, dividend).
  const { data: quickProfile } = useSWR<{ profile: CompanyProfile | null }>(`/api/company/${symbol}/profile?fast=1`);
  // Asked for after the quick one so the two do not compete for the same provider slots.
  const { data: fullProfile } = useSWR<{ profile: CompanyProfile | null }>(quickProfile ? `/api/company/${symbol}/profile?lite=1` : null);
  const profile = fullProfile ? fullProfile.profile : (quickProfile?.profile ?? null);
  const data = useMemo(() => (core ? { ...core, profile } : undefined), [core, profile]);
  const { askAssistant, setAssistantContext } = useShell();

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    router.replace(`/company/${symbol}${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  const name = data?.security?.name ?? initial.name;
  // The live stream carries stock trades only; commodities and crypto refresh with the 30s quote.
  const streamed = useLivePrices(asset ? [] : [symbol])[symbol];
  const livePrice = streamed?.price ?? data?.quote?.price ?? data?.security?.price ?? initial.price;
  const change = streamed?.change ?? data?.quote?.change ?? data?.security?.change ?? null;
  const changePct = streamed?.changePct ?? data?.quote?.changePct ?? data?.security?.change_pct ?? initial.changePct;
  const extended = useExtendedQuotes([symbol])[symbol];
  const isBank = /bank|savings institution|thrift/i.test(`${data?.security?.industry ?? initial.industry ?? ''}`);

  // Feeds the sidebar's Recent list with the view you are on now, tab included, so it can be reopened as you left it.
  const tabQuery = searchParams.get('tab');
  useEffect(() => {
    if (active) pushRecentStock({ symbol, name, href: `/company/${symbol}${tabQuery ? `?tab=${encodeURIComponent(tabQuery)}` : ''}` });
  }, [active, symbol, name, tabQuery]);

  useEffect(() => {
    setAssistantContext({ type: 'company', symbol, name });
    return () => setAssistantContext({ type: 'general' });
  }, [setAssistantContext, symbol, name]);

  return (
    <div className="flex flex-col gap-4">
      <Panel className="relative overflow-hidden">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(ellipse_70%_90%_at_100%_0%,rgba(205,212,222,0.06),transparent_70%)]" />
        <div className="relative flex flex-wrap items-center gap-5 p-5">
          <ViewTransition name={`company-${symbol}`} share="morph" default="none">
            <div className="flex min-w-0 items-center gap-3.5">
              <CompanyLogo symbol={symbol} size="xl" className="shadow-[0_10px_30px_-12px_rgba(0,0,0,0.9)]" />
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[24px] font-semibold tracking-tight text-ink">{symbol}</span>
                  {data?.security?.exchange ? <Badge tone="outline">{data.security.exchange}</Badge> : null}
                  {initial.sector ?? data?.security?.sector ? <Badge>{initial.sector ?? data?.security?.sector}</Badge> : null}
                </div>
                <h1 className="mt-0.5 truncate text-[15px] text-ink-2">{name}</h1>
              </div>
            </div>
          </ViewTransition>
          <div className="flex items-center gap-3">
            <div className="text-[32px] leading-none font-semibold tracking-[-0.03em] text-ink">
              {/* Outside regular hours the stream carries extended trades: headline the regular close, extended move beside it. */}
              <AnimatedNumber value={extended ? extended.close : livePrice} from="near" format={(value) => price(value)} />
            </div>
            <div className="flex flex-col text-[13px]">
              <Delta value={extended ? extended.closeChange : change} kind="money" />
              <Delta value={extended ? extended.closeChangePct : changePct} alreadyPercent />
            </div>
            {extended ? (
              <div className="flex flex-col text-[11.5px]">
                <span className="text-muted">{extended.session === 'pre' ? 'Pre-market' : 'After hours'}</span>
                <ExtendedMove quote={extended} className="text-[12px] [&>span]:text-[12px]" />
              </div>
            ) : null}
          </div>
          <div className="text-[11px] text-faint">
            {streamed ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
                  </span>
                  Live
                </span>
                <br />
                {relativeTime(streamed.timestamp)}
              </>
            ) : data?.quote ? (
              <>
                {data.quote.realtime ? 'Real-time' : 'Delayed'}
                <br />
                {relativeTime(data.quote.timestamp)}
              </>
            ) : null}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {asset ? null : <ScoreRing score={data?.score?.overall ?? initial.score} size="md" label={data?.score?.label ?? initial.scoreLabel} subScores={data?.score?.sub_scores} confidence={data?.score?.confidence} />}
            <div className="flex flex-wrap gap-2">
              <WatchlistMenu symbol={symbol} lists={data?.watchlists ?? []} onChange={() => void mutate()} />
              <AlertButton symbol={symbol} price={livePrice} score={data?.score?.overall ?? null} />
              <TradeButton symbol={symbol} price={livePrice} />
              <Magnetic>
                <Button variant="primary" icon={<Sparkles className="size-3.5" />} onClick={() => askAssistant(
                      asset
                        ? `Give me a sharp overview of ${name} (${symbol}): what has driven the price lately, the key supply and demand factors, and the main debates.`
                        : `Give me a sharp overview of ${name} (${symbol}): what drives the business, the latest results, valuation vs peers, and the key debates.`,
                      { type: 'company', symbol, name },
                    )}>
                  Ask Grok
                </Button>
              </Magnetic>
            </div>
          </div>
        </div>
        <div className="relative border-t border-line px-3">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              ...(asset
                ? []
                : ([
                    { value: 'financials', label: 'Financials' },
                    { value: 'dcf', label: 'DCF' },
                    { value: 'comps', label: 'Comps' },
                    { value: 'score', label: 'Score' },
                    { value: 'peers', label: 'Peers' },
                    { value: 'news', label: 'News & filings' },
                    { value: 'insiders', label: 'Insiders & risks' },
                  ] as const)),
              { value: 'workspace', label: 'Workspace', badge: data?.workspace ? <span className="size-1.5 rounded-full bg-brand" /> : null },
            ]}
          />
        </div>
      </Panel>

      <div className={cn('min-h-[50vh]')}>
        {tab === 'overview' ? <Overview symbol={symbol} data={data ?? null} profile={profile} profileLoading={!fullProfile} descriptionLoading={!fullProfile && !quickProfile} onTab={setTab} /> : null}
        {tab === 'financials' ? <Financials symbol={symbol} isBank={isBank} /> : null}
        {tab === 'dcf' ? <DcfPanel symbol={symbol} /> : null}
        {tab === 'comps' ? <CompsTool key={`${symbol}:${searchParams.get('peers') ?? ''}`} initialSymbol={symbol} initialPeers={searchParams.get('peers')?.split(',').filter(Boolean)} /> : null}
        {tab === 'insiders' ? <InsidersPanel symbol={symbol} /> : null}
        {tab === 'score' ? <ScorePanel symbol={symbol} /> : null}
        {tab === 'peers' ? <PeersPanel symbol={symbol} /> : null}
        {tab === 'news' ? <NewsPanel symbol={symbol} name={name} /> : null}
        {tab === 'workspace' ? <CompanyWorkspace symbol={symbol} name={name} currentPrice={livePrice} /> : null}
      </div>
    </div>
  );
}

'use client';

import { ExternalLink } from 'lucide-react';
import useSWR from 'swr';

import { Delta } from '@/components/motion/delta';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/primitives';
import { ASSET_KIND_LABEL, getAsset } from '@/lib/data/assets';
import { compactNumber, pct, price, shortDate } from '@/lib/format';
import type { AssetDetails } from '@/lib/services/assets';

type Stat = { label: string; value: React.ReactNode };

function StatGrid({ stats, columns = 'sm:grid-cols-4' }: { stats: Stat[]; columns?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-x-6 gap-y-3 px-4 pb-4 ${columns}`}>
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0">
          <div className="text-[11px] text-muted">{stat.label}</div>
          <div className="num mt-0.5 truncate text-[14px] font-medium text-ink">{stat.value ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}

function RangeBar({ label, low, high, value }: { label: string; low: number | null; high: number | null; value: number | null }) {
  if (!low || !high || !value || high <= low) return null;
  const position = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return (
    <div className="border-t border-line px-4 py-3">
      <div className="mb-1.5 flex justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className="num">
          ${price(low)} — ${price(high)}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-white/5 via-white/10 to-white/5">
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-2 bg-brand shadow-[0_0_10px_rgba(205,212,222,0.48)]" style={{ left: `${position * 100}%` }} />
      </div>
    </div>
  );
}

/** A price with the day it was set underneath, so neither gets cut off in a narrow cell. */
function Dated({ value, date }: { value: number; date: string | number | null }) {
  return (
    <>
      ${price(value)}
      <span className="block text-[11px] font-normal text-faint">{shortDate(date)}</span>
    </>
  );
}

const usd = (value: number | null | undefined) => (value ? `$${price(value)}` : null);
const bigUsd = (value: number | null | undefined) => (value ? `$${compactNumber(value, 2)}` : null);

export function useAssetDetails(symbol: string) {
  return useSWR<AssetDetails>(`/api/company/${symbol}/asset`, { refreshInterval: 60_000 });
}

/** Today's trading, the 52-week range and, for crypto, the market's size. */
export function AssetMarketPanel({ symbol, livePrice }: { symbol: string; livePrice: number | null }) {
  const { data } = useAssetDetails(symbol);
  if (!data) return <Skeleton className="h-[188px] w-full" />;
  const market = data.market;
  const coin = data.coin;
  const stats: Stat[] = [
    { label: 'Day range', value: market?.dayLow && market.dayHigh ? `${price(market.dayLow)} – ${price(market.dayHigh)}` : null },
    data.kind === 'crypto'
      ? { label: 'Volume (24h)', value: bigUsd(coin?.volume24h ?? market?.volume) }
      : { label: 'Volume (contracts)', value: market?.volume ? market.volume.toLocaleString('en-US') : null },
    { label: '52-week high', value: usd(market?.high52) },
    { label: '52-week low', value: usd(market?.low52) },
  ];
  if (coin) {
    stats.push(
      { label: 'Market cap', value: bigUsd(coin.marketCap) },
      { label: 'Market-cap rank', value: coin.rank ? `#${coin.rank}` : null },
      { label: 'Fully diluted value', value: bigUsd(coin.fullyDiluted) },
      { label: 'Volume / market cap', value: coin.volume24h && coin.marketCap ? pct(coin.volume24h / coin.marketCap, 2) : null },
    );
  }
  return (
    <Panel>
      <PanelHeader kicker={market?.exchange && market.exchange !== 'CCC' ? `${market.exchange} · ${market.currency ?? 'USD'}` : (market?.currency ?? 'USD')} title="Market" />
      <StatGrid stats={stats} />
      <RangeBar label="52-week range" low={market?.low52 ?? null} high={market?.high52 ?? null} value={livePrice} />
    </Panel>
  );
}

/** Returns across horizons, plus how bumpy the ride has been. */
export function AssetPerformancePanel({ symbol }: { symbol: string }) {
  const { data } = useAssetDetails(symbol);
  if (!data) return <Skeleton className="h-[176px] w-full" />;
  const shown = data.performance.filter((period) => period.value !== null);
  const years = data.historyYears && data.historyYears >= 1.5 ? `${Math.round(data.historyYears)}-year` : '1-year';
  return (
    <Panel>
      <PanelHeader kicker="Daily closes" title="Performance" />
      <div className="grid grid-cols-4 gap-px overflow-hidden border-y border-line bg-line sm:grid-cols-8">
        {shown.map((period) => (
          <div key={period.label} className="bg-surface-2 px-3 py-2.5">
            <div className="text-[10.5px] text-faint">{period.label}</div>
            <Delta value={period.value} digits={1} className="mt-0.5 text-[13px]" />
          </div>
        ))}
      </div>
      <div className="pt-3">
        <StatGrid
          stats={[
            { label: 'Volatility (30d, annualized)', value: data.volatility30d !== null ? pct(data.volatility30d) : null },
            { label: 'Max drawdown (1Y)', value: data.maxDrawdown1y !== null ? pct(data.maxDrawdown1y) : null },
            { label: `${years} high`, value: data.historyHigh ? <Dated value={data.historyHigh.price} date={data.historyHigh.t} /> : null },
            { label: `${years} low`, value: data.historyLow ? <Dated value={data.historyLow.price} date={data.historyLow.t} /> : null },
          ]}
        />
      </div>
    </Panel>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] text-faint">{label}</div>
      <div className="truncate text-ink-2">{children}</div>
    </div>
  );
}

/** What the asset is and how it trades: contract terms for futures, network facts for crypto. */
export function AssetAboutPanel({ symbol }: { symbol: string }) {
  const asset = getAsset(symbol);
  const { data } = useAssetDetails(symbol);
  if (!asset) return null;
  const coin = data?.coin ?? null;
  const description = coin?.description ?? asset.description;
  return (
    <Panel>
      <PanelHeader kicker={ASSET_KIND_LABEL[asset.kind]} title={`About ${asset.name}`} />
      <div className="px-4 pb-4">
        {!data && asset.kind === 'crypto' ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : (
          <p className="line-clamp-[10] text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{description}</p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          {data?.contract ? (
            <>
              <Detail label="Exchange">{data.market?.exchange ?? '—'}</Detail>
              <Detail label="Front contract">{data.market?.contract ?? '—'}</Detail>
              <Detail label="Contract size">{data.contract.size}</Detail>
              <Detail label="Tick">{data.contract.tick}</Detail>
              <div className="col-span-2">
                <Detail label="Trading hours">{data.contract.hours}</Detail>
              </div>
            </>
          ) : null}
          {coin ? (
            <>
              {coin.launched ? <Detail label="Launched">{shortDate(coin.launched)}</Detail> : null}
              {coin.algorithm ? <Detail label="Consensus / hashing">{coin.algorithm}</Detail> : null}
              <Detail label="Trading">24/7</Detail>
              <Detail label="Quoted in">USD</Detail>
            </>
          ) : null}
        </div>
        {coin?.website || coin?.whitepaper ? (
          <div className="mt-3 flex flex-wrap gap-4">
            {coin.website ? (
              <a href={coin.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand-soft hover:underline">
                {coin.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} <ExternalLink className="size-3" />
              </a>
            ) : null}
            {coin.whitepaper ? (
              <a href={coin.whitepaper} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand-soft hover:underline">
                Whitepaper <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** Crypto only: how much of the supply exists, and the all-time extremes. */
export function AssetSupplyPanel({ symbol, livePrice }: { symbol: string; livePrice: number | null }) {
  const { data } = useAssetDetails(symbol);
  const coin = data?.coin;
  if (!coin) return null;
  const ticker = symbol.replace(/-USD$/, '');
  const issued = coin.circulatingSupply && coin.maxSupply ? coin.circulatingSupply / coin.maxSupply : null;
  return (
    <Panel>
      <PanelHeader kicker="CoinGecko" title="Supply & records" />
      <StatGrid
        columns="sm:grid-cols-2"
        stats={[
          { label: 'Circulating supply', value: coin.circulatingSupply ? `${compactNumber(coin.circulatingSupply, 2)} ${ticker}` : null },
          { label: 'Max supply', value: coin.maxSupply ? `${compactNumber(coin.maxSupply, 2)} ${ticker}` : 'No cap' },
          { label: 'All-time high', value: coin.allTimeHigh ? <Dated value={coin.allTimeHigh} date={coin.allTimeHighDate} /> : null },
          { label: 'From all-time high', value: coin.allTimeHigh && livePrice ? <Delta value={livePrice / coin.allTimeHigh - 1} digits={1} className="text-[14px]" /> : null },
          { label: 'All-time low', value: coin.allTimeLow ? <Dated value={coin.allTimeLow} date={coin.allTimeLowDate} /> : null },
          { label: 'Total supply', value: coin.totalSupply ? `${compactNumber(coin.totalSupply, 2)} ${ticker}` : null },
        ]}
      />
      {issued !== null ? (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1.5 flex justify-between text-[11px] text-muted">
            <span>Issued so far</span>
            <span className="num">{pct(issued, 1)} of max supply</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-brand" style={{ width: `${issued * 100}%` }} />
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

import { Delta } from '@/components/motion/delta';
import { donutSlices, ShareDonut, ShareLegend, ShareLineChart } from '@/components/portfolio/share/share-charts';
import { ShareLogo } from '@/components/portfolio/share/share-logo';
import { Panel, PanelHeader } from '@/components/ui/primitives';
import { StatTile } from '@/components/ui/stat-tile';
import { money, pct, shortDate, signedPct } from '@/lib/format';
import { NEUTRAL_COLORS, sliceColorMap } from '@/lib/share/colors';
import { SCALED_BASE } from '@/lib/share/options';
import { weightLabel, type ShareHoldingRow, type ShareView } from '@/lib/share/view';
import { cn } from '@/lib/utils';

function benchmarkName(symbol: string) {
  return symbol === 'SPY' ? 'S&P 500' : symbol;
}

/** The read-only portfolio page: what the public link shows, and what the in-app preview shows before a link exists. */
export function SharedPortfolio({ view, message, logoSrc }: { view: ShareView; message?: string | null; logoSrc?: (symbol: string) => string }) {
  const { totals, performance, sections } = view;
  const scaled = view.amounts === 'scaled';
  const hasAllocation = sections.allocation && view.allocation.length > 0;
  const hasSectors = sections.sectors && view.sectors.length > 0;
  const hasHoldings = sections.holdings && view.holdings.length > 0;
  const largest = donutSlices(view.allocation)[0];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="bg-gradient-to-b from-white to-ink-2 bg-clip-text text-[26px] font-semibold tracking-[-0.025em] text-transparent">{view.title}</h1>
        {view.owner ? <p className="mt-0.5 text-[13px] text-muted">by {view.owner}</p> : null}
        {message ? <p className="mt-3 max-w-2xl border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink-2">{message}</p> : null}
      </div>

      <Panel className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_120%_at_0%_0%,rgba(205,212,222,0.06),transparent_60%)]" />
        <div className="relative grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
          <div>
            <div className="kicker">{totals.value !== null ? (scaled ? `Model portfolio · ${money(SCALED_BASE, { digits: 0 })}` : 'Portfolio value') : 'Total gain'}</div>
            <div className="num mt-2 text-[44px] leading-none font-semibold tracking-[-0.035em] text-ink">
              {totals.value !== null ? money(totals.value, { digits: 0 }) : totals.gainPct !== null ? <Delta value={totals.gainPct} digits={1} className="text-[44px] tracking-[-0.035em]" /> : <span className="text-[22px] text-muted">Allocation only</span>}
            </div>
            {totals.dayChangePct !== null ? (
              <div className="mt-2 flex items-center gap-2 text-[13px]">
                <span className="text-muted">Today</span>
                {totals.dayChange !== null ? <Delta value={totals.dayChange} kind="money" digits={0} /> : null}
                <Delta value={totals.dayChangePct} className="text-[12px]" />
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 self-end sm:grid-cols-3">
            {totals.gainPct !== null && totals.value !== null ? <StatTile label="Total gain" value={<Delta value={totals.gainPct} digits={1} className="text-[17px]" />} sub={totals.gain !== null ? <Delta value={totals.gain} kind="money" digits={0} className="text-[11.5px]" /> : undefined} /> : null}
            {performance ? <StatTile label={`${performance.range} return`} value={<Delta value={performance.portfolioReturn} digits={1} className="text-[17px]" />} sub={<span className="text-muted">{benchmarkName(performance.benchmark)} {signedPct(performance.benchmarkReturn, 1)}</span>} /> : null}
            {totals.positions !== null ? <StatTile label="Positions" value={totals.positions} /> : null}
            {totals.cashWeight !== null ? <StatTile label="Cash" value={weightLabel(totals.cashWeight)} /> : null}
          </div>
        </div>
      </Panel>

      {performance ? (
        <Panel>
          <PanelHeader
            kicker={`${performance.range} · time-weighted, indexed to 100`}
            title="Performance"
            actions={
              <div className="flex items-center gap-3 text-[11.5px]">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <span className="h-0.5 w-3 rounded-full bg-brand-bright" /> Portfolio <Delta value={performance.portfolioReturn} digits={1} className="text-[11.5px]" />
                </span>
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="h-0 w-3 border-t border-dashed border-[#7c8695]" /> {benchmarkName(performance.benchmark)} <Delta value={performance.benchmarkReturn} digits={1} className="text-[11.5px]" />
                </span>
              </div>
            }
          />
          <div className="px-4 pb-3">
            <ShareLineChart performance={performance} />
            <div className="mt-1 flex justify-between text-[10.5px] text-faint">
              <span>{shortDate(performance.points[0].t)}</span>
              <span>{shortDate(performance.points[performance.points.length - 1].t)}</span>
            </div>
          </div>
        </Panel>
      ) : null}

      {hasAllocation || hasSectors ? (
        <div className={cn('grid gap-4', hasAllocation && hasSectors && 'lg:grid-cols-2')}>
          {hasAllocation ? (
            <Panel>
              <PanelHeader kicker={view.allocation.some((slice) => slice.kind === 'sector') ? 'By sector' : 'By holding'} title="Allocation" />
              <div className="flex flex-wrap items-center gap-6 px-4 pb-4">
                <ShareDonut slices={view.allocation} centerValue={pct(largest.weight, 0)} centerLabel={largest.label} />
                <div className="min-w-44 flex-1">
                  <ShareLegend slices={view.allocation} logoSrc={logoSrc} />
                </div>
              </div>
            </Panel>
          ) : null}
          {hasSectors ? (
            <Panel>
              <PanelHeader kicker="Exposure" title="Sectors" />
              <div className="flex flex-col gap-2 px-4 pb-4">
                {view.sectors.slice(0, 9).map((row) => (
                  <div key={row.sector} className="grid grid-cols-[minmax(80px,140px)_1fr_48px] items-center gap-3">
                    <span className="truncate text-[12px] text-ink-2">{row.sector}</span>
                    <div className="h-2.5 rounded-r-[4px] bg-white/[0.04]">
                      <div className="h-full rounded-r-[4px]" style={{ width: `${Math.min(100, row.weight * 100)}%`, background: row.sector === 'Cash' ? '#5d6470' : '#cdd4de', opacity: row.sector === 'Cash' ? 1 : 0.45 + row.weight * 0.55 }} />
                    </div>
                    <span className="num text-right text-[11.5px] text-ink">{weightLabel(row.weight)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {hasHoldings ? <HoldingsTable rows={view.holdings} colors={sliceColorMap(view.allocation)} logoSrc={logoSrc} /> : null}
    </div>
  );
}

function HoldingsTable({ rows, colors, logoSrc }: { rows: ShareHoldingRow[]; colors: Map<string, string>; logoSrc?: (symbol: string) => string }) {
  const showValue = rows.some((row) => row.value !== null);
  const showShares = rows.some((row) => row.shares !== null);
  const showDay = rows.some((row) => row.dayChangePct !== null);
  const showReturn = rows.some((row) => row.returnPct !== null);
  const showGain = rows.some((row) => row.gain !== null);
  return (
    <Panel>
      <PanelHeader kicker="Ranked by weight" title="Holdings" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12.5px]">
          <thead>
            <tr className="border-y border-line bg-surface-1 text-left text-[11px] text-muted">
              <th className="px-4 py-2 font-medium">Holding</th>
              <th className="px-3 py-2 font-medium">Weight</th>
              {showShares ? <th className="px-3 py-2 text-right font-medium">Shares</th> : null}
              {showValue ? <th className="px-3 py-2 text-right font-medium">Value</th> : null}
              {showDay ? <th className="px-3 py-2 text-right font-medium">Today</th> : null}
              {showReturn ? <th className="px-3 py-2 text-right font-medium">Return</th> : null}
              {showGain ? <th className="px-4 py-2 text-right font-medium">Gain</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const color = (row.symbol && colors.get(row.symbol)) || NEUTRAL_COLORS.other;
              return (
              <tr key={row.symbol ?? 'other'} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {row.symbol ? (
                      <ShareLogo symbol={row.symbol} color={color} src={logoSrc?.(row.symbol)} size={22} />
                    ) : (
                      <span className="grid size-[22px] shrink-0 place-items-center rounded-[6px] bg-surface-4 font-mono text-[10px] text-ink-2" style={{ boxShadow: `0 0 0 1.5px ${color}` }} aria-hidden>+</span>
                    )}
                    {row.symbol ? <span className="w-12 shrink-0 font-mono text-[12px] font-semibold text-ink">{row.symbol}</span> : null}
                    <span className={cn('max-w-48 truncate text-[11.5px]', row.symbol ? 'text-muted' : 'text-ink-2')}>{row.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-14 rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, row.weight * 100)}%`, background: color }} />
                    </div>
                    <span className="num text-[11px] text-muted">{weightLabel(row.weight)}</span>
                  </div>
                </td>
                {showShares ? <td className="num px-3 py-2 text-right text-ink-2">{row.shares !== null ? row.shares.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}</td> : null}
                {showValue ? <td className="num px-3 py-2 text-right text-ink">{money(row.value, { digits: 0 })}</td> : null}
                {showDay ? <td className="px-3 py-2 text-right"><Delta value={row.dayChangePct} className="text-[11.5px]" /></td> : null}
                {showReturn ? <td className="px-3 py-2 text-right"><Delta value={row.returnPct} digits={1} className="text-[11.5px]" /></td> : null}
                {showGain ? <td className="px-4 py-2 text-right"><Delta value={row.gain} kind="money" digits={0} className="text-[11.5px]" /></td> : null}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

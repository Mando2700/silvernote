'use client';

import { Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Delta } from '@/components/motion/delta';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, EmptyState, Panel, Segmented, Select } from '@/components/ui/primitives';
import { StatTile } from '@/components/ui/stat-tile';
import { api } from '@/lib/client';
import { realizedBySale } from '@/lib/finance/positions';
import { price, shortDate } from '@/lib/format';
import { MASK, useMoney, useQuantity } from '@/lib/privacy';

export type Transaction = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fees: number;
  traded_at: string;
  created_at?: string | null;
  note: string | null;
  split_factor?: number;
  kind?: 'trade' | 'opening' | 'removal';
};

type Side = 'all' | 'buy' | 'sell';
type View = 'trades' | 'assets';

type AssetSummary = {
  symbol: string;
  trades: number;
  boughtShares: number;
  bought: number;
  soldShares: number;
  proceeds: number;
  soldCost: number;
  fees: number;
  realized: number;
  open: boolean;
};

/** "10-for-1" for a factor of 10, "1-for-10" for a reverse split. */
function splitLabel(factor: number) {
  const round = (value: number) => Number(value.toFixed(3)).toString();
  return factor >= 1 ? `${round(factor)}-for-1` : `1-for-${round(1 / factor)}`;
}

/** Cash out for a buy (with fees), cash in for a sell (net of fees). */
function amountOf(tx: Transaction) {
  return tx.quantity * tx.price + (tx.side === 'buy' ? tx.fees : -tx.fees);
}

export function TransactionsPanel({ portfolioId, transactions, onChanged, onAddTrade }: { portfolioId: string; transactions: Transaction[]; onChanged: () => void; onAddTrade: () => void }) {
  const { money, hidden } = useMoney();
  const quantity = useQuantity();
  const [side, setSide] = useState<Side>('all');
  const [symbol, setSymbol] = useState('');
  const [year, setYear] = useState('');
  const [view, setView] = useState<View>('trades');

  const sales = useMemo(() => realizedBySale(transactions), [transactions]);
  const symbols = useMemo(() => [...new Set(transactions.map((tx) => tx.symbol))].sort(), [transactions]);
  const years = useMemo(() => [...new Set(transactions.map((tx) => tx.traded_at.slice(0, 4)))].sort().reverse(), [transactions]);
  /** Symbols still held after the whole ledger, so closed positions can be told apart. */
  const openSymbols = useMemo(() => {
    const shares = new Map<string, number>();
    for (const tx of transactions) shares.set(tx.symbol, (shares.get(tx.symbol) ?? 0) + (tx.side === 'buy' ? tx.quantity : -tx.quantity));
    return new Set([...shares].filter(([, held]) => held > 1e-6).map(([value]) => value));
  }, [transactions]);

  const filtered = useMemo(
    () => transactions.filter((tx) => (side === 'all' || tx.side === side) && (!symbol || tx.symbol === symbol) && (!year || tx.traded_at.startsWith(year))),
    [transactions, side, symbol, year],
  );

  const totals = useMemo(() => {
    let bought = 0;
    let proceeds = 0;
    let soldCost = 0;
    let fees = 0;
    let realized = 0;
    let buys = 0;
    let sells = 0;
    let wins = 0;
    for (const tx of filtered) {
      fees += tx.fees;
      if (tx.side === 'buy') {
        buys += 1;
        bought += amountOf(tx);
        continue;
      }
      const sale = sales.get(tx.id);
      if (!sale) continue; // Removals: shares out, no sale.
      sells += 1;
      proceeds += amountOf(tx);
      soldCost += sale.costBasis;
      realized += sale.realized;
      if (sale.realized > 0) wins += 1;
    }
    return { bought, proceeds, soldCost, fees, realized, buys, sells, wins, net: proceeds - bought };
  }, [filtered, sales]);

  const assets = useMemo(() => {
    const bySymbol = new Map<string, AssetSummary>();
    for (const tx of filtered) {
      const row = bySymbol.get(tx.symbol) ?? { symbol: tx.symbol, trades: 0, boughtShares: 0, bought: 0, soldShares: 0, proceeds: 0, soldCost: 0, fees: 0, realized: 0, open: openSymbols.has(tx.symbol) };
      row.trades += 1;
      row.fees += tx.fees;
      if (tx.side === 'buy') {
        row.boughtShares += tx.quantity;
        row.bought += amountOf(tx);
      } else {
        const sale = sales.get(tx.id);
        if (sale) {
          row.soldShares += tx.quantity;
          row.proceeds += amountOf(tx);
          row.soldCost += sale.costBasis;
          row.realized += sale.realized;
        }
      }
      bySymbol.set(tx.symbol, row);
    }
    return [...bySymbol.values()].sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized) || b.bought - a.bought);
  }, [filtered, sales, openSymbols]);

  if (!transactions.length) {
    return (
      <Panel>
        <EmptyState title="No trades yet" action={<Button variant="primary" onClick={onAddTrade}>Add trade</Button>} />
      </Panel>
    );
  }

  const filteredActive = side !== 'all' || symbol || year;
  const realizedPct = totals.soldCost > 0 ? totals.realized / totals.soldCost : null;

  async function remove(tx: Transaction) {
    if (!window.confirm('Delete this trade? Holdings and P&L are recalculated.')) return;
    try {
      await api(`/api/portfolios/${portfolioId}/transactions?id=${tx.id}`, { method: 'DELETE' });
      onChanged();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="grid gap-3">
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Segmented
            size="xs"
            value={side}
            onChange={setSide}
            options={[
              { value: 'all', label: 'All' },
              { value: 'buy', label: 'Buys' },
              { value: 'sell', label: 'Sells' },
            ]}
          />
          <Select aria-label="Asset" value={symbol} onChange={(event) => setSymbol(event.target.value)} className="w-36">
            <option value="">All assets</option>
            {symbols.map((value) => (
              <option key={value} value={value}>
                {value}
                {openSymbols.has(value) ? '' : ' (closed)'}
              </option>
            ))}
          </Select>
          <Select aria-label="Year" value={year} onChange={(event) => setYear(event.target.value)} className="w-28">
            <option value="">All time</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          {filteredActive ? (
            <button
              onClick={() => {
                setSide('all');
                setSymbol('');
                setYear('');
              }}
              className="flex items-center gap-1 rounded-xs px-1.5 py-1 text-[11.5px] text-muted hover:bg-white/5 hover:text-ink"
            >
              <X className="size-3" />
              Clear
            </button>
          ) : null}
          <div className="ml-auto">
            <Segmented
              size="xs"
              value={view}
              onChange={setView}
              options={[
                { value: 'trades', label: `Trades (${filtered.length})` },
                { value: 'assets', label: `By asset (${assets.length})` },
              ]}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Bought" value={money(totals.bought, { digits: 0 })} sub={<span className="text-muted">{totals.buys} buys, incl. fees</span>} />
          <StatTile label="Sold" value={money(totals.proceeds, { digits: 0 })} sub={<span className="text-muted">{totals.sells} sells, net of fees</span>} />
          <StatTile
            label="Realized P&L"
            hint="Average cost, matching the Holdings tab. The Tax tab shows the same sells lot by lot."
            value={<Delta value={totals.sells ? totals.realized : null} kind="money" digits={0} sensitive className="text-[17px]" />}
            sub={<Delta value={realizedPct} className="text-[11.5px]" />}
          />
          <StatTile label="Cost of shares sold" value={money(totals.soldCost, { digits: 0 })} />
          <StatTile label="Win rate" hint="Share of sells closed at a profit." value={totals.sells ? `${Math.round((totals.wins / totals.sells) * 100)}%` : '—'} sub={totals.sells ? <span className="text-muted">{totals.wins} of {totals.sells} sells</span> : undefined} />
          <StatTile label="Fees" value={money(totals.fees, { digits: 2 })} sub={<span className="text-muted">Net cash {hidden ? MASK : money(totals.net, { digits: 0 })}</span>} />
        </div>
      </Panel>

      <Panel>
        {!filtered.length ? (
          <EmptyState title="No trades match these filters" />
        ) : view === 'trades' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-1 text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 text-right font-medium">Shares</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Fees</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Realized</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx) => {
                  const sale = tx.side === 'sell' ? sales.get(tx.id) : undefined;
                  return (
                    <tr key={tx.id} className="border-b border-line">
                      <td className="px-4 py-2 text-ink-2">{shortDate(tx.traded_at)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={tx.side === 'buy' ? 'gain' : 'loss'}>{tx.side.toUpperCase()}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/company/${tx.symbol}`} className="flex items-center gap-2 font-mono text-[12px] font-semibold text-ink hover:text-white">
                          <CompanyLogo symbol={tx.symbol} size="xs" />
                          {tx.symbol}
                        </Link>
                      </td>
                      <td className="num px-3 py-2 text-right text-ink-2">
                        {quantity(tx.quantity)}
                        {tx.split_factor && tx.split_factor !== 1 ? (
                          <div className="text-[10.5px] text-faint" title="Restated in today's shares for stock splits since the trade">
                            {quantity(tx.quantity / tx.split_factor)} before {splitLabel(tx.split_factor)} split
                          </div>
                        ) : null}
                        {tx.kind === 'opening' ? <div className="text-[10.5px] text-faint">Opening balance</div> : null}
                        {tx.kind === 'removal' ? <div className="text-[10.5px] text-faint">Balancing removal</div> : null}
                      </td>
                      <td className="num px-3 py-2 text-right text-ink-2">{price(tx.price)}</td>
                      <td className="num px-3 py-2 text-right text-muted">{tx.fees ? (hidden ? MASK : price(tx.fees)) : '—'}</td>
                      <td className="num px-3 py-2 text-right text-ink">{money(amountOf(tx), { digits: 2 })}</td>
                      <td className="num px-3 py-2 text-right">{sale ? <Delta value={sale.realized} kind="money" digits={2} sensitive /> : <span className="text-faint">—</span>}</td>
                      <td className="px-3 py-2 text-right">
                        {tx.id.startsWith('balance:') ? null : (
                          <button onClick={() => void remove(tx)} className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink" aria-label="Delete trade">
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-1 text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 text-right font-medium">Trades</th>
                  <th className="px-3 py-2 text-right font-medium">Shares bought</th>
                  <th className="px-3 py-2 text-right font-medium">Avg buy</th>
                  <th className="px-3 py-2 text-right font-medium">Bought</th>
                  <th className="px-3 py-2 text-right font-medium">Shares sold</th>
                  <th className="px-3 py-2 text-right font-medium">Avg sell</th>
                  <th className="px-3 py-2 text-right font-medium">Sold</th>
                  <th className="px-3 py-2 text-right font-medium">Fees</th>
                  <th className="px-3 py-2 text-right font-medium">Realized P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((row) => (
                  <tr
                    key={row.symbol}
                    onClick={() => {
                      setSymbol(row.symbol);
                      setView('trades');
                    }}
                    className="cursor-pointer border-b border-line hover:bg-white/[0.02]"
                    title={`Show ${row.symbol} trades`}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 font-mono text-[12px] font-semibold text-ink">
                        <CompanyLogo symbol={row.symbol} size="xs" />
                        {row.symbol}
                        {row.open ? null : <Badge tone="outline">Closed</Badge>}
                      </div>
                    </td>
                    <td className="num px-3 py-2 text-right text-ink-2">{row.trades}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{row.boughtShares ? quantity(row.boughtShares) : '—'}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{row.boughtShares ? price(row.bought / row.boughtShares) : '—'}</td>
                    <td className="num px-3 py-2 text-right text-ink">{row.bought ? money(row.bought, { digits: 0 }) : '—'}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{row.soldShares ? quantity(row.soldShares) : '—'}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{row.soldShares ? price(row.proceeds / row.soldShares) : '—'}</td>
                    <td className="num px-3 py-2 text-right text-ink">{row.proceeds ? money(row.proceeds, { digits: 0 }) : '—'}</td>
                    <td className="num px-3 py-2 text-right text-muted">{row.fees ? money(row.fees, { digits: 2 }) : '—'}</td>
                    <td className="num px-3 py-2 text-right">
                      {row.soldShares ? (
                        <>
                          <Delta value={row.realized} kind="money" digits={0} sensitive />
                          <div className="text-[10.5px]">
                            <Delta value={row.soldCost > 0 ? row.realized / row.soldCost : null} />
                          </div>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

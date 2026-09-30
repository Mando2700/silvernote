'use client';

import { Scale, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Button, IconButton } from '@/components/ui/button';
import { Field, Input, Panel, PanelHeader, Skeleton, Stat, Switch } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { api } from '@/lib/client';
import { money, pct, price } from '@/lib/format';
import { cn } from '@/lib/utils';

type Plan = {
  total: number;
  trades: Array<{ symbol: string; currentWeight: number; targetWeight: number; currentValue: number; targetValue: number; tradeValue: number; shares: number; price: number | null }>;
  cashAfter: number;
  targetCashWeight: number;
  turnover: number;
  targets: Record<string, number>;
};

/** Target weights per holding and the trades that get there (nothing is traded; it's a plan). */
export function RebalancePanel({ portfolioId, holdings }: { portfolioId: string; holdings: Array<{ symbol: string; weight: number }> }) {
  const { data: stored, mutate } = useSWR<{ targets: Record<string, number> }>(`/api/portfolios/${portfolioId}/targets`);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [addCash, setAddCash] = useState('');
  const [fractional, setFractional] = useState(false);
  const [sellOthers, setSellOthers] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  if (!stored) return <Skeleton className="h-64" />;
  // Start from saved targets, else today's weights, so "no change" is the default plan.
  const initial: Record<string, string> = Object.keys(stored.targets).length
    ? Object.fromEntries(Object.entries(stored.targets).map(([symbol, weight]) => [symbol, (weight * 100).toFixed(1)]))
    : Object.fromEntries(holdings.map((holding) => [holding.symbol, (holding.weight * 100).toFixed(1)]));
  const values = draft ?? initial;
  const targets = Object.fromEntries(Object.entries(values).map(([symbol, value]) => [symbol, Math.max(0, Number(value) || 0) / 100]));
  const sum = Object.values(targets).reduce((total, weight) => total + weight, 0);

  const compute = async () => {
    setBusy(true);
    try {
      setPlan(await api<Plan>(`/api/portfolios/${portfolioId}/rebalance`, { body: { targets, addCash: Number(addCash) || 0, fractional, sellUntargeted: sellOthers, minTrade: 1 } }));
    } finally {
      setBusy(false);
    }
  };
  const saveTargets = async () => {
    await api(`/api/portfolios/${portfolioId}/targets`, { method: 'PUT', body: { targets } });
    await mutate();
    toast.success('Target weights saved');
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Panel>
        <PanelHeader kicker="Percent of total value" title="Target weights" actions={<Button size="xs" variant="outline" onClick={() => void saveTargets()} disabled={sum > 1.0001}>Save</Button>} />
        <div className="flex flex-col gap-1.5 px-4 pb-4">
          {Object.entries(values).map(([symbol, value]) => (
            <div key={symbol} className="flex items-center gap-2">
              <span className="w-16 font-mono text-[12px] font-semibold text-ink">{symbol}</span>
              <span className="num w-14 text-right text-[11px] text-muted">{pct(holdings.find((holding) => holding.symbol === symbol)?.weight ?? 0)}</span>
              <Input className="h-7 w-20 text-right" inputMode="decimal" value={value} onChange={(event) => setDraft({ ...values, [symbol]: event.target.value })} />
              <span className="text-[11px] text-muted">%</span>
              <IconButton label={`Remove ${symbol}`} size="xs" onClick={() => setDraft(Object.fromEntries(Object.entries(values).filter(([key]) => key !== symbol)))}>
                <Trash2 className="size-3" />
              </IconButton>
            </div>
          ))}
          <TickerSearch onPick={(symbol) => setDraft({ ...values, [symbol]: values[symbol] ?? '0' })} placeholder="Add a new position…" className="mt-1" />
          <div className={cn('mt-2 flex justify-between text-[12px]', sum > 1.0001 ? 'text-loss' : 'text-muted')}>
            <span>Total</span>
            <span className="num">
              {pct(sum)} · cash {pct(Math.max(0, 1 - sum))}
            </span>
          </div>
          <Field label="Add or withdraw cash ($)" className="mt-2">
            <Input inputMode="decimal" placeholder="0" value={addCash} onChange={(event) => setAddCash(event.target.value)} />
          </Field>
          <label className="mt-1 flex items-center justify-between text-[12px] text-ink-2">
            Fractional shares <Switch checked={fractional} onChange={setFractional} label="Fractional shares" />
          </label>
          <label className="flex items-center justify-between text-[12px] text-ink-2">
            Sell holdings without a target <Switch checked={sellOthers} onChange={setSellOthers} label="Sell untargeted" />
          </label>
          <Button variant="primary" className="mt-2" icon={<Scale className="size-3.5" />} loading={busy} disabled={sum > 1.0001} onClick={() => void compute()}>
            Plan trades
          </Button>
        </div>
      </Panel>
      <Panel>
        <PanelHeader kicker="Nothing is traded — place these with your broker" title="Rebalancing plan" />
        {plan ? (
          <>
            <div className="grid grid-cols-2 gap-4 px-4 pb-3 sm:grid-cols-4">
              <Stat label="Total after cash flow" value={money(plan.total, { digits: 0 })} />
              <Stat label="Buys" value={money(plan.trades.filter((trade) => trade.tradeValue > 0).reduce((sum, trade) => sum + trade.tradeValue, 0), { digits: 0 })} />
              <Stat label="Sells" value={money(-plan.trades.filter((trade) => trade.tradeValue < 0).reduce((sum, trade) => sum + trade.tradeValue, 0), { digits: 0 })} />
              <Stat label="Cash after" value={money(plan.cashAfter, { digits: 0 })} sub={<span className="text-muted">turnover {pct(plan.turnover)}</span>} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[12.5px]">
                <thead>
                  <tr className="border-y border-line text-left text-[11px] text-muted">
                    <th className="px-4 py-2 font-medium">Symbol</th>
                    <th className="px-2 py-2 text-right font-medium">Now → target</th>
                    <th className="px-2 py-2 text-right font-medium">Price</th>
                    <th className="px-2 py-2 text-right font-medium">Shares</th>
                    <th className="px-4 py-2 text-right font-medium">Trade</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.trades.map((trade) => (
                    <tr key={trade.symbol} className="border-b border-line">
                      <td className="px-4 py-1.5 font-mono font-semibold">{trade.symbol}</td>
                      <td className="num px-2 py-1.5 text-right text-muted">
                        {pct(trade.currentWeight)} → {pct(trade.targetWeight)}
                      </td>
                      <td className="num px-2 py-1.5 text-right">{price(trade.price)}</td>
                      <td className={cn('num px-2 py-1.5 text-right', trade.shares > 0 ? 'text-gain' : trade.shares < 0 ? 'text-loss' : 'text-muted')}>
                        {trade.shares ? `${trade.shares > 0 ? 'Buy' : 'Sell'} ${Math.abs(trade.shares).toLocaleString('en-US', { maximumFractionDigits: 4 })}` : 'Hold'}
                      </td>
                      <td className="num px-4 py-1.5 text-right">{trade.tradeValue ? money(trade.tradeValue, { digits: 0 }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="px-4 pb-5 text-[12.5px] text-muted">Set target weights (they start at today&apos;s weights), optionally add new money, then plan the trades. Whole shares round toward doing less.</p>
        )}
      </Panel>
    </div>
  );
}

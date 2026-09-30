'use client';

import { Bell, Check, Eye, Plus, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Modal, Menu } from '@/components/ui/overlay';
import { Field, Input, Segmented, Select } from '@/components/ui/primitives';
import { localToday } from '@/lib/dates';
import { api, revalidate } from '@/lib/client';
import { relativeTime } from '@/lib/format';

export function WatchlistMenu({ symbol, lists, onChange }: { symbol: string; lists: Array<{ id: string; name: string; member: boolean }>; onChange: () => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const inAny = lists.some((list) => list.member);

  const toggle = async (list: { id: string; name: string; member: boolean }) => {
    if (list.member) {
      await api(`/api/watchlists/${list.id}/items?symbol=${symbol}`, { method: 'DELETE' });
      toast(`${symbol} removed from ${list.name}`);
    } else {
      await api(`/api/watchlists/${list.id}/items`, { body: { symbol } });
      toast.success(`${symbol} added to ${list.name}`);
    }
    onChange();
    void revalidate('/api/watchlists', '/api/dashboard');
  };

  const create = async () => {
    if (!name.trim()) return;
    const list = await api<{ id: string; name: string }>('/api/watchlists', { body: { name: name.trim() } });
    await api(`/api/watchlists/${list.id}/items`, { body: { symbol } });
    toast.success(`Created ${list.name} with ${symbol}`);
    setCreating(false);
    setName('');
    onChange();
    void revalidate('/api/watchlists', '/api/dashboard');
  };

  return (
    <>
      <Menu
        trigger={({ toggle: open }) => (
          <Button variant={inAny ? 'secondary' : 'outline'} icon={inAny ? <Check className="size-3.5 text-brand" /> : <Eye className="size-3.5" />} onClick={open}>
            {inAny ? 'Watching' : 'Watch'}
          </Button>
        )}
        items={[
          ...lists.map((list) => ({
            label: list.name,
            icon: list.member ? <Check className="size-3.5 text-brand" /> : <span className="size-3.5" />,
            onSelect: () => void toggle(list),
          })),
          ...(lists.length ? (['separator'] as const) : []),
          { label: 'New watchlist…', icon: <Plus className="size-3.5" />, onSelect: () => setCreating(true) },
        ]}
      />
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New watchlist"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void create()}>
              Create and add {symbol}
            </Button>
          </>
        }
      >
        <Field label="Name">
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Compounders, Special situations" onKeyDown={(event) => event.key === 'Enter' && void create()} />
        </Field>
      </Modal>
    </>
  );
}

const ALERT_KINDS = [
  { value: 'price_above', label: 'Price rises above', unit: '$' },
  { value: 'price_below', label: 'Price falls below', unit: '$' },
  { value: 'change_pct', label: 'Daily move exceeds', unit: '%' },
  { value: 'score_above', label: 'Score rises to', unit: 'pts' },
  { value: 'score_below', label: 'Score falls to', unit: 'pts' },
  { value: 'score_change', label: 'Score changes by', unit: 'pts' },
  { value: 'filing', label: 'Files a 10-K/10-Q/8-K', unit: '' },
  { value: 'insider_buy', label: 'Insider buys at least', unit: '$' },
  { value: 'earnings', label: 'Earnings in (days)', unit: 'days' },
] as const;

type AlertRow = { id: string; kind: string; threshold: number; active: boolean; triggered_at: string | null; created_at: string };

export function AlertButton({ symbol, price, score }: { symbol: string; price: number | null; score: number | null }) {
  const [open, setOpen] = useState(false);
  const { data: alerts, mutate } = useSWR<AlertRow[]>(open ? `/api/alerts?symbol=${symbol}` : null);
  const [kind, setKind] = useState<(typeof ALERT_KINDS)[number]['value']>('price_above');
  const [threshold, setThreshold] = useState('');

  const suggested = (next: string) => {
    if (next === 'price_above' && price) return (price * 1.1).toFixed(2);
    if (next === 'price_below' && price) return (price * 0.9).toFixed(2);
    if (next === 'change_pct') return '5';
    if (next === 'score_above') return String(Math.min(100, (score ?? 60) + 10));
    if (next === 'score_below') return String(Math.max(0, (score ?? 60) - 10));
    if (next === 'filing') return '0';
    if (next === 'insider_buy') return '100000';
    if (next === 'earnings') return '1';
    return '8';
  };

  const create = async () => {
    const value = Number(threshold || suggested(kind));
    if (!Number.isFinite(value)) return;
    await api('/api/alerts', { body: { symbol, kind, threshold: value } });
    toast.success('Alert set');
    setThreshold('');
    void mutate();
  };

  const unit = ALERT_KINDS.find((item) => item.value === kind)?.unit;

  return (
    <>
      <Button variant="outline" icon={<Bell className="size-3.5" />} onClick={() => setOpen(true)}>
        Alert
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Alerts for ${symbol}`} description="Price alerts are checked with every market snapshot; score alerts whenever the score is recalculated.">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Field label="When">
              <Select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as typeof kind);
                  setThreshold('');
                }}
              >
                {ALERT_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Threshold (${unit})`}>
              <Input inputMode="decimal" value={threshold} placeholder={suggested(kind)} onChange={(event) => setThreshold(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void create()} />
            </Field>
          </div>
          <Button variant="primary" onClick={() => void create()} icon={<Plus className="size-3.5" />}>
            Add alert
          </Button>
          <div className="border-t border-line pt-3">
            <div className="kicker mb-2">Active & past alerts</div>
            {alerts?.length ? (
              <div className="flex flex-col gap-1">
                {alerts.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between rounded-sm bg-surface-1 px-2.5 py-1.5 text-[12px]">
                    <span className={alert.active ? 'text-ink-2' : 'text-faint line-through'}>
                      {ALERT_KINDS.find((item) => item.value === alert.kind)?.label} {alert.threshold}
                      {ALERT_KINDS.find((item) => item.value === alert.kind)?.unit === '%' ? '%' : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[10.5px] text-faint">{alert.triggered_at ? `fired ${relativeTime(alert.triggered_at)}` : alert.active ? 'watching' : 'off'}</span>
                      <button
                        onClick={async () => {
                          await api(`/api/alerts/${alert.id}`, { method: 'DELETE' });
                          void mutate();
                        }}
                        className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink"
                        aria-label="Delete alert"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted">No alerts for {symbol} yet.</p>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

type PortfolioOption = { id: string; name: string };

export function TradeButton({ symbol, price }: { symbol: string; price: number | null }) {
  const [open, setOpen] = useState(false);
  const { data: portfolios, mutate } = useSWR<PortfolioOption[]>(open ? '/api/portfolios' : null);
  const [portfolioId, setPortfolioId] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('');
  const [tradePrice, setTradePrice] = useState('');
  const [date, setDate] = useState(() => localToday());
  const [fees, setFees] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      let target = portfolioId || portfolios?.[0]?.id;
      if (!target) {
        const created = await api<{ id: string }>('/api/portfolios', { body: { name: 'Main portfolio' } });
        target = created.id;
        void mutate();
      }
      await api(`/api/portfolios/${target}/transactions`, {
        body: { symbol, side, quantity: Number(quantity), price: Number(tradePrice || price || 0), fees: Number(fees || 0), traded_at: date },
      });
      toast.success(`${side === 'buy' ? 'Bought' : 'Sold'} ${quantity} ${symbol}`);
      setOpen(false);
      setQuantity('');
      void revalidate('/api/portfolios', '/api/dashboard');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" icon={<Wallet className="size-3.5" />} onClick={() => setOpen(true)}>
        Trade
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Record a ${symbol} trade`}
        description="Trades build your holdings and cost basis (average-cost method)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} disabled={!Number(quantity)} onClick={() => void submit()}>
              Save trade
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <Segmented
              value={side}
              onChange={setSide}
              options={[
                { value: 'buy', label: 'Buy' },
                { value: 'sell', label: 'Sell' },
              ]}
            />
            <Select value={portfolioId} onChange={(event) => setPortfolioId(event.target.value)} className="max-w-52">
              {portfolios?.length ? null : <option value="">New “Main portfolio”</option>}
              {portfolios?.map((portfolio) => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shares">
              <Input autoFocus inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" />
            </Field>
            <Field label="Price per share">
              <Input inputMode="decimal" value={tradePrice} onChange={(event) => setTradePrice(event.target.value)} placeholder={price ? price.toFixed(2) : '0.00'} />
            </Field>
            <Field label="Trade date">
              <Input type="date" value={date} max={localToday()} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="Fees">
              <Input inputMode="decimal" value={fees} onChange={(event) => setFees(event.target.value)} placeholder="0" />
            </Field>
          </div>
          {Number(quantity) > 0 ? (
            <div className="rounded-sm bg-surface-1 px-3 py-2 text-[12px] text-muted">
              Total{' '}
              <span className="num text-ink">
                ${(Number(quantity) * Number(tradePrice || price || 0) + Number(fees || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

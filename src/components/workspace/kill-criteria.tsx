'use client';

import { ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { BriefModal, type Brief } from '@/components/briefs/brief-view';
import { Button, IconButton } from '@/components/ui/button';
import { Input, Panel, PanelHeader, Select } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';

type Alert = { id: string; kind: string; metric: string | null; threshold: number; note: string | null; source: string | null; active: boolean; triggered_at: string | null };

/** Mirrors ALERT_METRICS on the server. */
const METRICS: Record<string, { label: string; percent: boolean }> = {
  revenueGrowth: { label: 'Revenue growth', percent: true },
  epsGrowth: { label: 'EPS growth', percent: true },
  grossMargin: { label: 'Gross margin', percent: true },
  operatingMargin: { label: 'Operating margin', percent: true },
  netMargin: { label: 'Net margin', percent: true },
  fcfMargin: { label: 'FCF margin', percent: true },
  roe: { label: 'Return on equity', percent: true },
  debtToEquity: { label: 'Debt / equity', percent: false },
  currentRatio: { label: 'Current ratio', percent: false },
  pe: { label: 'P/E', percent: false },
  ps: { label: 'P/S', percent: false },
  evEbitda: { label: 'EV / EBITDA', percent: false },
  fcfYield: { label: 'FCF yield', percent: true },
  dividendYield: { label: 'Dividend yield', percent: true },
};

const describe = (alert: Alert) => {
  if (alert.kind === 'price_below') return `Price falls below $${alert.threshold}`;
  if (alert.kind === 'price_above') return `Price rises above $${alert.threshold}`;
  const meta = alert.metric ? METRICS[alert.metric] : null;
  const value = meta?.percent ? `${(alert.threshold * 100).toFixed(1)}%` : alert.threshold.toString();
  return `${meta?.label ?? alert.metric} ${alert.kind === 'metric_below' ? 'falls below' : 'rises above'} ${value}`;
};

/**
 * "What would prove me wrong", made measurable: each criterion is a SilverNote alert (source =
 * thesis) that notifies the moment a fundamental ratio or the price crosses the line.
 */
export function KillCriteria({ symbol }: { symbol: string }) {
  const { data } = useSWR<Alert[]>(`/api/alerts?symbol=${symbol}`);
  const criteria = (data ?? []).filter((alert) => alert.source === 'thesis');
  const [metric, setMetric] = useState('grossMargin');
  const [direction, setDirection] = useState<'below' | 'above'>('below');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [redTeaming, setRedTeaming] = useState(false);

  const add = async () => {
    const number = Number(value);
    if (!Number.isFinite(number) || value === '') return;
    const isPrice = metric === 'price';
    const percent = !isPrice && METRICS[metric]?.percent;
    await api('/api/alerts', {
      body: {
        symbol,
        kind: isPrice ? (direction === 'below' ? 'price_below' : 'price_above') : direction === 'below' ? 'metric_below' : 'metric_above',
        metric: isPrice ? null : metric,
        threshold: percent ? number / 100 : number,
        note: note || null,
        source: 'thesis',
      },
    });
    setValue('');
    setNote('');
    await revalidate('/api/alerts');
  };
  const remove = async (id: string) => {
    await api(`/api/alerts/${id}`, { method: 'DELETE' });
    await revalidate('/api/alerts');
  };
  const redTeam = async () => {
    setRedTeaming(true);
    try {
      const rows = await api<Brief[]>('/api/briefs', { body: { kind: 'redteam', symbol } });
      if (rows[0]) setBrief(rows[0]);
    } finally {
      setRedTeaming(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        kicker="What would prove me wrong — measured"
        title="Kill criteria"
        actions={
          <Button size="xs" variant="outline" icon={<ShieldAlert className="size-3" />} loading={redTeaming} onClick={() => void redTeam()}>
            Red-team now
          </Button>
        }
      />
      <div className="flex flex-col gap-2 px-4 pb-4">
        {criteria.map((alert) => (
          <div key={alert.id} className="flex items-center justify-between gap-2 rounded-sm border border-line bg-surface-1/60 px-2.5 py-1.5 text-[12px]">
            <div className="min-w-0">
              <div className="text-ink-2">{describe(alert)}</div>
              {alert.note ? <div className="truncate text-[11px] text-muted">{alert.note}</div> : null}
            </div>
            {alert.triggered_at ? <span className="shrink-0 text-[10.5px] text-loss">Triggered</span> : <span className="shrink-0 text-[10.5px] text-faint">Watching</span>}
            <IconButton label="Remove criterion" size="xs" onClick={() => void remove(alert.id)}>
              <Trash2 className="size-3" />
            </IconButton>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_auto_80px] gap-1.5">
          <Select value={metric} onChange={(event) => setMetric(event.target.value)} className="h-7.5">
            <option value="price">Share price ($)</option>
            {Object.entries(METRICS).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
                {meta.percent ? ' (%)' : ''}
              </option>
            ))}
          </Select>
          <Select value={direction} onChange={(event) => setDirection(event.target.value as 'below' | 'above')} className="h-7.5">
            <option value="below">falls below</option>
            <option value="above">rises above</option>
          </Select>
          <Input className="h-7.5" inputMode="decimal" placeholder="value" value={value} onChange={(event) => setValue(event.target.value)} />
        </div>
        <div className="flex gap-1.5">
          <Input className="h-7.5" placeholder="Why this breaks the thesis (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
          <Button size="sm" onClick={() => void add()} disabled={value === ''}>
            Add
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-faint">Checked against each new filing and price snapshot; you get a push or Telegram message when one is crossed.</p>
      </div>
      <BriefModal brief={brief} onClose={() => setBrief(null)} />
    </Panel>
  );
}

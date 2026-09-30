'use client';

import { BookCheck, Check, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import useSWR from 'swr';

import { Page } from '@/components/shell/page';
import { Button, IconButton } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Modal } from '@/components/ui/overlay';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Select, Skeleton, Stat, Textarea } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { api, revalidate } from '@/lib/client';
import { pct, price } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

type Verdict = 'right' | 'wrong' | 'mixed' | 'pending';
type Decision = {
  id: string;
  symbol: string;
  direction: 'long' | 'short' | 'avoid';
  entry_price: number;
  entry_date: string;
  target_price: number | null;
  stop_price: number | null;
  horizon_date: string | null;
  confidence: number;
  rationale: string;
  tags: string[];
  status: 'open' | 'closed';
  exit_price: number | null;
  exit_date: string | null;
  outcome: 'right' | 'wrong' | 'mixed' | null;
  postmortem: string | null;
  price: number | null;
  score: { directionalReturn: number | null; progress: number | null; hitTarget: boolean; hitStop: boolean; verdict: Verdict };
};
type Stats = {
  buckets: Array<{ low: number; high: number; calls: number; right: number; hitRate: number | null }>;
  brier: number | null;
  settled: number;
  hitRate: number | null;
  averageReturn: number | null;
};

const VERDICT_TONE: Record<Verdict, 'gain' | 'loss' | 'warning' | 'neutral'> = { right: 'gain', wrong: 'loss', mixed: 'warning', pending: 'neutral' };

function NewDecision({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<'long' | 'short' | 'avoid'>('long');
  const [entry, setEntry] = useState('');
  const [target, setTarget] = useState('');
  const [stop, setStop] = useState('');
  const [horizon, setHorizon] = useState('');
  const [confidence, setConfidence] = useState(65);
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);
  const number = (value: string) => (value.trim() ? Number(value) : null);
  const save = async () => {
    setSaving(true);
    try {
      await api('/api/journal', {
        body: {
          symbol,
          direction,
          entry_price: number(entry),
          target_price: number(target),
          stop_price: number(stop),
          horizon_date: horizon || null,
          confidence,
          rationale,
        },
      });
      await revalidate('/api/journal');
      setSymbol('');
      setEntry('');
      setTarget('');
      setStop('');
      setRationale('');
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a decision"
      description="Write the call down now so you can score it honestly later. Entry defaults to the current price."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!symbol}>
            Log decision
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Company">{symbol ? <div className="flex items-center gap-2"><CompanyLogo symbol={symbol} size="xs" /><span className="font-mono text-[13px] text-ink">{symbol}</span><Button size="xs" variant="ghost" onClick={() => setSymbol('')}>Change</Button></div> : <TickerSearch onPick={setSymbol} placeholder="Search a ticker…" autoFocus />}</Field>
        <Field label="Call">
          <Segmented value={direction} onChange={setDirection} options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: 'avoid', label: 'Avoid' }]} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Entry price">
            <Input inputMode="decimal" placeholder="Live price" value={entry} onChange={(event) => setEntry(event.target.value)} />
          </Field>
          <Field label="Target">
            <Input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} />
          </Field>
          <Field label="Stop / wrong at">
            <Input inputMode="decimal" value={stop} onChange={(event) => setStop(event.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Judge it by">
            <Input type="date" value={horizon} onChange={(event) => setHorizon(event.target.value)} />
          </Field>
          <Field label={`Confidence: ${confidence}%`} hint="How likely you are right">
            <input type="range" min={50} max={100} step={5} value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} className="w-full accent-[var(--color-brand)]" />
          </Field>
        </div>
        <Field label="Why (markdown)">
          <Textarea rows={5} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="The one-paragraph thesis, the catalyst, and what would make you wrong." />
        </Field>
      </div>
    </Modal>
  );
}

function CloseDecision({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const [exit, setExit] = useState('');
  const [outcome, setOutcome] = useState<'right' | 'wrong' | 'mixed'>('right');
  const [postmortem, setPostmortem] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!decision) return;
    setSaving(true);
    try {
      await api(`/api/journal/${decision.id}`, { method: 'PATCH', body: { status: 'closed', exit_price: exit ? Number(exit) : null, outcome, postmortem } });
      await revalidate('/api/journal');
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={Boolean(decision)}
      onClose={onClose}
      title={decision ? `Close ${decision.direction} ${decision.symbol}` : ''}
      description="Grade the call and write the post-mortem: what you got right, what you missed, and whether it was skill or luck."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Close decision
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Exit price">
            <Input inputMode="decimal" placeholder={decision?.price ? `Live ${price(decision.price)}` : ''} value={exit} onChange={(event) => setExit(event.target.value)} />
          </Field>
          <Field label="Verdict">
            <Select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
              <option value="right">Right</option>
              <option value="wrong">Wrong</option>
              <option value="mixed">Mixed (right for the wrong reason, or vice versa)</option>
            </Select>
          </Field>
        </div>
        <Field label="Post-mortem">
          <Textarea rows={6} value={postmortem} onChange={(event) => setPostmortem(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Calibration({ stats }: { stats: Stats }) {
  return (
    <Panel>
      <PanelHeader kicker="Are your 80% calls right 80% of the time?" title="Calibration" />
      <div className="flex flex-col gap-2 px-4 pb-4">
        {stats.buckets.map((bucket) => {
          const expected = (bucket.low + bucket.high) / 2 / 100;
          return (
            <div key={bucket.low} className="grid grid-cols-[64px_1fr_72px] items-center gap-3 text-[12px]">
              <span className="text-muted">
                {bucket.low}–{bucket.high}%
              </span>
              <div className="relative h-3 rounded-full bg-surface-4">
                <div className="absolute inset-y-0 left-0 rounded-full bg-brand/70" style={{ width: `${(bucket.hitRate ?? 0) * 100}%` }} />
                <div className="absolute inset-y-[-3px] w-px bg-white/60" style={{ left: `${expected * 100}%` }} title="Perfect calibration" />
              </div>
              <span className="num text-right text-ink-2">{bucket.calls ? `${pct(bucket.hitRate)} · ${bucket.calls}` : '—'}</span>
            </div>
          );
        })}
        <p className="mt-1 text-[11px] text-faint">Bars: how often calls in each confidence band settled right. The white tick is where a perfectly calibrated investor would land.</p>
      </div>
    </Panel>
  );
}

export function Journal() {
  const { data, isLoading } = useSWR<{ decisions: Decision[]; stats: Stats }>('/api/journal', { refreshInterval: 5 * 60_000 });
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<Decision | null>(null);
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [expanded, setExpanded] = useState<string | null>(null);
  const decisions = (data?.decisions ?? []).filter((row) => filter === 'all' || row.status === filter);
  const stats = data?.stats;

  const remove = async (id: string) => {
    if (!window.confirm('Delete this decision? Its record is lost for good.')) return;
    await api(`/api/journal/${id}`, { method: 'DELETE' });
    await revalidate('/api/journal');
  };

  return (
    <Page
      kicker="Calls · verdicts · calibration"
      title="Decision journal"
      description="Log every call with a price, target, deadline and confidence. SilverNote scores them as prices move, so you learn whether your conviction is worth anything."
      actions={
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          Log decision
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Panel>
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Stat label="Hit rate" value={stats?.hitRate === null || !stats ? '—' : pct(stats.hitRate)} sub={<span className="text-muted">{stats?.settled ?? 0} settled</span>} />
            <Stat label="Avg directional return" value={stats?.averageReturn == null ? '—' : pct(stats.averageReturn)} />
            <Stat label="Brier score" value={stats?.brier == null ? '—' : stats.brier.toFixed(3)} sub={<span className="text-muted">0 perfect · 0.25 coin flip</span>} />
            <Stat label="Open calls" value={(data?.decisions ?? []).filter((row) => row.status === 'open').length} />
          </div>
        </Panel>
        {stats ? <Calibration stats={stats} /> : <Skeleton className="h-40" />}
      </div>

      <Panel>
        <PanelHeader
          title="Decisions"
          actions={<Segmented size="xs" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} />}
        />
        {isLoading && !data ? (
          <Skeleton className="mx-4 mb-4 h-40" />
        ) : !decisions.length ? (
          <EmptyState icon={<BookCheck className="size-4" />} title="No decisions yet" body="Log your first call: what you think, how sure you are, and when you’ll know." action={<Button onClick={() => setCreating(true)}>Log decision</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12.5px]">
              <thead>
                <tr className="border-y border-line text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Call</th>
                  <th className="px-2 py-2 text-right font-medium">Entry</th>
                  <th className="px-2 py-2 text-right font-medium">Now / exit</th>
                  <th className="px-2 py-2 text-right font-medium">Target · stop</th>
                  <th className="px-2 py-2 text-right font-medium">Result</th>
                  <th className="px-2 py-2 font-medium">Progress</th>
                  <th className="px-2 py-2 text-right font-medium">Conf.</th>
                  <th className="px-2 py-2 font-medium">Verdict</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {decisions.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="cursor-pointer border-b border-line hover:bg-white/[0.02]" onClick={() => setExpanded((value) => (value === row.id ? null : row.id))}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <CompanyLogo symbol={row.symbol} size="xs" />
                          <Link href={`/company/${row.symbol}`} onClick={(event) => event.stopPropagation()} className="font-mono font-semibold text-ink hover:underline">
                            {row.symbol}
                          </Link>
                          <Badge tone={row.direction === 'long' ? 'gain' : row.direction === 'short' ? 'loss' : 'neutral'}>{row.direction}</Badge>
                          <span className="text-[11px] text-faint">{row.entry_date}</span>
                        </div>
                      </td>
                      <td className="num px-2 py-2 text-right">{price(row.entry_price)}</td>
                      <td className="num px-2 py-2 text-right">{price(row.status === 'closed' ? row.exit_price : row.price)}</td>
                      <td className="num px-2 py-2 text-right text-muted">
                        {row.target_price ? price(row.target_price) : '—'} · {row.stop_price ? price(row.stop_price) : '—'}
                      </td>
                      <td className={cn('num px-2 py-2 text-right', (row.score.directionalReturn ?? 0) > 0 ? 'text-gain' : (row.score.directionalReturn ?? 0) < 0 ? 'text-loss' : 'text-muted')}>
                        {row.score.directionalReturn === null ? '—' : pct(row.score.directionalReturn)}
                      </td>
                      <td className="px-2 py-2">
                        {row.score.progress !== null ? (
                          <div className="h-1.5 w-24 rounded-full bg-surface-4" title={`${pct(row.score.progress)} of the way to target`}>
                            <div className={cn('h-full rounded-full', row.score.progress >= 0 ? 'bg-gain/80' : 'bg-loss/80')} style={{ width: `${Math.min(100, Math.abs(row.score.progress) * 100)}%` }} />
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="num px-2 py-2 text-right">{row.confidence}%</td>
                      <td className="px-2 py-2">
                        <Badge tone={VERDICT_TONE[row.score.verdict]}>{row.score.verdict}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                        {row.status === 'open' ? (
                          <IconButton label="Close and grade" size="xs" onClick={() => setClosing(row)}>
                            <Check className="size-3.5" />
                          </IconButton>
                        ) : (
                          <IconButton label="Reopen" size="xs" onClick={() => void api(`/api/journal/${row.id}`, { method: 'PATCH', body: { status: 'open', outcome: null } }).then(() => revalidate('/api/journal'))}>
                            <X className="size-3.5" />
                          </IconButton>
                        )}
                        <IconButton label="Delete" size="xs" onClick={() => void remove(row.id)}>
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </td>
                    </tr>
                    {expanded === row.id ? (
                      <tr className="border-b border-line bg-surface-1/60">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="kicker mb-1">Rationale</div>
                              <div className="prose-rn text-[12.5px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(row.rationale || '*No rationale written.*') }} />
                              {row.horizon_date ? <p className="mt-2 text-[11.5px] text-muted">Judge by {row.horizon_date}</p> : null}
                            </div>
                            {row.postmortem ? (
                              <div>
                                <div className="kicker mb-1">Post-mortem</div>
                                <div className="prose-rn text-[12.5px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(row.postmortem) }} />
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <NewDecision open={creating} onClose={() => setCreating(false)} />
      <CloseDecision key={closing?.id ?? 'none'} decision={closing} onClose={() => setClosing(null)} />
    </Page>
  );
}

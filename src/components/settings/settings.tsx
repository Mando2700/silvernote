'use client';

import { Check, Database, KeyRound, LogOut, Play, RefreshCw, ShieldCheck, Sparkles, Square } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { IbkrPanel } from '@/components/settings/ibkr';
import { Page } from '@/components/shell/page';
import { useShell, type Preferences } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { Badge, Input, Panel, PanelHeader, Segmented, Select, Skeleton } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';
import { relativeTime } from '@/lib/format';
import { MARKET_PALETTES } from '@/lib/theme';
import { cn } from '@/lib/utils';

type JobKind = 'universe' | 'fundamentals' | 'scores' | 'panel';
type Job = { id: string; kind: JobKind; status: 'running' | 'done' | 'failed' | 'cancelled'; total: number; done: number; message: string | null; error: string | null; finished_at: string | null; started_at: string | null };
type Status = {
  user: { email: string | null; local: boolean };
  config: {
    database: 'local' | 'supabase';
    auth: 'local' | 'supabase';
    providers: { nasdaq: boolean; sec: boolean; fred: boolean; finnhub: boolean; fmp: boolean };
    ai: { configured: boolean; model: string };
    secUserAgentCustomized: boolean;
  };
  universe: { count: number; common: number; updated_at: string | null };
  jobs: Partial<Record<JobKind, Job>>;
  scores: { scored: number; fresh: number };
  marketOpen: boolean;
  usage: { fmpCallsToday: number };
};
type Models = { configured: boolean; default: string; models: string[] };

const BENCHMARKS = [
  { value: 'SPY', label: 'S&P 500 (SPY)' },
  { value: 'QQQ', label: 'Nasdaq 100 (QQQ)' },
  { value: 'IWM', label: 'Russell 2000 (IWM)' },
  { value: 'DIA', label: 'Dow 30 (DIA)' },
  { value: 'VT', label: 'Global equities (VT)' },
  { value: 'AOR', label: '60/40 balanced (AOR)' },
];

const JOBS: Array<{ kind: JobKind; title: string; body: string; schedule: string }> = [
  { kind: 'universe', title: 'Market universe', body: 'Every US listing with price, change, market value, sector and industry (Nasdaq).', schedule: 'Every 10 min in market hours, 6 h otherwise' },
  { kind: 'fundamentals', title: 'SEC fundamentals', body: 'Standardized XBRL frames for the whole market from SEC EDGAR.', schedule: 'Weekly' },
  { kind: 'scores', title: 'SilverNote Scores', body: 'Recomputes the score for every company with enough data, largest first.', schedule: 'Weekly, after fundamentals' },
  { kind: 'panel', title: 'Backtest history', body: 'Month-end scores for the 500 largest companies over ten years, rebuilt from the filings public at each date.', schedule: 'On demand (Backtest page)' },
];

export function Settings() {
  const { prefs, updatePrefs } = useShell();
  const { data: status, mutate } = useSWR<Status>('/api/status', { refreshInterval: (latest) => (latest && Object.values(latest.jobs).some((job) => job?.status === 'running') ? 2000 : 15000) });
  const { data: models } = useSWR<Models>('/api/ai/models');

  const save = async (patch: Partial<Preferences>, label = 'Saved') => {
    try {
      await updatePrefs(patch);
      toast.success(label);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <Page kicker="SilverNote" title="Settings" description="Display, analytics defaults, the assistant, data sources and background jobs. API keys live only in .env.local on the server and are never shown here.">
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader kicker="Display" title="Colors and motion" />
            <div className="flex flex-col gap-5 px-4 pb-5">
              <Row label="Market colors" hint="Gains and losses always carry a +/− sign too. The blue/orange pair is easier to tell apart with red-green color blindness.">
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(MARKET_PALETTES) as Array<keyof typeof MARKET_PALETTES>).map((key) => {
                    const palette = MARKET_PALETTES[key];
                    const active = prefs.marketColors === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => void save({ marketColors: key }, 'Market colors updated')}
                        className={cn('rounded-sm border p-3 text-left transition-colors', active ? 'border-brand/50 bg-brand-wash' : 'border-line hover:border-line-strong')}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[12.5px] font-medium text-ink">{key === 'red-green' ? 'Green / red' : 'Blue / orange'}</span>
                          {active ? <Check className="size-3.5 text-brand" /> : null}
                        </div>
                        <div className="mt-2.5 flex h-6 gap-[2px] overflow-hidden rounded-[3px]">
                          {[-3, -1.5, -0.4, 0.4, 1.5, 3].map((value) => (
                            <span
                              key={value}
                              className="flex-1"
                              style={{ background: value > 0 ? palette.gainFill : palette.lossFill, opacity: 0.35 + Math.min(1, Math.abs(value) / 3) * 0.65 }}
                            />
                          ))}
                        </div>
                        <div className="num mt-2 flex justify-between text-[11.5px] font-medium">
                          <span style={{ color: palette.loss }}>−2.41%</span>
                          <span style={{ color: palette.gain }}>+1.87%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Row>
              <Row label="Motion" hint="System follows your OS “reduce motion” setting.">
                <Segmented
                  value={prefs.motion}
                  onChange={(motionPref) => void save({ motion: motionPref }, 'Motion updated')}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'full', label: 'Full' },
                    { value: 'reduced', label: 'Reduced' },
                  ]}
                />
              </Row>
            </div>
          </Panel>

          <Panel>
            <PanelHeader kicker="Portfolio analytics" title="Defaults" />
            <div className="flex flex-col gap-5 px-4 pb-5">
              <Row label="Benchmark" hint="Used for beta, relative performance and stress tests.">
                <Select value={prefs.benchmark} onChange={(event) => void save({ benchmark: event.target.value }, 'Benchmark updated')} className="w-60">
                  {BENCHMARKS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Row>
              <RiskFreeRow value={prefs.riskFreeRate} onSave={(riskFreeRate) => void save({ riskFreeRate }, 'Risk-free rate updated')} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              kicker="Assistant"
              title="Grok (xAI)"
              actions={models?.configured ? <Badge tone="gain">Connected</Badge> : <Badge tone="outline">Not connected</Badge>}
            />
            <div className="flex flex-col gap-4 px-4 pb-5">
              {models?.configured ? (
                <Row label="Model" hint="Requests go from the server to xAI; the browser never sees the key.">
                  <Select value={prefs.aiModel ?? ''} onChange={(event) => void save({ aiModel: event.target.value || null }, 'Model updated')} className="w-60">
                    <option value="">Default ({models.default})</option>
                    {models.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </Select>
                </Row>
              ) : (
                <SetupHint
                  icon={<Sparkles className="size-4 text-brand" />}
                  lines={['Add your xAI key to `.env.local`, then restart the server:', 'XAI_API_KEY=xai-…']}
                />
              )}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <IbkrPanel />

          <Panel>
            <PanelHeader kicker="Data" title="Sources" />
            {!status ? (
              <div className="px-4 pb-4">
                <Skeleton className="h-40" />
              </div>
            ) : (
              <div className="flex flex-col">
                <SourceRow name="Nasdaq" detail="Universe, quotes, 10-year history, profiles, headlines" ok />
                <SourceRow name="SEC EDGAR" detail={status.config.secUserAgentCustomized ? 'Filings, XBRL statements and frames' : 'Set SEC_USER_AGENT with your contact email (SEC fair-access policy)'} ok warn={!status.config.secUserAgentCustomized} />
                <SourceRow name="FRED" detail="Nasdaq Composite history (2008 stress test), 3-month T-bill" ok />
                <SourceRow name="FX rates" detail="Converts foreign filers’ statements to USD" ok />
                <SourceRow name="Finnhub" detail={status.config.providers.finnhub ? 'Real-time quotes, company news, peers, analyst data' : 'Optional · add FINNHUB_API_KEY for live quotes, news and peers'} ok={status.config.providers.finnhub} />
                <SourceRow
                  name="Financial Modeling Prep"
                  detail={status.config.providers.fmp ? `Profiles and statements · ${status.usage.fmpCallsToday} of 240 calls used today` : 'Optional · add FMP_API_KEY for richer profiles'}
                  ok={status.config.providers.fmp}
                />
                <SourceRow name="Company logos" detail="FMP public logo images, cached in the database" ok />
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader kicker="Background jobs" title="Data refresh" actions={status ? <Badge tone={status.marketOpen ? 'gain' : 'outline'}>{status.marketOpen ? 'Market open' : 'Market closed'}</Badge> : null} />
            <div className="flex flex-col">
              {JOBS.map((job) => (
                <JobRow key={job.kind} spec={job} job={status?.jobs[job.kind]} onChanged={() => void mutate()} />
              ))}
            </div>
            {status ? (
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-3 text-[11.5px] text-muted">
                <span>
                  <span className="num text-ink-2">{status.universe.count.toLocaleString()}</span> listings · <span className="num text-ink-2">{status.universe.common.toLocaleString()}</span> common stocks
                </span>
                <span>
                  <span className="num text-ink-2">{status.scores.scored.toLocaleString()}</span> scored
                </span>
                {status.universe.updated_at ? <span>Prices updated {relativeTime(status.universe.updated_at)}</span> : null}
              </div>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader kicker="Storage & access" title={status?.config.database === 'supabase' ? 'Supabase' : 'Local'} />
            <div className="flex flex-col gap-3 px-4 pb-5 text-[12.5px]">
              <div className="flex items-start gap-2.5">
                <Database className="mt-0.5 size-4 shrink-0 text-brand-soft" />
                <div className="text-ink-2">
                  {status?.config.database === 'supabase' ? 'Postgres on Supabase (DATABASE_URL), with row-level security on every table.' : 'Built-in Postgres (PGlite) stored in ./.silvernote/db on this machine.'}
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-soft" />
                <div className="text-ink-2">
                  {status?.config.auth === 'supabase'
                    ? `Supabase Auth, restricted to the owner account${status.user.email ? ` (${status.user.email})` : ''}.`
                    : 'No sign-in: the server only listens on 127.0.0.1, so it is reachable from this computer only. Configure Supabase before hosting it anywhere.'}
                </div>
              </div>
              {status?.config.auth === 'supabase' ? (
                <form action="/auth/signout" method="post">
                  <Button type="submit" variant="outline" size="sm" icon={<LogOut className="size-3.5" />}>
                    Sign out
                  </Button>
                </form>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
    </Page>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)] md:gap-4">
      <div>
        <div className="text-[12.5px] font-medium text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{hint}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function RiskFreeRow({ value, onSave }: { value: number | null; onSave: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(+(value * 100).toFixed(3)));
  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) return onSave(null);
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20) {
      toast.error('Enter a rate between 0 and 20%.');
      return;
    }
    onSave(parsed / 100);
  };
  return (
    <Row label="Risk-free rate" hint="Leave empty to use the latest 3-month Treasury bill yield from FRED (for Sharpe and Sortino).">
      <div className="flex items-center gap-2">
        <div className="relative w-32">
          <Input value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === 'Enter' && commit()} placeholder="Auto" inputMode="decimal" className="pr-7 font-mono" />
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] text-faint">%</span>
        </div>
        {value === null ? <span className="text-[11.5px] text-faint">Using FRED</span> : null}
      </div>
    </Row>
  );
}

function SourceRow({ name, detail, ok, warn }: { name: string; detail: string; ok: boolean; warn?: boolean }) {
  return (
    <div className="flex items-start gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
      <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', warn ? 'bg-warning' : ok ? 'bg-gain-fill' : 'bg-faint')} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          {name}
          {!ok ? <KeyRound className="size-3 text-faint" aria-label="Needs a key" /> : null}
        </div>
        <div className={cn('text-[11.5px]', warn ? 'text-warning' : 'text-muted')}>{detail}</div>
      </div>
      <span className="text-[11px] text-faint">{warn ? 'Check' : ok ? 'Active' : 'Off'}</span>
    </div>
  );
}

function JobRow({ spec, job, onChanged }: { spec: (typeof JOBS)[number]; job?: Job; onChanged: () => void }) {
  const running = job?.status === 'running';
  const progress = job && job.total ? Math.min(1, job.done / job.total) : 0;
  const run = async () => {
    try {
      await api('/api/jobs', { body: { kind: spec.kind } });
      toast.success(`${spec.title}: started`);
      onChanged();
      void revalidate('/api/status');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const stop = async () => {
    await api(`/api/jobs?kind=${spec.kind}`, { method: 'DELETE' });
    onChanged();
  };
  return (
    <div className="border-t border-line px-4 py-3 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
            {spec.title}
            {running ? <Badge tone="brand">Running</Badge> : job?.status === 'failed' ? <Badge tone="loss">Failed</Badge> : null}
          </div>
          <div className="text-[11.5px] text-muted">{spec.body}</div>
          <div className="mt-1 text-[11px] text-faint">
            {spec.schedule}
            {job?.finished_at && !running ? ` · last run ${relativeTime(job.finished_at)}` : ''}
            {job?.message ? ` · ${job.message}` : ''}
          </div>
          {job?.error && !running ? <div className="mt-1 text-[11px] text-loss">{job.error}</div> : null}
        </div>
        {running ? (
          <Button size="xs" variant="outline" icon={<Square className="size-3" />} onClick={() => void stop()}>
            Stop
          </Button>
        ) : (
          <Button size="xs" variant="outline" icon={job ? <RefreshCw className="size-3" /> : <Play className="size-3" />} onClick={() => void run()}>
            Run now
          </Button>
        )}
      </div>
      {running ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div className="h-full rounded-full bg-silver" animate={{ width: `${Math.max(3, progress * 100)}%` }} transition={{ duration: 0.5 }} />
        </div>
      ) : null}
    </div>
  );
}

function SetupHint({ icon, lines }: { icon: ReactNode; lines: string[] }) {
  return (
    <div className="flex gap-3 rounded-sm border border-line bg-surface-1 p-3">
      <span className="mt-0.5">{icon}</span>
      <div className="flex flex-col gap-1.5 text-[12px] text-ink-2">
        <span>{lines[0].replace(/`/g, '')}</span>
        {lines.slice(1).map((line) => (
          <code key={line} className="w-fit rounded-xs bg-surface-4 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">
            {line}
          </code>
        ))}
      </div>
    </div>
  );
}

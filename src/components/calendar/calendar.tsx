'use client';

import { Bell, CalendarDays, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { BriefModal, type Brief } from '@/components/briefs/brief-view';
import { Page } from '@/components/shell/page';
import { Button, IconButton } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, EmptyState, Panel, Segmented, Skeleton, Switch } from '@/components/ui/primitives';
import { api } from '@/lib/client';
import { compactNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type Earnings = { symbol: string; name: string; date: string; time: 'pre' | 'post' | 'unknown'; marketCap: number | null; fiscalQuarter: string | null; epsForecast: number | null; estimates: number | null; lastYearEps: number | null; mine: boolean };
type Dividend = { symbol: string; name: string; exDate: string; payDate: string | null; amount: number | null; annual: number | null; mine: boolean };
type Economic = { date: string; time: string | null; country: string; name: string; actual: string | null; consensus: string | null; previous: string | null; major: boolean };
type Day = { date: string; earnings: Earnings[]; dividends: Dividend[]; economy: Economic[] };

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Monday of the week containing `date` (UTC). */
function monday(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** Economic release times arrive in GMT; show them in the viewer's time zone. */
function localTime(date: string, gmt: string | null) {
  if (!gmt || !/^\d{1,2}:\d{2}$/.test(gmt)) return gmt ?? '';
  const at = new Date(`${date}T${gmt.padStart(5, '0')}:00Z`);
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

const TIME_LABEL = { pre: 'BMO', post: 'AMC', unknown: '—' } as const;

export function Calendar() {
  const [week, setWeek] = useState(0);
  const [span, setSpan] = useState<'1' | '2'>('1');
  const [minCap, setMinCap] = useState<'50000000000' | '10000000000' | '2000000000'>('10000000000');
  const [mineOnly, setMineOnly] = useState(false);
  const [showMinor, setShowMinor] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  const start = useMemo(() => addDays(monday(new Date()), week * 7), [week]);
  const end = addDays(start, Number(span) * 7 - 3);
  const { data, isLoading } = useSWR<{ days: Day[] }>(`/api/calendar?from=${isoDay(start)}&to=${isoDay(end)}&minCap=${minCap}`, { refreshInterval: 10 * 60_000 });
  const today = isoDay(new Date());

  const preview = async (row: Earnings) => {
    setPreviewing(row.symbol);
    try {
      setBrief(await api<Brief>('/api/briefs', { body: { kind: 'earnings_preview', symbol: row.symbol, date: row.date } }));
    } finally {
      setPreviewing(null);
    }
  };

  const alertMe = async (row: Earnings) => {
    await api('/api/alerts', { body: { symbol: row.symbol, kind: 'earnings', threshold: 1, note: 'Earnings reminder from the calendar' } });
    toast.success(`You’ll be reminded the day before ${row.symbol} reports.`);
  };

  const days = data?.days ?? [];
  return (
    <Page
      kicker="Earnings · dividends · economic releases"
      title="Calendar"
      description="What moves your positions this week: earnings (with consensus), ex-dividend dates and US economic releases. Names you hold or watch are highlighted."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <IconButton label="Previous week" variant="outline" onClick={() => setWeek((value) => value - 1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <Button variant="outline" onClick={() => setWeek(0)} disabled={week === 0}>
            This week
          </Button>
          <IconButton label="Next week" variant="outline" onClick={() => setWeek((value) => value + 1)}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={span} onChange={setSpan} options={[{ value: '1', label: '1 week' }, { value: '2', label: '2 weeks' }]} />
        <Segmented
          value={minCap}
          onChange={setMinCap}
          options={[
            { value: '50000000000', label: '> $50B' },
            { value: '10000000000', label: '> $10B' },
            { value: '2000000000', label: '> $2B' },
          ]}
        />
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <Switch checked={mineOnly} onChange={setMineOnly} label="Only my names" /> Only my names
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <Switch checked={showMinor} onChange={setShowMinor} label="All US releases" /> All US releases
        </label>
      </div>

      {isLoading && !data ? (
        <div className="grid gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-96" />
          ))}
        </div>
      ) : !days.length ? (
        <EmptyState icon={<CalendarDays className="size-4" />} title="Nothing scheduled" body="No trading days in this range." />
      ) : (
        <div className="grid gap-3 md:grid-cols-5">
          {days.map((day) => {
            const earnings = day.earnings.filter((row) => !mineOnly || row.mine);
            const dividends = day.dividends.filter((row) => !mineOnly || row.mine);
            const economy = day.economy.filter((row) => showMinor || row.major);
            const label = new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
            return (
              <Panel key={day.date} className={cn('flex min-w-0 flex-col', day.date === today && 'ring-1 ring-brand/40')}>
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className={cn('text-[12.5px] font-semibold', day.date === today ? 'text-brand-soft' : 'text-ink')}>{label}</span>
                  {day.date === today ? <Badge tone="brand">Today</Badge> : null}
                </div>
                {economy.length ? (
                  <div className="border-b border-line px-3 py-2">
                    <div className="kicker mb-1 text-[9.5px]">US economy</div>
                    {economy.map((row, index) => (
                      <div key={`${row.name}-${index}`} className="py-1 text-[11.5px] leading-snug">
                        <div className="flex items-baseline gap-1.5">
                          <span className="num w-10 shrink-0 text-[10.5px] text-faint">{localTime(day.date, row.time)}</span>
                          <span className={cn('min-w-0', row.major ? 'font-medium text-ink' : 'text-ink-2')}>{row.name}</span>
                        </div>
                        {row.actual || row.consensus || row.previous ? (
                          <div className="ml-11.5 text-[10.5px] text-muted">
                            {row.actual ? <span className="text-ink">A {row.actual} · </span> : null}
                            C {row.consensus ?? '—'} · P {row.previous ?? '—'}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex-1 px-1.5 py-1.5">
                  {earnings.length ? <div className="kicker mb-1 px-1.5 text-[9.5px]">Earnings</div> : null}
                  {earnings.map((row) => (
                    <div key={row.symbol} className={cn('group flex items-center gap-2 rounded-sm px-1.5 py-1.5 hover:bg-white/[0.03]', row.mine && 'bg-brand-wash/40')}>
                      <CompanyLogo symbol={row.symbol} size="xs" />
                      <Link href={`/company/${row.symbol}`} className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11.5px] font-semibold text-ink">{row.symbol}</span>
                          <span className="text-[9.5px] text-faint" title={row.time === 'pre' ? 'Before market open' : row.time === 'post' ? 'After market close' : 'Time not announced'}>
                            {TIME_LABEL[row.time]}
                          </span>
                        </div>
                        <div className="truncate text-[10.5px] text-muted">
                          {row.epsForecast !== null ? `EPS est $${row.epsForecast.toFixed(2)}` : 'No estimate'}
                          {row.marketCap ? ` · $${compactNumber(row.marketCap)}` : ''}
                        </div>
                      </Link>
                      <span className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton label={`Remind me before ${row.symbol} reports`} size="xs" onClick={() => void alertMe(row)}>
                          <Bell className="size-3" />
                        </IconButton>
                        <IconButton label={`Grok earnings preview for ${row.symbol}`} size="xs" loading={previewing === row.symbol} onClick={() => void preview(row)}>
                          <Sparkles className="size-3 text-brand" />
                        </IconButton>
                      </span>
                    </div>
                  ))}
                  {dividends.length ? <div className="kicker mt-2 mb-1 px-1.5 text-[9.5px]">Ex-dividend</div> : null}
                  {dividends.map((row) => (
                    <Link key={`d-${row.symbol}`} href={`/company/${row.symbol}`} className={cn('flex items-center gap-2 rounded-sm px-1.5 py-1 text-[11.5px] hover:bg-white/[0.03]', row.mine && 'bg-brand-wash/40')}>
                      <span className="font-mono font-semibold text-ink">{row.symbol}</span>
                      <span className="num ml-auto text-muted">{row.amount !== null ? `$${row.amount.toFixed(row.amount < 1 ? 3 : 2)}` : ''}</span>
                    </Link>
                  ))}
                  {!earnings.length && !dividends.length ? <div className="px-1.5 py-3 text-[11.5px] text-faint">No company events{mineOnly ? ' for your names' : ''}.</div> : null}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-faint">Source: Nasdaq earnings, dividend and economic calendars. BMO = before market open, AMC = after market close. Economic release times shown in your time zone.</p>
      <BriefModal brief={brief} onClose={() => setBrief(null)} />
    </Page>
  );
}

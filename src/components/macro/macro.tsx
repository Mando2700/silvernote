'use client';

import { Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { MacroTape } from '@/components/macro/macro-tape';
import { LineChart } from '@/components/charts/svg';
import { Page } from '@/components/shell/page';
import { IconButton } from '@/components/ui/button';
import { Panel, PanelHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { cite } from '@/lib/citation';
import { SERIES_COLORS } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Series = {
  id: string;
  label: string;
  unit: '%' | 'bp' | 'k' | 'index' | '$' | 'x';
  note: string;
  latest: number | null;
  latestDate: string | null;
  previous: number | null;
  change: number | null;
  points: Array<{ date: string; value: number }>;
};
type Payload = {
  groups: Array<{ group: string; series: Series[] }>;
  curve: Array<{ id: string; label: string; years: number; now: number | null; monthAgo: number | null; yearAgo: number | null }>;
  source: string;
};

function fmt(value: number | null, unit: Series['unit']) {
  if (value === null) return '—';
  if (unit === '%') return `${value.toFixed(2)}%`;
  if (unit === 'bp') return `${value.toFixed(0)} bp`;
  if (unit === 'k') return `${value.toFixed(0)}k`;
  return value.toFixed(2);
}

/** Up is not always good (unemployment, spreads, inflation): only color what is unambiguous. */
const RISING_IS_BAD = new Set(['UNRATE', 'ICSA', 'SAHMREALTIME', 'BAMLH0A0HYM2', 'BAMLC0A0CM', 'NFCI', 'CPIAUCSL', 'CPILFESL', 'PCEPILFE']);

function SeriesCard({ series }: { series: Series }) {
  const change = series.change;
  const tone = !change ? 'text-muted' : !RISING_IS_BAD.has(series.id) ? 'text-ink-2' : change > 0 ? 'text-loss' : 'text-gain';
  const copyCitation = async () => {
    await navigator.clipboard.writeText(cite({ kind: 'fred', seriesId: series.id, title: series.label }, 'APA').replace(/\*/g, ''));
    toast.success('APA citation copied');
  };
  return (
    <Panel className="flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] text-muted" title={series.note}>
            {series.label}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="num text-[18px] font-semibold text-ink">{fmt(series.latest, series.unit)}</span>
            <span className={cn('num text-[11.5px]', tone)}>{change === null ? '' : `${change > 0 ? '+' : ''}${fmt(change, series.unit)}`}</span>
          </div>
          <div className="text-[10.5px] text-faint">
            {series.latestDate ?? '—'} · FRED {series.id}
          </div>
        </div>
        <IconButton label="Copy APA citation" size="xs" onClick={() => void copyCitation()}>
          <Copy className="size-3" />
        </IconButton>
      </div>
      <div className="px-2 pb-2">
        {series.points.length > 2 ? (
          <LineChart
            categories={series.points.map((point) => point.date)}
            series={[{ label: series.label, values: series.points.map((point) => point.value), emphasis: true }]}
            format={(value) => fmt(value, series.unit)}
            height={110}
            endLabels={false}
            zeroLine={['T10Y2Y', 'T10Y3M', 'PAYEMS', 'NFCI'].includes(series.id)}
          />
        ) : (
          <div className="grid h-[110px] place-items-center text-[11px] text-faint">No data</div>
        )}
      </div>
      <p className="px-3.5 pb-3 text-[11px] leading-snug text-muted">{series.note}</p>
    </Panel>
  );
}

export function Macro() {
  const [years, setYears] = useState<'2' | '5' | '10' | '20'>('5');
  const { data } = useSWR<Payload>(`/api/macro?years=${years}`, { refreshInterval: 30 * 60_000 });
  const curve = data?.curve ?? [];
  return (
    <Page
      kicker="Rates · inflation · labor · credit"
      title="Macro"
      description="The cross-asset tape and the series a macro morning run reads, straight from FRED. Every card copies its own citation."
      actions={
        <Segmented
          value={years}
          onChange={setYears}
          options={[
            { value: '2', label: '2Y' },
            { value: '5', label: '5Y' },
            { value: '10', label: '10Y' },
            { value: '20', label: '20Y' },
          ]}
        />
      }
    >
      <MacroTape />
      <Panel>
        <PanelHeader kicker="US Treasury constant maturity" title="Yield curve" />
        <div className="px-4 pb-4">
          {curve.length ? (
            <LineChart
              categories={curve.map((point) => point.label)}
              series={[
                { label: 'Today', values: curve.map((point) => point.now), emphasis: true },
                { label: '1 month ago', values: curve.map((point) => point.monthAgo), color: SERIES_COLORS[1], dashed: true },
                { label: '1 year ago', values: curve.map((point) => point.yearAgo), color: SERIES_COLORS[2] },
              ]}
              format={(value) => `${value.toFixed(2)}%`}
              height={220}
            />
          ) : (
            <Skeleton className="h-[220px] w-full" />
          )}
        </div>
      </Panel>
      {data
        ? data.groups.map((group) => (
            <section key={group.group} className="flex flex-col gap-2">
              <h2 className="kicker">{group.group}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {group.series.map((series) => (
                  <SeriesCard key={series.id} series={series} />
                ))}
              </div>
            </section>
          ))
        : Array.from({ length: 2 }, (_, index) => <Skeleton key={index} className="h-64 w-full" />)}
      <p className="text-[11px] text-faint">Sources: {data?.source ?? 'FRED'}; market tape from Yahoo Finance (delayed). FRED series update on their own release schedules.</p>
    </Page>
  );
}

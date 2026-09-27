'use client';

import { ChevronDown, Info } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import useSWR from 'swr';

import { LineChart } from '@/components/charts/svg';
import { ScoreRing } from '@/components/motion/score-ring';
import { Badge, EmptyState, Panel, PanelHeader, Skeleton } from '@/components/ui/primitives';
import { shortDate } from '@/lib/format';
import type { SilverNoteScore, SubScore } from '@/lib/score/types';
import { cn } from '@/lib/utils';

type ScoreResponse = {
  score: SilverNoteScore | null;
  history: Array<{ overall: number; calculated_at: string }>;
};

const CONFIDENCE_TONE: Record<string, 'gain' | 'neutral' | 'warning' | 'loss'> = { High: 'gain', Medium: 'neutral', Low: 'warning', Insufficient: 'loss' };

function MetricRow({ item }: { item: SubScore['metrics'][number] }) {
  const normalized = item.normalizedScore;
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)_44px] items-center gap-3 border-t border-line px-3 py-2 text-[12px]">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn('truncate', item.metric.isAvailable ? 'text-ink' : 'text-faint')}>{item.metric.name}</span>
          {item.required ? <span className="font-mono text-[9px] text-brand-soft" title="Required input">REQ</span> : null}
        </div>
        <div className="truncate text-[10.5px] text-faint" title={item.metric.explanation}>
          {item.metric.explanation}
        </div>
      </div>
      <div className={cn('num truncate text-right', item.metric.isAvailable ? 'text-ink-2' : 'text-faint')}>{item.metric.formattedValue}</div>
      <div className="relative h-1.5 rounded-full bg-white/[0.06]" title={normalized === null ? 'No data' : `${Math.round(normalized * 100)}/100`}>
        {normalized !== null ? (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-brand"
            initial={{ width: 0 }}
            animate={{ width: `${normalized * 100}%` }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            style={{ opacity: 0.4 + normalized * 0.6 }}
          />
        ) : null}
      </div>
      <div className="num text-right text-[11px] text-muted" title="Weight inside this component">
        {item.metric.weight.toFixed(1)}
      </div>
    </div>
  );
}

function ComponentCard({ subScore, index }: { subScore: SubScore; index: number }) {
  const [open, setOpen] = useState(false);
  const available = subScore.metrics.filter((item) => item.metric.isAvailable).length;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.035, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-sm border border-line bg-surface-1"
    >
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left" aria-expanded={open}>
        <ScoreRing score={subScore.score} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink">{subScore.name}</span>
            <span className="font-mono text-[10px] text-faint">weight {subScore.weight}</span>
            <Badge tone={CONFIDENCE_TONE[subScore.confidence] ?? 'neutral'}>{subScore.confidence}</Badge>
          </div>
          <div className="mt-0.5 line-clamp-1 text-[12px] text-muted">{subScore.reason}</div>
        </div>
        <span className="hidden text-[11px] text-faint sm:inline">
          {available}/{subScore.metrics.length} metrics
        </span>
        <ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
            <div className="px-3.5 pb-2 text-[11.5px] leading-relaxed text-muted">{subScore.description}</div>
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)_44px] gap-3 px-3 pb-1 font-mono text-[9.5px] tracking-wider text-faint uppercase">
              <span>Metric</span>
              <span className="text-right">Value</span>
              <span>Normalized</span>
              <span className="text-right">Wt</span>
            </div>
            {subScore.metrics.map((item) => (
              <MetricRow key={`${subScore.key}-${item.metric.id}`} item={item} />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function ScorePanel({ symbol }: { symbol: string }) {
  const { data, isLoading } = useSWR<ScoreResponse>(`/api/company/${symbol}/score`);
  const score = data?.score;

  if (isLoading && !data) {
    return (
      <Panel className="p-4">
        <Skeleton className="mb-4 h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </Panel>
    );
  }
  if (!score) {
    return (
      <Panel>
        <EmptyState icon={<Info className="size-4" />} title="Not enough data to score" body="The SilverNote Score needs filings and prices. Funds and very new listings are not scored." />
      </Panel>
    );
  }

  const history = data?.history ?? [];
  const sorted = [...score.subScores].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden">
        <div className="grid gap-6 p-5 lg:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            <ScoreRing score={score.overallScore} size="lg" label={score.label} />
            <div className="flex flex-wrap justify-center gap-1.5">
              <Badge tone={CONFIDENCE_TONE[score.confidence] ?? 'neutral'}>{score.confidence} confidence</Badge>
              <Badge tone="outline">Data {score.dataQualityScore.toFixed(1)}/5</Badge>
            </div>
          </div>
          <div className="min-w-0">
            <div className="kicker mb-2">SilverNote Score · {shortDate(score.calculatedAt)}</div>
            <p className="text-[15px] leading-relaxed text-ink">{score.shortSummary}</p>
            <div className="mt-3 grid gap-1.5 text-[12.5px] leading-relaxed">
              {sorted.filter((item) => item.score >= 70).length ? (
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-muted">Stands out</span>
                  <span className="text-ink-2">
                    {sorted
                      .filter((item) => item.score >= 70)
                      .slice(0, 3)
                      .map((item) => `${item.name} ${item.score}`)
                      .join(' · ')}
                  </span>
                </div>
              ) : null}
              {sorted.filter((item) => item.score < 60).length ? (
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-muted">Struggles</span>
                  <span className="text-ink-2">
                    {[...sorted]
                      .reverse()
                      .filter((item) => item.score < 60)
                      .slice(0, 3)
                      .map((item) => `${item.name} ${item.score}`)
                      .join(' · ')}
                  </span>
                </div>
              ) : null}
              {score.watchItems[0] ? (
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-muted">Open question</span>
                  <span className="text-ink-2">{score.watchItems[0]}</span>
                </div>
              ) : null}
            </div>
            <div className="mt-4 grid gap-1.5">
              {sorted.map((item) => (
                <div key={item.key} className="grid grid-cols-[140px_1fr_32px] items-center gap-3">
                  <span className="truncate text-[12px] text-ink-2">{item.name}</span>
                  <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full bg-brand"
                      initial={{ width: 0 }}
                      animate={{ width: `${item.score}%` }}
                      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                      style={{ opacity: 0.4 + item.score / 170 }}
                    />
                  </div>
                  <span className="num text-right text-[12px] text-ink">{item.score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel>
          <PanelHeader kicker="What drives the number" title="Components and their evidence" />
          <div className="flex flex-col gap-2 px-4 pb-4">
            {score.subScores.map((subScore, index) => (
              <ComponentCard key={subScore.key} subScore={subScore} index={index} />
            ))}
          </div>
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader kicker="History" title="Score over time" />
            <div className="px-4 pb-4">
              {history.length > 1 ? (
                <LineChart
                  categories={history.map((point) => shortDate(point.calculated_at))}
                  series={[{ label: 'SilverNote Score', values: history.map((point) => point.overall) }]}
                  format={(value) => value.toFixed(0)}
                  height={180}
                  endLabels={false}
                />
              ) : (
                <p className="text-[12px] leading-relaxed text-muted">A history line appears once the score has been recalculated a few times (weekly sweeps and every visit record it).</p>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader kicker="Signals" title="Strengths, weaknesses, open questions" />
            <div className="space-y-3 px-4 pb-4 text-[12.5px] leading-relaxed">
              {score.strengths.length ? (
                <ul className="space-y-1.5">
                  {score.strengths.map((item) => (
                    <li key={item} className="flex gap-2 text-ink-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gain" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
              {score.weaknesses.length ? (
                <ul className="space-y-1.5">
                  {score.weaknesses.map((item) => (
                    <li key={item} className="flex gap-2 text-ink-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-loss" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="space-y-1.5 border-t border-line pt-3">
                {score.watchItems.map((item) => (
                  <li key={item} className="flex gap-2 text-muted">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
          <Panel>
            <PanelHeader kicker="Transparency" title="Missing inputs" />
            <div className="px-4 pb-4">
              {score.missingData.length ? (
                <ul className="space-y-1 text-[12px]">
                  {score.missingData.slice(0, 12).map((item) => (
                    <li key={`${item.subScore}-${item.metricId}`} className="flex justify-between gap-3">
                      <span className="text-ink-2">{item.label}</span>
                      <span className="truncate text-right text-faint" title={item.reason}>
                        {item.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">Every input was available.</p>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-faint">
                Missing inputs pull a component toward a cautious 40 and lower its confidence rather than being guessed. Margins and leverage are judged on sector-appropriate scales. The headline is the weighted mean of ten components (weights sum to 100), capped when the balance sheet, cash conversion or profitability shows a serious red flag.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

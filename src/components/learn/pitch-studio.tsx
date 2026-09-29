'use client';

import { ArrowUpRight, BookOpen, FilePlus2, FlaskConical, Save, Sparkles, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { usePeers, useLearn } from '@/components/learn/hooks';
import { Page } from '@/components/shell/page';
import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Segmented, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { api } from '@/lib/client';
import { money, multiple, pct, price as fmtPrice, relativeTime, signedPct } from '@/lib/format';
import { MODEL_PITCH } from '@/lib/learn/examples';
import { isPitchEmpty, RUBRIC_WEIGHTS, scorePitch, type PitchDraft, type RubricKey, type RubricResult } from '@/lib/learn/rubric';
import { cn } from '@/lib/utils';

type Grade = {
  overall: number;
  verdict: string;
  categories: Array<{ key: string; score: number; feedback: string }>;
  strengths: string[];
  gaps: string[];
  pmQuestions: string[];
  factCheck: string[];
  model: string;
};
type Attempt = { id: string; ref: string | null; title: string; content: PitchDraft; rubric: RubricResult | null; grade: Grade | null; score: number | null; created_at: string };

const DRAFT_KEY = 'silvernote:learn:pitch-draft';
const noopSubscribe = () => () => {};

const EMPTY: PitchDraft = { symbol: '', direction: 'long', price: null, target: null, bull: null, bear: null, horizonMonths: 12, summary: '', variant: '', thesis: '', catalysts: '', valuation: '', risks: '', disconfirming: '' };

type TextKey = 'summary' | 'variant' | 'thesis' | 'catalysts' | 'valuation' | 'risks' | 'disconfirming';

const SECTIONS: Array<{ key: TextKey; rubric: RubricKey; label: string; hint: string; placeholder: string; rows: number }> = [
  { key: 'summary', rubric: 'recommendation', label: 'Summary', hint: 'The whole pitch in two sentences: call, target, why.', placeholder: 'Long XYZ at $40 with a $55 target (+38%) over 12 months: the market prices it as…, but…', rows: 3 },
  { key: 'variant', rubric: 'variant', label: 'Variant view', hint: 'What the market believes, why it’s wrong, with a number.', placeholder: 'At 12× earnings the market implies ~2% growth (reverse DCF). We think… because…', rows: 4 },
  { key: 'thesis', rubric: 'thesis', label: 'Thesis pillars', hint: 'Two to four numbered points, each with evidence.', placeholder: '1. …\n2. …\n3. …', rows: 5 },
  { key: 'catalysts', rubric: 'catalysts', label: 'Catalysts', hint: 'Dated events that close the gap.', placeholder: '- Q3 earnings (late Oct): …\n- Investor day (March): …', rows: 4 },
  { key: 'valuation', rubric: 'valuation', label: 'Valuation', hint: 'Method, math, and what bull/bear assume.', placeholder: 'DCF at 9% WACC / 2.5% g → $55. Cross-check: 14× EV/EBITDA vs peers at 12–16×… Bull: … Bear: …', rows: 4 },
  { key: 'risks', rubric: 'risks', label: 'Risks & mitigants', hint: 'Company-specific, quantified, with a mitigant.', placeholder: '- Risk: … → cost: … → mitigant: …', rows: 4 },
  { key: 'disconfirming', rubric: 'disconfirming', label: 'Kill criteria', hint: 'Measurable signals that would make you sell.', placeholder: '- Gross margin below 60% for two consecutive quarters\n- …', rows: 3 },
];

const LABELS: Record<string, string> = { ...Object.fromEntries(RUBRIC_WEIGHTS.map((item) => [item.key, item.label])), communication: 'Communication' };

function loadDraft(): PitchDraft {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<PitchDraft>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function ScoreRing({ value, size = 92, label }: { value: number; size?: number; label: string }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = value >= 80 ? 'var(--color-gain)' : value >= 60 ? 'var(--color-brand-bright)' : value >= 40 ? 'var(--color-warning)' : 'var(--color-loss)';
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} animate={{ strokeDashoffset: circumference * (1 - value / 100) }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num text-[24px] leading-none font-semibold text-ink">{Math.round(value)}</div>
          <div className="mt-1 font-mono text-[9px] tracking-widest text-muted uppercase">{label}</div>
        </div>
      </div>
    </div>
  );
}

export function PitchStudio() {
  const { askAssistant } = useShell();
  const { refresh } = useLearn();
  // The draft lives in this browser: read it on the client and render the form only once hydrated.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [draft, setDraft] = useState<PitchDraft>(() => (typeof window === 'undefined' ? EMPTY : loadDraft()));
  const [example, setExample] = useState(() => draft.symbol === MODEL_PITCH.symbol);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [submitting, setSubmitting] = useState<'grade' | 'save' | null>(null);
  const { data: history, mutate } = useSWR<{ attempts: Attempt[] }>('/api/learn/pitches');
  const peers = usePeers(draft.symbol && !example ? draft.symbol : null);
  const subject = peers.data?.subject ?? null;
  const sector = peers.data?.sector ?? null;

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // storage unavailable: the draft just won't survive a reload
    }
  }, [draft, hydrated]);
  // "Price when written" follows live data for real companies; the fictional example keeps its own.
  const livePrice = example ? draft.price : subject?.symbol === draft.symbol ? (subject?.price ?? null) : null;
  const scored = useMemo(() => ({ ...draft, price: livePrice }), [draft, livePrice]);
  const rubric = useMemo(() => scorePitch(scored), [scored]);
  const set = <K extends keyof PitchDraft>(key: K, value: PitchDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const numberField = (key: 'target' | 'bull' | 'bear') => (
    <Input
      inputMode="decimal"
      value={draft[key] ?? ''}
      onChange={(event) => {
        const value = Number(event.target.value.replace(/[$,]/g, ''));
        set(key, event.target.value.trim() && Number.isFinite(value) && value > 0 ? value : null);
      }}
      placeholder="$"
      className="font-mono"
    />
  );

  const submit = async (withGrade: boolean) => {
    if (!draft.symbol) return toast.error('Pick a company first.');
    if (isPitchEmpty(draft)) return toast.error('Write at least one section first.');
    setSubmitting(withGrade ? 'grade' : 'save');
    try {
      const result = await api<{ id: string; rubric: RubricResult; grade: Grade | null }>('/api/learn/pitches', { body: { draft: scored, grade: withGrade } });
      setGrade(result.grade);
      await Promise.all([mutate(), refresh()]);
      toast.success(withGrade ? `Grok graded it ${result.grade?.overall}/100` : 'Pitch saved', { description: `Structure score ${result.rubric.total}/100` });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSubmitting(null);
    }
  };

  const pick = (symbol: string) => {
    setExample(false);
    setGrade(null);
    setDraft((current) => ({ ...current, symbol, price: null }));
  };

  return (
    <Page
      kicker="Learn · practice · rated by rubric and Grok"
      title="Pitch studio"
      description="Pitch a real company the way you would to a PM. The structure score updates as you write; Grok then grades the judgment — variant view, valuation, catalysts, risks — checks your numbers against SilverNote data, and asks the questions a PM would."
      actions={
        <>
          <Button
            variant="outline"
            icon={<BookOpen className="size-3.5" />}
            onClick={() => {
              setDraft({ ...MODEL_PITCH });
              setExample(true);
              setGrade(null);
            }}
          >
            Load example
          </Button>
          <Button
            variant="ghost"
            icon={<FilePlus2 className="size-3.5" />}
            onClick={() => {
              setDraft(EMPTY);
              setExample(false);
              setGrade(null);
            }}
          >
            New pitch
          </Button>
        </>
      }
    >
      {!hydrated ? (
        <Skeleton className="h-[640px] w-full" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Panel className="p-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Company" className="min-w-52">
                  {draft.symbol ? (
                    <div className="flex h-8 items-center gap-2">
                      <CompanyLogo symbol={draft.symbol} size="sm" />
                      <span className="font-mono text-[14px] font-semibold text-ink">{draft.symbol}</span>
                      <span className="max-w-48 truncate text-[12.5px] text-muted">{example ? MODEL_PITCH.company : subject?.name}</span>
                      <TickerSearch onPick={pick} placeholder="Change…" className="w-28" />
                    </div>
                  ) : (
                    <TickerSearch onPick={pick} placeholder="Search any company…" className="w-64" autoFocus />
                  )}
                </Field>
                <Field label="Call">
                  <Segmented value={draft.direction} onChange={(value) => set('direction', value)} options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} />
                </Field>
                <Field label="Horizon">
                  <Select value={draft.horizonMonths} onChange={(event) => set('horizonMonths', Number(event.target.value))} className="w-28">
                    {[6, 12, 18, 24, 36].map((months) => (
                      <option key={months} value={months}>
                        {months} months
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Target" className="w-24">{numberField('target')}</Field>
                <Field label="Bull" className="w-24">{numberField('bull')}</Field>
                <Field label="Bear" className="w-24">{numberField('bear')}</Field>
              </div>
              {draft.symbol && !example ? (
                subject ? (
                  <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                      {[
                        { label: 'Price', value: subject.price ? `$${fmtPrice(subject.price)}` : '—' },
                        { label: 'Market cap', value: money(subject.marketCap, { compact: true }) },
                        { label: 'P/E', value: multiple(subject.pe, 1), sub: sector?.pe ? `sector ${multiple(sector.pe, 1)}` : undefined },
                        { label: 'EV/EBITDA', value: multiple(subject.evEbitda, 1), sub: sector?.evEbitda ? `sector ${multiple(sector.evEbitda, 1)}` : undefined },
                        { label: 'Rev growth', value: pct(subject.revenueGrowth, 1), sub: `3y ${pct(subject.revenueCagr3, 1)}` },
                        { label: 'Op margin', value: pct(subject.operatingMargin, 1) },
                        { label: 'Score', value: subject.score !== null ? Math.round(subject.score).toString() : '—', sub: subject.scoreLabel ?? undefined },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-sm border border-line bg-surface-1 px-2.5 py-1.5">
                          <div className="text-[10.5px] text-muted">{stat.label}</div>
                          <div className="num text-[13.5px] font-semibold text-ink">{stat.value}</div>
                          {stat.sub ? <div className="truncate text-[10px] text-faint">{stat.sub}</div> : null}
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[11.5px] text-muted">Research kit:</span>
                      {[
                        { href: `/company/${draft.symbol}?tab=dcf`, label: 'DCF & reverse DCF' },
                        { href: `/company/${draft.symbol}?tab=peers`, label: 'Peers' },
                        { href: `/company/${draft.symbol}?tab=financials`, label: 'Financials' },
                        { href: `/company/${draft.symbol}?tab=news`, label: 'News & filings' },
                      ].map((link) => (
                        <Link key={link.href} href={link.href} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-[11.5px] text-ink-2 hover:border-line-strong hover:text-ink">
                          {link.label}
                          <ArrowUpRight className="size-3" />
                        </Link>
                      ))}
                      <Button size="xs" variant="ghost" onClick={() => askAssistant(`Give me the strongest bear case on ${draft.symbol} with specific numbers, what consensus currently expects, and the dated catalysts in the next 12 months.`, { type: 'company', symbol: draft.symbol })}>
                        <Sparkles className="size-3 text-brand" /> Bear case from Grok
                      </Button>
                    </div>
                  </div>
                ) : peers.isLoading ? (
                  <div className="mt-3 text-[12px] text-muted">Loading {draft.symbol}…</div>
                ) : null
              ) : example ? (
                <div className="mt-3 rounded-sm border border-ion/20 bg-ion/[0.04] px-3 py-2 text-[12px] text-ink-2">
                  This is the annotated model pitch on a fictional company. See how it scores, try editing it, then click <strong>New pitch</strong> and write one on a real company.
                </div>
              ) : null}
            </Panel>

            {SECTIONS.map((section) => {
              const item = rubric.items.find((entry) => entry.key === section.rubric);
              const score = item ? Math.round(item.score * 100) : 0;
              return (
                <Panel key={section.key} className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[13.5px] font-semibold text-ink">{section.label}</div>
                      <div className="text-[11.5px] text-muted">{section.hint}</div>
                    </div>
                    {section.key !== 'summary' || draft.summary ? (
                      <span className={cn('rounded-xs px-1.5 py-0.5 font-mono text-[10.5px]', score >= 80 ? 'bg-gain/10 text-gain' : score >= 50 ? 'bg-warning/10 text-warning' : 'bg-white/[0.05] text-muted')}>{score}%</span>
                    ) : null}
                  </div>
                  <Textarea
                    rows={section.rows}
                    value={draft[section.key]}
                    onChange={(event) => set(section.key, event.target.value)}
                    placeholder={section.placeholder}
                    className="min-h-0 text-[13px]"
                  />
                  {item?.notes.length && draft[section.key].trim() ? (
                    <div className="mt-1.5 flex flex-col gap-0.5">
                      {item.notes.slice(0, 2).map((note) => (
                        <span key={note} className="text-[11.5px] text-warning/90">→ {note}</span>
                      ))}
                    </div>
                  ) : null}
                </Panel>
              );
            })}
          </div>

          <div className="flex flex-col gap-4 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:self-start xl:overflow-y-auto xl:pr-1 xl:[scrollbar-gutter:stable]">
            <Panel className="p-4">
              <div className="flex items-center gap-4">
                <ScoreRing value={rubric.total} label="structure" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded-sm border border-line bg-surface-1 px-2 py-1">
                      <div className="text-[10.5px] text-muted">Target implies</div>
                      <div className={cn('num text-[13px] font-semibold', rubric.upside === null ? 'text-muted' : (draft.direction === 'long' ? rubric.upside : -rubric.upside) > 0 ? 'text-gain' : 'text-loss')}>{rubric.upside !== null ? signedPct(rubric.upside, 0) : '—'}</div>
                    </div>
                    <div className="rounded-sm border border-line bg-surface-1 px-2 py-1">
                      <div className="text-[10.5px] text-muted">Up : down</div>
                      <div className={cn('num text-[13px] font-semibold', rubric.skew !== null && rubric.skew >= 2 ? 'text-gain' : 'text-ink')}>{rubric.skew !== null ? `${rubric.skew.toFixed(1)} : 1` : '—'}</div>
                    </div>
                  </div>
                  <div className="text-[11px] leading-snug text-faint">Instant check of form and completeness. Grok grades the judgment.</div>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-1.5">
                {rubric.items.map((item) => (
                  <div key={item.key} className="grid grid-cols-[112px_1fr_36px] items-center gap-2 text-[11.5px]">
                    <span className="truncate text-ink-2">{item.label}</span>
                    <div className="h-1.5 rounded-full bg-surface-4">
                      <div className={cn('h-1.5 rounded-full transition-[width] duration-300', item.score >= 0.8 ? 'bg-gain-fill' : item.score >= 0.5 ? 'bg-warning' : 'bg-loss-fill')} style={{ width: `${Math.max(2, item.score * 100)}%` }} />
                    </div>
                    <span className="num text-right font-mono text-muted">
                      {Math.round(item.score * item.weight)}/{item.weight}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" size="md" className="flex-1" loading={submitting === 'grade'} disabled={submitting !== null} icon={<Sparkles className="size-3.5" />} onClick={() => submit(true)}>
                  Grade with Grok
                </Button>
                <Button variant="outline" size="md" loading={submitting === 'save'} disabled={submitting !== null} icon={<Save className="size-3.5" />} onClick={() => submit(false)}>
                  Save
                </Button>
              </div>
              {submitting === 'grade' ? <div className="thinking-shimmer mt-2 text-[11.5px] text-muted">Grok is reading your pitch and checking it against {draft.symbol}’s data…</div> : null}
            </Panel>

            {grade ? <GradeCard grade={grade} /> : null}

            <Panel>
              <PanelHeader kicker="History" title="Your pitches" />
              {history?.attempts.length ? (
                <div className="flex max-h-80 flex-col overflow-y-auto px-2 pb-2">
                  {history.attempts.map((attempt) => (
                    <div key={attempt.id} className="group flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-white/[0.03]">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => {
                          setDraft({ ...EMPTY, ...attempt.content });
                          setExample(attempt.content.symbol === MODEL_PITCH.symbol);
                          setGrade(attempt.grade);
                        }}
                      >
                        {attempt.ref ? <CompanyLogo symbol={attempt.ref} size="xs" /> : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{attempt.title}</span>
                          <span className="block text-[10.5px] text-faint">{relativeTime(attempt.created_at)}</span>
                        </span>
                        {attempt.grade ? <Badge tone="brand">Grok {attempt.grade.overall}</Badge> : <Badge tone="outline">rubric {attempt.rubric?.total ?? '—'}</Badge>}
                      </button>
                      <button
                        type="button"
                        aria-label="Delete pitch"
                        className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-loss"
                        onClick={async () => {
                          await api(`/api/learn/pitches/${attempt.id}`, { method: 'DELETE' }).catch((error: Error) => toast.error(error.message));
                          await Promise.all([mutate(), refresh()]);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<FlaskConical className="size-4" />} title="No pitches yet" body="Save or grade a pitch and it lands here, with its scores, so you can watch yourself improve." />
              )}
            </Panel>
          </div>
        </div>
      )}
    </Page>
  );
}

function GradeCard({ grade }: { grade: Grade }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Panel className="p-4">
        <div className="flex items-center gap-4">
          <ScoreRing value={grade.overall} label="Grok" />
          <div className="min-w-0 text-[13px] leading-relaxed text-ink">{grade.verdict}</div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {grade.categories.map((category) => (
            <div key={category.key}>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-ink-2">{LABELS[category.key] ?? category.key}</span>
                <span className={cn('num font-mono', category.score >= 8 ? 'text-gain' : category.score >= 6 ? 'text-ink' : 'text-loss')}>{category.score}/10</span>
              </div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{category.feedback}</div>
            </div>
          ))}
        </div>
        {[
          { title: 'Strengths', items: grade.strengths, tone: 'text-gain' },
          { title: 'Gaps to close', items: grade.gaps, tone: 'text-warning' },
          { title: 'A PM would ask', items: grade.pmQuestions, tone: 'text-brand' },
          { title: 'Fact check', items: grade.factCheck, tone: 'text-loss' },
        ]
          .filter((group) => group.items.length)
          .map((group) => (
            <div key={group.title} className="mt-4">
              <div className="kicker mb-1">{group.title}</div>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-2 text-[12px] leading-snug text-ink-2">
                    <span className={cn('mt-[5px] size-1.5 shrink-0 rounded-full bg-current', group.tone)} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        <div className="mt-3 text-[10.5px] text-faint">Graded by {grade.model}. Practice feedback, not investment advice.</div>
      </Panel>
    </motion.div>
  );
}

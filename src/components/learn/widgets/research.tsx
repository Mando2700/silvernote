'use client';

import { Check, RotateCcw, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { AskGrok, DataState, Readout, Slider, TickerPicker, Widget } from '@/components/learn/blocks';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/primitives';
import { MODEL_PITCH, THESIS_PAIRS } from '@/lib/learn/examples';
import { RUBRIC_WEIGHTS } from '@/lib/learn/rubric';
import { pct, price as fmtPrice, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';

// ─── Weak vs strong ─────────────────────────────────────────────────────────

export function ThesisCompare() {
  const [strong, setStrong] = useState<Record<number, boolean>>({});
  return (
    <Widget title="Same idea, weak vs strong" kicker="Flip each card" footer="The example company is fictional so its numbers can be internally consistent; the full pitch is in the Pitching lesson and loads as the example in Pitch studio.">
      <div className="grid gap-3 md:grid-cols-2">
        {THESIS_PAIRS.map((pair, index) => {
          const isStrong = strong[index] ?? false;
          return (
            <button
              key={pair.part}
              type="button"
              onClick={() => setStrong((current) => ({ ...current, [index]: !isStrong }))}
              className={cn('group flex min-h-40 flex-col rounded-md border p-3.5 text-left transition-colors', isStrong ? 'border-gain/30 bg-gain/[0.04]' : 'border-loss/25 bg-loss/[0.035]')}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="kicker">{pair.part}</span>
                <span className={cn('flex items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase', isStrong ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss')}>
                  {isStrong ? <Check className="size-3" /> : <X className="size-3" />}
                  {isStrong ? 'Strong' : 'Weak'}
                </span>
              </div>
              <AnimatePresence mode="wait">
                <motion.p key={String(isStrong)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} className="flex-1 text-[13px] leading-relaxed text-ink">
                  “{isStrong ? pair.strong : pair.weak}”
                </motion.p>
              </AnimatePresence>
              <div className="mt-2 text-[11.5px] text-muted">{isStrong ? pair.why : 'Click to see the strong version →'}</div>
            </button>
          );
        })}
      </div>
    </Widget>
  );
}

// ─── Catalyst sorter ─────────────────────────────────────────────────────────

const CATALYSTS: Array<{ text: string; hard: boolean; why: string }> = [
  { text: 'Q3 earnings on October 28 — first quarter with the new segment disclosure', hard: true, why: 'Dated, and the disclosure itself forces the market to see the numbers.' },
  { text: 'Management could expand into Europe at some point', hard: false, why: 'No date, no commitment — a hope, not a catalyst.' },
  { text: 'FDA decision (PDUFA) date set for March 14', hard: true, why: 'A scheduled regulatory decision with a binary, knowable outcome.' },
  { text: 'Sentiment on the sector should improve', hard: false, why: 'Nothing observable happens on a date; macro and sentiment are soft.' },
  { text: 'Shareholder vote on the announced merger on June 3', hard: true, why: 'A scheduled event that closes a known spread.' },
  { text: 'The market will eventually recognize the hidden value', hard: false, why: 'The classic non-catalyst: it restates the thesis instead of naming a trigger.' },
  { text: 'Investor day in May where management has promised long-term margin targets', hard: true, why: 'Dated and management has committed to disclose specific targets.' },
  { text: 'A competitor might stumble', hard: false, why: 'Possible, not scheduled, and outside the company’s control.' },
  { text: 'Spin-off of the software unit completes on January 1 (Form 10 filed)', hard: true, why: 'A filed, dated corporate action — separate trading often re-rates the parts.' },
  { text: 'Possible index inclusion if the market cap keeps rising', hard: false, why: 'Conditional and undated; inclusion is decided by a committee.' },
];

export function CatalystSorter() {
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const done = Object.keys(answers).length;
  const correct = Object.entries(answers).filter(([index, hard]) => CATALYSTS[Number(index)].hard === hard).length;
  return (
    <Widget
      title="Hard or soft? Sort these catalysts"
      kicker={`${correct}/${done} correct${done === CATALYSTS.length ? ' · done' : ''}`}
      actions={
        done ? (
          <Button size="xs" variant="ghost" icon={<RotateCcw className="size-3" />} onClick={() => setAnswers({})}>
            Reset
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-1.5">
        {CATALYSTS.map((item, index) => {
          const answered = index in answers;
          const right = answered && answers[index] === item.hard;
          return (
            <div key={item.text} className={cn('rounded-md border px-3 py-2 transition-colors', !answered ? 'border-line bg-surface-1' : right ? 'border-gain/30 bg-gain/[0.04]' : 'border-loss/30 bg-loss/[0.04]')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] text-ink">{item.text}</span>
                {!answered ? (
                  <div className="flex gap-1">
                    <Button size="xs" variant="outline" onClick={() => setAnswers((current) => ({ ...current, [index]: true }))}>
                      Hard
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => setAnswers((current) => ({ ...current, [index]: false }))}>
                      Soft
                    </Button>
                  </div>
                ) : (
                  <span className={cn('flex items-center gap-1 font-mono text-[11px]', right ? 'text-gain' : 'text-loss')}>
                    {right ? <Check className="size-3" /> : <X className="size-3" />}
                    {item.hard ? 'Hard' : 'Soft'}
                  </span>
                )}
              </div>
              {answered ? <div className="mt-1 text-[12px] text-muted">{item.why}</div> : null}
            </div>
          );
        })}
      </div>
    </Widget>
  );
}

// ─── Probability-weighted risk/reward on a live price ────────────────────────

type CompanyLite = { security: { name: string; price: number | null } | null; quote: { price: number | null } | null };

export function RiskRewardLab() {
  const [symbol, setSymbol] = useState('GOOGL');
  const { data, isLoading, error } = useSWR<CompanyLite>(`/api/company/${encodeURIComponent(symbol)}`, { keepPreviousData: false });
  const price = data?.quote?.price ?? data?.security?.price ?? null;
  return (
    <Widget
      kicker={`Live price · ${symbol}`}
      title="Bull, base, bear — and what they’re worth together"
      actions={<AskGrok symbol={symbol} prompt={`Build bull, base and bear cases for ${symbol} with 12-month price targets and probabilities. For each, name the key assumption and what would have to happen.`} label="Draft scenarios" />}
      footer="Expected value = Σ probability × scenario value. A good long has a positive expected return and a skew of 2:1 or better, so being wrong costs much less than being right earns."
    >
      <div className="mb-3">
        <TickerPicker value={symbol} onChange={setSymbol} suggestions={['GOOGL', 'DIS', 'PFE', 'UBER', 'LULU']} />
      </div>
      {!price ? <DataState loading={isLoading} error={error} empty="No price for this ticker." height={240} /> : <RiskRewardBody key={symbol} price={price} />}
    </Widget>
  );
}

function RiskRewardBody({ price }: { price: number }) {
  const round = (value: number) => Math.round(value * 100) / 100;
  const [bull, setBull] = useState(round(price * 1.5));
  const [base, setBase] = useState(round(price * 1.2));
  const [bear, setBear] = useState(round(price * 0.75));
  const [pBull, setPBull] = useState(0.25);
  const [pBear, setPBear] = useState(0.25);
  const pBase = Math.max(0, 1 - pBull - pBear);
  const expected = pBull * bull + pBase * base + pBear * bear;
  const skew = bear < price && bull > price ? (bull - price) / (price - bear) : null;
  const min = Math.min(bear, price) * 0.9;
  const max = Math.max(bull, price) * 1.08;
  const at = (value: number) => ((value - min) / (max - min)) * 100;
  const scenarios = [
    { label: 'Bear', value: bear, p: pBear, color: 'bg-loss-fill' },
    { label: 'Base', value: base, p: pBase, color: 'bg-series-1' },
    { label: 'Bull', value: bull, p: pBull, color: 'bg-gain-fill' },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-3.5">
        <Slider label="Bull case" value={bull} min={round(price)} max={round(price * 3)} step={round(Math.max(0.01, price / 200))} onChange={setBull} format={(v) => `$${fmtPrice(v)} (${signedPct(v / price - 1, 0)})`} />
        <Slider label="Base case" value={base} min={round(price * 0.5)} max={round(price * 2)} step={round(Math.max(0.01, price / 200))} onChange={setBase} format={(v) => `$${fmtPrice(v)} (${signedPct(v / price - 1, 0)})`} />
        <Slider label="Bear case" value={bear} min={round(price * 0.2)} max={round(price)} step={round(Math.max(0.01, price / 200))} onChange={setBear} format={(v) => `$${fmtPrice(v)} (${signedPct(v / price - 1, 0)})`} />
        <Slider label="P(bull)" value={pBull} min={0} max={1 - pBear} step={0.05} onChange={setPBull} format={(v) => pct(v, 0)} />
        <Slider label="P(bear)" value={pBear} min={0} max={1 - pBull} step={0.05} onChange={setPBear} format={(v) => `${pct(v, 0)} · base ${pct(pBase, 0)}`} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <Readout label="Expected value" value={`$${fmtPrice(expected)}`} tone="brand" />
          <Readout label="Expected return" value={signedPct(expected / price - 1, 1)} tone={expected >= price ? 'gain' : 'loss'} />
          <Readout label="Upside : downside" value={skew !== null ? `${skew.toFixed(1)} : 1` : '—'} tone={skew !== null && skew >= 2 ? 'gain' : undefined} sub={skew !== null && skew < 2 ? 'want 2:1 or better' : undefined} />
        </div>
        <div className="relative h-28 rounded-md border border-line bg-surface-1">
          {scenarios.map((scenario, index) => (
            <div key={scenario.label} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${at(scenario.value)}%`, top: 10 + index * 4 }}>
              <div className={cn('rounded-xs transition-[height] duration-300 ease-out', scenario.color)} style={{ width: 10, height: Math.max(6, scenario.p * 64) }} />
              <span className="num mt-1 text-[10.5px] whitespace-nowrap text-ink-2">
                {scenario.label} ${fmtPrice(scenario.value)} · {pct(scenario.p, 0)}
              </span>
            </div>
          ))}
          <div className="absolute top-2 bottom-2 w-px bg-white/60" style={{ left: `${at(price)}%` }}>
            <span className="num absolute -top-0.5 left-1.5 text-[10.5px] whitespace-nowrap text-white">now ${fmtPrice(price)}</span>
          </div>
          <div className="absolute top-2 bottom-2 w-px border-l border-dashed border-brand-bright" style={{ left: `${at(expected)}%` }}>
            <span className="num absolute bottom-0 left-1.5 text-[10.5px] whitespace-nowrap text-brand-bright">EV ${fmtPrice(expected)}</span>
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-muted">
          Bar height is probability. Try a “great company” with a small bear case and a modest bull case — the expected return can be high while the skew stays poor, which is exactly what a PM will push on.
        </p>
      </div>
    </div>
  );
}

// ─── Annotated model pitch ──────────────────────────────────────────────────

const ANNOTATIONS: Record<string, string> = {
  summary: 'Call, price, target, upside and horizon in the first sentence — then the one reason.',
  variant: 'States what the market believes (a trucking multiple, ~3% growth) and why it is wrong, with numbers.',
  thesis: 'Three pillars, each a checkable claim with data. Two to four is the sweet spot.',
  catalysts: 'Every catalyst has a date or a reporting event, and a mechanism for closing the gap.',
  valuation: 'Names the method, shows the math, cross-checks with a DCF, and gives bull and bear values for asymmetry.',
  risks: 'Company-specific, quantified, each with a mitigant or a sizing rule.',
  disconfirming: 'Measurable thresholds decided before owning the stock.',
};

export function AnnotatedPitch() {
  const [view, setView] = useState<'pitch' | 'rubric'>('pitch');
  const sections: Array<{ key: keyof typeof ANNOTATIONS; label: string; text: string }> = [
    { key: 'summary', label: 'Recommendation', text: MODEL_PITCH.summary },
    { key: 'variant', label: 'Variant view', text: MODEL_PITCH.variant },
    { key: 'thesis', label: 'Thesis', text: MODEL_PITCH.thesis },
    { key: 'catalysts', label: 'Catalysts', text: MODEL_PITCH.catalysts },
    { key: 'valuation', label: 'Valuation', text: MODEL_PITCH.valuation },
    { key: 'risks', label: 'Risks & mitigants', text: MODEL_PITCH.risks },
    { key: 'disconfirming', label: 'Kill criteria', text: MODEL_PITCH.disconfirming },
  ];
  return (
    <Widget
      title={`A model pitch, annotated — ${MODEL_PITCH.company}`}
      kicker={`Long · $${MODEL_PITCH.price} → $${MODEL_PITCH.target} · bull $${MODEL_PITCH.bull} / bear $${MODEL_PITCH.bear}`}
      actions={<Segmented size="xs" value={view} onChange={setView} options={[{ value: 'pitch', label: 'Pitch' }, { value: 'rubric', label: 'How it’s judged' }]} />}
      footer={
        <span>
          Open it in <Link href="/learn/pitch" className="text-brand-soft underline underline-offset-2">Pitch studio</Link> (Load example) to see the rubric score it, then write your own on a real company.
        </span>
      }
    >
      {view === 'pitch' ? (
        <div className="flex flex-col divide-y divide-line">
          {sections.map((section) => (
            <div key={section.key} className="grid gap-2 py-3 md:grid-cols-[1fr_240px] md:gap-5">
              <div>
                <div className="kicker mb-1">{section.label}</div>
                <div className="text-[13px] leading-relaxed whitespace-pre-line text-ink">{section.text}</div>
              </div>
              <div className="self-start rounded-sm border-l-2 border-ion/50 bg-ion/[0.04] px-2.5 py-1.5 text-[12px] leading-snug text-ink-2">{ANNOTATIONS[section.key]}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {RUBRIC_WEIGHTS.map((item) => (
            <div key={item.key} className="grid grid-cols-[150px_1fr_44px] items-center gap-3">
              <span className="text-[12.5px] text-ink">{item.label}</span>
              <div>
                <div className="h-2 rounded-full bg-surface-4">
                  <div className="h-2 rounded-full bg-gradient-to-r from-brand-deep to-brand transition-[width] duration-300 ease-out" style={{ width: `${item.weight * 5}%` }} />
                </div>
                <div className="mt-1 text-[11.5px] text-muted">{item.what}</div>
              </div>
              <span className="num text-right font-mono text-[12px] text-ink-2">{item.weight} pts</span>
            </div>
          ))}
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Weights follow university pitch-competition rubrics (investment idea ≈ half the score) and what hedge-fund interviewers probe: the variant view first, then valuation, catalysts and risk. Grok grades the judgment on top of this structure check, and adds a communication score.
          </p>
        </div>
      )}
    </Widget>
  );
}

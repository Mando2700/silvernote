'use client';

import { ArrowUpRight, Landmark, Lightbulb, MessageSquareQuote, Sparkles, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { createContext, useContext, useId, type ReactNode } from 'react';

import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Panel, PanelHeader } from '@/components/ui/primitives';
import { TickerSearch } from '@/components/ui/ticker-search';
import { cn } from '@/lib/utils';

/**
 * The open lesson's slug. Kept-alive pages stay in the DOM while hidden, so section anchors are
 * prefixed with it to stay unique across lessons.
 */
export const LessonSlugContext = createContext('lesson');

export function sectionAnchor(slug: string, id: string) {
  return `${slug}--${id}`;
}

/** A lesson section with an anchor the outline links to. */
export function Section({ id, index, title, children }: { id: string; index: number; title: string; children: ReactNode }) {
  const slug = useContext(LessonSlugContext);
  return (
    <section id={sectionAnchor(slug, id)} className="scroll-mt-20">
      <div className="mb-2 flex items-center gap-3">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-faint">{String(index).padStart(2, '0')}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-line-strong to-transparent" />
      </div>
      <h2 className="mb-3 text-[19px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Body text at a readable measure. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('prose-rn max-w-[72ch] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}>{children}</div>;
}

const CALLOUTS = {
  key: { icon: Lightbulb, label: 'Key idea', className: 'border-ion/25 bg-ion/[0.04]', iconClass: 'text-ion' },
  interview: { icon: MessageSquareQuote, label: 'Interview angle', className: 'border-brand/25 bg-brand-wash', iconClass: 'text-brand' },
  pitfall: { icon: TriangleAlert, label: 'Common mistake', className: 'border-warning/25 bg-warning/[0.05]', iconClass: 'text-warning' },
  street: { icon: Landmark, label: 'On the Street', className: 'border-series-4/30 bg-series-4/[0.05]', iconClass: 'text-series-4' },
} as const;

export function Callout({ tone = 'key', title, children }: { tone?: keyof typeof CALLOUTS; title?: string; children: ReactNode }) {
  const config = CALLOUTS[tone];
  const Icon = config.icon;
  return (
    <div className={cn('max-w-[80ch] rounded-md border px-4 py-3', config.className)}>
      <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-ink">
        <Icon className={cn('size-3.5', config.iconClass)} strokeWidth={2} />
        {title ?? config.label}
      </div>
      <div className="prose-rn text-[13px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </div>
  );
}

/** A displayed formula with an optional legend of its terms. */
export function Formula({ children, where, className }: { children: ReactNode; where?: Array<[string, string]>; className?: string }) {
  return (
    <div className={cn('max-w-[80ch] overflow-x-auto rounded-md border border-line bg-surface-1 px-4 py-3', className)}>
      <div className="font-mono text-[14px] tracking-tight whitespace-nowrap text-ink">{children}</div>
      {where?.length ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          {where.map(([term, meaning]) => (
            <div key={term} className="contents">
              <dt className="font-mono text-brand-soft">{term}</dt>
              <dd className="text-muted">{meaning}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Frame for an interactive widget. */
export function Widget({ title, kicker = 'Interactive', actions, children, className, footer }: { title: string; kicker?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <Panel className={cn('overflow-hidden', className)}>
      <PanelHeader kicker={kicker} title={title} actions={actions} />
      <div className="px-4 pb-4">{children}</div>
      {footer ? <div className="border-t border-line bg-surface-1/60 px-4 py-2.5 text-[12px] text-muted">{footer}</div> : null}
    </Panel>
  );
}

/** Labelled range input with the formatted value on the right. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  hint?: string;
}) {
  const id = useId();
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12px] text-ink-2">
          {label}
        </label>
        <span className="num font-mono text-[12.5px] font-medium text-ink">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="learn-range"
        style={{ ['--fill' as string]: `${Math.max(0, Math.min(100, fill))}%` }}
      />
      {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
    </div>
  );
}

/** Current ticker, quick picks, and a search box — for widgets that run on real companies. */
export function TickerPicker({ value, onChange, suggestions, label = 'Company' }: { value: string; onChange: (symbol: string) => void; suggestions: string[]; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11.5px] text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {[...new Set([value, ...suggestions])].map((symbol) => (
          <button
            key={symbol}
            type="button"
            onClick={() => onChange(symbol)}
            className={cn(
              'flex h-6.5 items-center gap-1.5 rounded-sm border px-1.5 font-mono text-[11.5px] transition-colors',
              symbol === value ? 'border-brand/50 bg-brand-wash text-ink' : 'border-line text-muted hover:border-line-strong hover:text-ink-2',
            )}
          >
            <CompanyLogo symbol={symbol} size="xs" />
            {symbol}
          </button>
        ))}
      </div>
      <TickerSearch onPick={onChange} placeholder="Any ticker…" className="w-40" />
    </div>
  );
}

/** Prepares a question for Grok in the side panel. */
export function AskGrok({ prompt, label = 'Ask Grok', symbol }: { prompt: string; label?: string; symbol?: string }) {
  const { askAssistant } = useShell();
  return (
    <Button size="xs" variant="ghost" onClick={() => askAssistant(prompt, symbol ? { type: 'company', symbol } : undefined)}>
      <Sparkles className="size-3 text-brand" />
      {label}
    </Button>
  );
}

/** Links out to the SilverNote feature where the lesson is used for real. */
export function TryItCards({ items }: { items: Array<{ href: string; label: string; description: string }> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <Link key={`${item.href}-${item.label}`} href={item.href} className="group rounded-md border border-line bg-surface-1 px-3.5 py-3 transition-colors hover:border-line-strong hover:bg-surface-3">
          <div className="flex items-center justify-between text-[13px] font-medium text-ink">
            {item.label}
            <ArrowUpRight className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand" />
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-muted">{item.description}</div>
        </Link>
      ))}
    </div>
  );
}

/** Small readout used inside widgets. */
export function Readout({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: 'gain' | 'loss' | 'brand'; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-sm border border-line bg-surface-1 px-3 py-2">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={cn('num mt-0.5 truncate text-[16px] font-semibold tracking-[-0.01em]', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : tone === 'brand' ? 'text-brand-bright' : 'text-ink')}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-faint">{sub}</div> : null}
    </div>
  );
}

/** Loading / error placeholder for live-data widgets. */
export function DataState({ loading, error, empty, height = 220 }: { loading?: boolean; error?: unknown; empty?: string | null; height?: number }) {
  return (
    <div className="grid place-items-center rounded-md border border-dashed border-line text-center text-[12.5px] text-muted" style={{ height }}>
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="size-1.5 animate-pulse rounded-full bg-ion" />
          Loading live data…
        </span>
      ) : error ? (
        <span className="max-w-sm px-4">Couldn’t load this company’s data: {(error as Error)?.message ?? 'unknown error'}. Try another ticker.</span>
      ) : (
        <span className="max-w-sm px-4">{empty}</span>
      )}
    </div>
  );
}

'use client';

import { ArrowUpRight, BookOpen, Check, Sparkles, TrendingDown, TrendingUp, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Page } from '@/components/shell/page';
import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Badge, Panel, Segmented } from '@/components/ui/primitives';
import { LESSON_BY_SLUG } from '@/lib/learn/curriculum';
import { CASES, type CaseStudy } from '@/lib/learn/examples';
import { caseMinutes } from '@/lib/learn/progress';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'worked' | 'failed' | 'long' | 'short';

export function CaseLibrary() {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState(CASES[0].id);
  const list = CASES.filter((item) => filter === 'all' || item.outcome === filter || item.direction === filter);
  const current = CASES.find((item) => item.id === selected) ?? CASES[0];

  return (
    <Page
      kicker="Learn · case library"
      title="Case library"
      description="Famous investment theses retold in the pitch format — what the market believed, the variant view, the catalysts, and what actually happened. Study the failures as closely as the wins."
      actions={
        <Link href="/learn" className="text-[12.5px] text-muted hover:text-ink">
          ← All lessons
        </Link>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'worked', label: 'Worked' },
            { value: 'failed', label: 'Failed' },
            { value: 'long', label: 'Longs' },
            { value: 'short', label: 'Shorts' },
          ]}
        />
        <Link href="/learn/stock-pitch" className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
          <BookOpen className="size-3.5" /> See the annotated model pitch
        </Link>
      </div>
      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {list.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className={cn('rounded-md border p-3 text-left transition-colors', item.id === current.id ? 'border-brand/50 bg-brand-wash' : 'border-line bg-surface-2 hover:border-line-strong')}
            >
              <div className="flex items-center gap-2">
                {item.symbol ? <CompanyLogo symbol={item.symbol} size="xs" /> : null}
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{item.title}</span>
              </div>
              <div className="mt-1 text-[11.5px] text-muted">
                {item.investor} · {item.period} · {caseMinutes(item)} min read
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <Badge tone="outline">{item.direction === 'long' ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}{item.direction}</Badge>
                <Badge tone={item.outcome === 'worked' ? 'gain' : 'loss'}>{item.outcome === 'worked' ? <Check className="size-3" /> : <X className="size-3" />}{item.outcome}</Badge>
              </div>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={current.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <CaseDetail item={current} />
          </motion.div>
        </AnimatePresence>
      </div>
    </Page>
  );
}

function CaseDetail({ item }: { item: CaseStudy }) {
  const { askAssistant } = useShell();
  const router = useRouter();
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="kicker mb-1">
            {item.company} · {item.period} · {item.direction} · {caseMinutes(item)} min read
          </div>
          <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">{item.title}</h2>
          <p className="mt-1 text-[13.5px] text-brand-soft italic">{item.tagline}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {item.symbol ? (
            <Button size="sm" variant="outline" icon={<ArrowUpRight className="size-3.5" />} onClick={() => router.push(`/company/${item.symbol}`)}>
              {item.symbol} today
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            icon={<Sparkles className="size-3.5 text-brand" />}
            onClick={() =>
              askAssistant(
                `Teach me the ${item.title} case (${item.investor}, ${item.period}). What exactly was the variant view, what evidence supported it, what were the key numbers, and what should an analyst take from it today? ${item.symbol ? `Then compare it with ${item.symbol} today.` : ''}`,
                item.symbol ? { type: 'company', symbol: item.symbol } : undefined,
              )
            }
          >
            Go deeper with Grok
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-5">
        <Block title="The setup">{item.setup}</Block>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-line bg-surface-1 p-3.5">
            <div className="kicker mb-1.5">What the market believed</div>
            <p className="text-[13px] leading-relaxed text-ink-2">{item.consensus}</p>
          </div>
          <div className="rounded-md border border-ion/25 bg-ion/[0.04] p-3.5">
            <div className="kicker mb-1.5 text-ion">The variant view</div>
            <p className="text-[13px] leading-relaxed text-ink">{item.variant}</p>
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <List title="Evidence" items={item.evidence} />
          <List title="Catalysts" items={item.catalysts} />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Block title="Valuation">{item.valuation}</Block>
          <List title="Risks" items={item.risks} />
        </div>
        <div className={cn('rounded-md border p-4', item.outcome === 'worked' ? 'border-gain/25 bg-gain/[0.04]' : 'border-loss/25 bg-loss/[0.04]')}>
          <div className="kicker mb-1.5">What happened</div>
          <p className="text-[13.5px] leading-relaxed text-ink">{item.whatHappened}</p>
        </div>
        <List title="Lessons for your own process" items={item.lessons} accent />
        <div>
          <div className="kicker mb-2">Concepts in this case</div>
          <div className="flex flex-wrap gap-2">
            {item.concepts.map((concept) => (
              <Link key={concept.label} href={`/learn/${concept.lesson}`} className="flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink">
                <BookOpen className="size-3 text-brand" />
                {concept.label}
                <span className="text-faint">· {LESSON_BY_SLUG.get(concept.lesson)?.title}</span>
              </Link>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-faint">Retold from widely reported public accounts and simplified for teaching; figures are rounded. Verify details in primary sources before citing them.</p>
      </div>
    </Panel>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="kicker mb-1.5">{title}</div>
      <p className="max-w-[80ch] text-[13.5px] leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

function List({ title, items, accent }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <div>
      <div className="kicker mb-1.5">{title}</div>
      <ul className="flex flex-col gap-1.5">
        {items.map((entry) => (
          <li key={entry} className={cn('flex gap-2 text-[13px] leading-relaxed', accent ? 'text-ink' : 'text-ink-2')}>
            <span className={cn('mt-[8px] size-1.5 shrink-0 rounded-full', accent ? 'bg-ion' : 'bg-brand-soft')} />
            {entry}
          </li>
        ))}
      </ul>
    </div>
  );
}

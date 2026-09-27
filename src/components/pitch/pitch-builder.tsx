'use client';

import {
  ArrowLeft,
  Eye,
  FileDown,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from 'lucide-react';
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Delta } from '@/components/motion/delta';
import { ScoreRing } from '@/components/motion/score-ring';
import { exportPdf, exportSlides, type ExportPitch } from '@/components/pitch/exporters';
import { Page } from '@/components/shell/page';
import { Button, Magnetic } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Menu } from '@/components/ui/overlay';
import { Badge, Input, Panel, Segmented, Skeleton, Switch } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';
import { compactNumber, price, relativeTime } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

export type Recommendation = 'long' | 'hold' | 'short' | 'avoid';
type Section = { id: string; kind: string; title: string; content: string; included: boolean };
type Facts = NonNullable<ExportPitch['facts']>;
type PitchDetail = {
  id: string;
  symbol: string;
  title: string;
  recommendation: Recommendation;
  target_price: number | null;
  sections: Section[];
  created_at: string;
  updated_at: string;
  facts: Facts | null;
};
type Draft = { title: string; recommendation: Recommendation; target_price: number | null; sections: Section[] };

/** Sections that are generated from the workspace, score and filings, and can be re-pulled. */
const REFRESHABLE = new Set(['summary', 'company', 'thesis', 'drivers', 'financials', 'valuation', 'catalysts', 'risks', 'disconfirming', 'score']);

export const RECOMMENDATIONS: Array<{ value: Recommendation; label: string; tone: string }> = [
  { value: 'long', label: 'Long', tone: 'border-gain/45 bg-gain/10 text-gain' },
  { value: 'hold', label: 'Hold', tone: 'border-brand/40 bg-brand-wash text-brand' },
  { value: 'short', label: 'Short', tone: 'border-loss/45 bg-loss/10 text-loss' },
  { value: 'avoid', label: 'Avoid', tone: 'border-loss/30 bg-loss/[0.06] text-loss/90' },
];

export function recommendationTone(value: string) {
  return RECOMMENDATIONS.find((item) => item.value === value)?.tone ?? RECOMMENDATIONS[1].tone;
}

export function PitchBuilder({ id }: { id: string }) {
  const router = useRouter();
  const { data, error } = useSWR<PitchDetail>(`/api/pitches/${id}`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<'edit' | 'document'>('edit');
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'pptx' | null>(null);
  const loadedId = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!data || loadedId.current === data.id) return;
    loadedId.current = data.id;
    const next = { title: data.title, recommendation: data.recommendation, target_price: data.target_price, sections: data.sections ?? [] };
    draftRef.current = next;
    setDraft(next);
    setActiveId((current) => current ?? data.sections?.[0]?.id ?? null);
    setSavedAt(data.updated_at);
  }, [data]);

  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    setStatus('saving');
    try {
      const row = await api<{ updated_at: string }>(`/api/pitches/${id}`, { method: 'PATCH', body: current });
      setSavedAt(row.updated_at);
      // Only mark clean if nothing changed while the request was in flight.
      setStatus(draftRef.current === current ? 'saved' : 'dirty');
      void revalidate('/api/pitches');
    } catch (reason) {
      setStatus('dirty');
      toast.error((reason as Error).message);
    }
  }, [id]);

  const scheduleSave = useCallback(
    (delay = 900) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), delay);
    },
    [save],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      abortRef.current?.abort();
    },
    [],
  );

  const update = useCallback(
    (patch: Partial<Draft> | ((current: Draft) => Partial<Draft>), options: { save?: boolean } = {}) => {
      setDraft((current) => {
        if (!current) return current;
        const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
        draftRef.current = next;
        return next;
      });
      setStatus('dirty');
      if (options.save !== false) scheduleSave();
    },
    [scheduleSave],
  );

  const updateSection = useCallback(
    (sectionId: string, patch: Partial<Section>, options: { save?: boolean } = {}) =>
      update((current) => ({ sections: current.sections.map((item) => (item.id === sectionId ? { ...item, ...patch } : item)) }), options),
    [update],
  );

  const refreshFromWorkspace = async (kinds: string[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus('saving');
    try {
      const row = await api<PitchDetail>(`/api/pitches/${id}`, { method: 'PATCH', body: { ...draftRef.current, refreshFrom: kinds } });
      const next = { ...(draftRef.current as Draft), sections: row.sections };
      draftRef.current = next;
      setDraft(next);
      setSavedAt(row.updated_at);
      setStatus('saved');
      toast.success(kinds.length > 1 ? 'Pitch refreshed from your workspace and the latest data' : 'Section refreshed');
    } catch (reason) {
      setStatus('dirty');
      toast.error((reason as Error).message);
    }
  };

  const draftWithGrok = async (sectionId: string, instruction?: string) => {
    const current = draftRef.current;
    const section = current?.sections.find((item) => item.id === sectionId);
    if (!current || !section) return;
    const before = section.content;
    const controller = new AbortController();
    abortRef.current = controller;
    setDrafting(sectionId);
    let text = '';
    try {
      const response = await fetch(`/api/pitches/${id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId, instruction, sections: current.sections }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(payload.error ?? 'Draft failed');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        updateSection(sectionId, { content: text }, { save: false });
      }
      scheduleSave(200);
      toast.success(`Drafted “${section.title}”`, {
        action: { label: 'Undo', onClick: () => updateSection(sectionId, { content: before }) },
      });
    } catch (reason) {
      if ((reason as Error).name === 'AbortError') {
        // Keep what arrived before Stop.
        if (text) scheduleSave(200);
      } else {
        toast.error((reason as Error).message);
        // A stream that broke halfway: put the original text back.
        if (text) updateSection(sectionId, { content: before });
      }
    } finally {
      setDrafting(null);
      abortRef.current = null;
    }
  };

  const exportAs = async (format: 'pdf' | 'pptx') => {
    if (!draft || !data) return;
    setExporting(format);
    try {
      const payload: ExportPitch = { title: draft.title, recommendation: draft.recommendation, target_price: draft.target_price, symbol: data.symbol, sections: draft.sections, facts: data.facts };
      await (format === 'pdf' ? exportPdf(payload) : exportSlides(payload));
    } catch (reason) {
      toast.error(`Export failed: ${(reason as Error).message}`);
    } finally {
      setExporting(null);
    }
  };

  if (error) {
    return (
      <Page title="Pitch not found" description="It may have been deleted.">
        <Link href="/pitches">
          <Button variant="outline" icon={<ArrowLeft className="size-3.5" />}>
            All pitches
          </Button>
        </Link>
      </Page>
    );
  }
  if (!data || !draft) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-[60vh]" />
      </div>
    );
  }

  const facts = data.facts;
  const active = draft.sections.find((item) => item.id === activeId) ?? draft.sections[0] ?? null;
  const upside = draft.target_price && facts?.price ? draft.target_price / facts.price - 1 : null;
  const included = draft.sections.filter((item) => item.included);

  return (
    <Page>
      <Link href="/pitches" className="kicker inline-flex w-fit items-center gap-1 hover:text-ink-2">
        <ArrowLeft className="size-3" /> All pitches
      </Link>
      <Panel className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(ellipse_70%_90%_at_100%_0%,rgba(205,212,222,0.07),transparent_70%)]" />
        <div className="relative flex flex-wrap items-start gap-5 p-5">
          <CompanyLogo symbol={data.symbol} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <Link href={`/company/${data.symbol}`} className="font-mono font-semibold text-ink-2 hover:text-white">
                {data.symbol}
              </Link>
              <span className="truncate">{facts?.name}</span>
              {facts?.sector ? <Badge>{facts.sector}</Badge> : null}
            </div>
            <input
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
              aria-label="Pitch title"
              className="mt-1 w-full rounded-xs bg-transparent text-[24px] font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-faint focus:bg-white/[0.03]"
              placeholder="Pitch title"
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-1" role="radiogroup" aria-label="Recommendation">
                {RECOMMENDATIONS.map((option) => {
                  const selected = draft.recommendation === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => update({ recommendation: option.value })}
                      className={cn(
                        'h-7 rounded-xs border px-2.5 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors',
                        selected ? option.tone : 'border-line text-muted hover:border-line-strong hover:text-ink-2',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-[12px] text-muted">
                Target
                <span className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint">$</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.target_price ?? ''}
                    onChange={(event) => {
                      const value = event.target.value === '' ? null : Number(event.target.value);
                      update({ target_price: value !== null && Number.isFinite(value) && value > 0 ? value : null });
                    }}
                    className="h-7 w-28 pl-5 font-mono"
                    placeholder="—"
                  />
                </span>
              </label>
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="text-muted">Price</span>
                <span className="num text-ink">{price(facts?.price)}</span>
                {upside !== null ? (
                  <>
                    <span className="text-muted">Upside</span>
                    <Delta value={upside} digits={1} className="text-[12.5px]" />
                  </>
                ) : null}
              </div>
              {facts?.marketCap ? (
                <div className="text-[12px] text-muted">
                  Market value <span className="num text-ink-2">${compactNumber(facts.marketCap)}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            {facts?.score ? (
              <ScoreRing
                score={facts.score.overall}
                size="md"
                label={facts.score.label}
                confidence={facts.score.confidence}
                subScores={facts.score.components.map((item) => ({ key: item.name, name: item.name, weight: 0, score: item.score }))}
              />
            ) : null}
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5">
          <Segmented
            size="xs"
            value={view}
            onChange={setView}
            options={[
              { value: 'edit', label: 'Edit sections' },
              { value: 'document', label: 'Full preview' },
            ]}
          />
          <span className="text-[11px] text-faint">
            {status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved changes' : savedAt ? `Saved · ${relativeTime(savedAt)}` : 'Saved'}
          </span>
          <span className="text-[11px] text-faint">· {included.length} of {draft.sections.length} sections in the export</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" icon={<FileDown className="size-3.5" />} loading={exporting === 'pdf'} onClick={() => void exportAs('pdf')}>
              PDF
            </Button>
            <Magnetic>
              <Button variant="primary" size="sm" icon={<Presentation className="size-3.5" />} loading={exporting === 'pptx'} onClick={() => void exportAs('pptx')}>
                Slides
              </Button>
            </Magnetic>
            <Menu
              trigger={({ toggle }) => (
                <Button variant="ghost" size="sm" onClick={toggle} aria-label="More">
                  <MoreHorizontal className="size-4" />
                </Button>
              )}
              items={[
                { label: 'Refresh all sections from workspace', icon: <RefreshCw className="size-3.5" />, onSelect: () => void refreshFromWorkspace([...REFRESHABLE]) },
                { label: 'Open company workspace', icon: <Pencil className="size-3.5" />, onSelect: () => router.push(`/company/${data.symbol}?tab=workspace`) },
                'separator',
                {
                  label: 'Delete pitch',
                  icon: <Trash2 className="size-3.5" />,
                  danger: true,
                  onSelect: async () => {
                    if (!window.confirm('Delete this pitch?')) return;
                    await api(`/api/pitches/${id}`, { method: 'DELETE' });
                    void revalidate('/api/pitches');
                    router.push('/pitches');
                  },
                },
              ]}
            />
          </div>
        </div>
      </Panel>

      {view === 'document' ? (
        <DocumentPreview draft={draft} symbol={data.symbol} facts={facts} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[272px_minmax(0,1fr)]">
          <Panel className="lg:sticky lg:top-16">
            <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
              <span className="kicker">Sections</span>
              <span className="text-[10.5px] text-faint">Drag to reorder</span>
            </div>
            <Reorder.Group axis="y" values={draft.sections} onReorder={(sections) => update({ sections })} className="flex flex-col gap-0.5 px-1.5 pb-1.5">
              {draft.sections.map((section) => (
                <OutlineItem
                  key={section.id}
                  section={section}
                  active={section.id === active?.id}
                  busy={drafting === section.id}
                  onSelect={() => setActiveId(section.id)}
                  onToggle={(included) => updateSection(section.id, { included })}
                />
              ))}
            </Reorder.Group>
            <div className="border-t border-line p-1.5">
              <button
                type="button"
                onClick={() => {
                  const section: Section = { id: `custom-${Date.now().toString(36)}`, kind: 'custom', title: 'New section', content: '', included: true };
                  update((current) => ({ sections: [...current.sections, section] }));
                  setActiveId(section.id);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-xs px-2 text-[12.5px] text-muted transition-colors hover:bg-white/[0.04] hover:text-ink"
              >
                <Plus className="size-3.5" /> Add a section
              </button>
            </div>
          </Panel>

          {active ? (
            <SectionEditor
              key={active.id}
              section={active}
              drafting={drafting === active.id}
              anyDrafting={drafting !== null}
              onChange={(patch) => updateSection(active.id, patch)}
              onDraft={(instruction) => void draftWithGrok(active.id, instruction)}
              onStop={() => abortRef.current?.abort()}
              onRefresh={REFRESHABLE.has(active.kind) ? () => void refreshFromWorkspace([active.kind]) : undefined}
              onDelete={
                active.kind === 'custom'
                  ? () => {
                      update((current) => ({ sections: current.sections.filter((item) => item.id !== active.id) }));
                      setActiveId(draft.sections.find((item) => item.id !== active.id)?.id ?? null);
                    }
                  : undefined
              }
            />
          ) : (
            <Panel className="p-10 text-center text-[13px] text-muted">Add a section to start writing.</Panel>
          )}
        </div>
      )}
    </Page>
  );
}

function OutlineItem({
  section,
  active,
  busy,
  onSelect,
  onToggle,
}: {
  section: Section;
  active: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggle: (included: boolean) => void;
}) {
  const controls = useDragControls();
  const words = section.content.trim() ? section.content.trim().split(/\s+/).length : 0;
  return (
    <Reorder.Item
      value={section}
      dragListener={false}
      dragControls={controls}
      className={cn(
        'group relative flex items-center gap-1.5 rounded-xs py-1.5 pr-2 pl-1 select-none',
        active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
      )}
      whileDrag={{ scale: 1.02, boxShadow: '0 12px 30px -10px rgba(0,0,0,0.9)', backgroundColor: 'rgba(28,32,39,0.98)' }}
    >
      {active ? <motion.span layoutId="pitch-outline-active" className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-brand" /> : null}
      <span
        onPointerDown={(event) => controls.start(event)}
        className="grid size-5 cursor-grab touch-none place-items-center text-faint opacity-60 group-hover:opacity-100 active:cursor-grabbing"
        aria-label={`Drag ${section.title}`}
      >
        <GripVertical className="size-3.5" />
      </span>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className={cn('flex items-center gap-1.5 truncate text-[12.5px]', section.included ? 'text-ink' : 'text-faint line-through decoration-faint/60')}>
          {busy ? <Sparkles className="size-3 shrink-0 animate-pulse text-brand" /> : null}
          <span className="truncate">{section.title || 'Untitled'}</span>
        </div>
        <div className="text-[10.5px] text-faint">{words ? `${words} words` : 'Empty'}</div>
      </button>
      <Switch checked={section.included} onChange={onToggle} label={`Include ${section.title} in export`} />
    </Reorder.Item>
  );
}

function SectionEditor({
  section,
  drafting,
  anyDrafting,
  onChange,
  onDraft,
  onStop,
  onRefresh,
  onDelete,
}: {
  section: Section;
  drafting: boolean;
  anyDrafting: boolean;
  onChange: (patch: Partial<Section>) => void;
  onDraft: (instruction?: string) => void;
  onStop: () => void;
  onRefresh?: () => void;
  onDelete?: () => void;
}) {
  const [mode, setMode] = useState<'write' | 'split' | 'preview'>('split');
  const [instruction, setInstruction] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const html = useMemo(() => renderMarkdown(section.content), [section.content]);
  const words = section.content.trim() ? section.content.trim().split(/\s+/).length : 0;

  return (
    <Panel className={cn('flex min-h-[62vh] flex-col', drafting && 'light-trail')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <input
          value={section.title}
          onChange={(event) => onChange({ title: event.target.value })}
          aria-label="Section title"
          className="min-w-40 flex-1 rounded-xs bg-transparent text-[15px] font-semibold text-ink outline-none focus:bg-white/[0.03]"
        />
        <Segmented
          size="xs"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: <Pencil className="size-3" /> },
            { value: 'split', label: 'Split' },
            { value: 'preview', label: <Eye className="size-3" /> },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-1/50 px-4 py-2">
        {drafting ? (
          <Button size="xs" variant="outline" icon={<Square className="size-3" />} onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button size="xs" variant="outline" icon={<Sparkles className="size-3 text-brand" />} disabled={anyDrafting} onClick={() => onDraft()}>
            Draft with Grok
          </Button>
        )}
        <Button size="xs" variant="ghost" icon={<Wand2 className="size-3" />} disabled={anyDrafting} onClick={() => setAskOpen((value) => !value)}>
          Instruct…
        </Button>
        {onRefresh ? (
          <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3" />} disabled={anyDrafting} onClick={onRefresh} title="Replace with the latest from your workspace, score and filings">
            Refresh from workspace
          </Button>
        ) : null}
        <span className="ml-auto text-[10.5px] text-faint">{words} words · Markdown</span>
        {onDelete ? (
          <Button size="xs" variant="ghost" icon={<Trash2 className="size-3" />} onClick={onDelete} aria-label="Delete section" />
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {askOpen ? (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-line"
            onSubmit={(event) => {
              event.preventDefault();
              if (!instruction.trim()) return;
              onDraft(instruction.trim());
              setAskOpen(false);
            }}
          >
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Input
                autoFocus
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="e.g. Tighten to 120 words and lead with the margin story"
                className="h-7.5 flex-1"
              />
              <Button size="sm" variant="primary" type="submit" icon={<Sparkles className="size-3.5" />}>
                Rewrite
              </Button>
            </div>
          </motion.form>
        ) : null}
      </AnimatePresence>
      <div className={cn('grid min-h-0 flex-1', mode === 'split' ? 'md:grid-cols-2' : 'grid-cols-1')}>
        {mode !== 'preview' ? (
          <textarea
            value={section.content}
            onChange={(event) => onChange({ content: event.target.value })}
            readOnly={drafting}
            spellCheck
            placeholder="Write in Markdown: **bold**, - bullets, | tables |…"
            className={cn(
              'min-h-[52vh] w-full resize-none bg-transparent px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-ink-2 outline-none placeholder:text-faint',
              mode === 'split' && 'md:border-r md:border-line',
            )}
          />
        ) : null}
        {mode !== 'write' ? (
          <div className="min-h-[52vh] overflow-y-auto px-5 py-3.5">
            {section.content.trim() ? <div className="prose-rn" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="text-[12.5px] text-faint">Nothing here yet.</div>}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function DocumentPreview({ draft, symbol, facts }: { draft: Draft; symbol: string; facts: Facts | null }) {
  const included = draft.sections.filter((item) => item.included);
  const upside = draft.target_price && facts?.price ? draft.target_price / facts.price - 1 : null;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Panel className="overflow-hidden">
        <div className="relative border-b border-line bg-surface-1 px-10 py-9">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_100%_at_100%_0%,rgba(205,212,222,0.08),transparent_70%)]" />
          <div className="relative flex items-center gap-3">
            <CompanyLogo symbol={symbol} size="lg" />
            <span className="kicker">SilverNote · Investment pitch</span>
          </div>
          <h1 className="relative mt-5 text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">{draft.title}</h1>
          <div className="relative mt-2 text-[14px] text-ink-2">
            {facts?.name ?? symbol} ({symbol}){facts?.sector ? ` · ${facts.sector}` : ''}
          </div>
          <div className="relative mt-6 flex flex-wrap gap-8">
            <div>
              <div className="kicker">Recommendation</div>
              <div className={cn('mt-1 inline-flex rounded-xs border px-2 py-0.5 font-mono text-[13px] font-semibold uppercase', recommendationTone(draft.recommendation))}>{draft.recommendation}</div>
            </div>
            <div>
              <div className="kicker">Price</div>
              <div className="num mt-1 text-[17px] font-semibold text-ink">{price(facts?.price)}</div>
            </div>
            <div>
              <div className="kicker">Target</div>
              <div className="num mt-1 text-[17px] font-semibold text-ink">{draft.target_price ? price(draft.target_price) : '—'}</div>
            </div>
            <div>
              <div className="kicker">Upside</div>
              <div className="mt-1 text-[17px] font-semibold">
                <Delta value={upside} digits={0} />
              </div>
            </div>
            {facts?.score ? (
              <div>
                <div className="kicker">SilverNote Score</div>
                <div className="num mt-1 text-[17px] font-semibold text-ink">{facts.score.overall}</div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-8 px-10 py-9">
          {included.map((section) => (
            <section key={section.id}>
              <h2 className="text-[16px] font-semibold text-ink">{section.title}</h2>
              <div className="mt-1.5 mb-3 h-[2px] w-9 rounded-full bg-silver" />
              <div className="prose-rn" dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }} />
            </section>
          ))}
          {!included.length ? <div className="text-center text-[13px] text-muted">Every section is excluded — switch some on to build the document.</div> : null}
        </div>
      </Panel>
    </div>
  );
}

'use client';

import { diffWords } from 'diff';
import { GitCompareArrows, History, Pencil, Presentation, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { useShell } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/overlay';
import { Badge, Input, Panel, PanelHeader, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { api, revalidate } from '@/lib/client';
import { dateTime, price, relativeTime, signedPct } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { THESIS_SECTION_META, THESIS_SECTIONS, type ThesisSection } from '@/lib/schemas';
import { cn } from '@/lib/utils';

export type Version = {
  id: string;
  section: ThesisSection;
  content: string;
  change_note: string | null;
  stance: string | null;
  conviction: number | null;
  target_price: number | null;
  price_at: number | null;
  created_at: string;
};

export type WorkspaceData = {
  symbol: string;
  meta: { stance: string; conviction: number; target_price: number | null; horizon: string | null; status: string; updated_at: string } | null;
  current: Record<ThesisSection, Version | null>;
  versions: Version[];
};

const STANCES = [
  { value: 'long', label: 'Long' },
  { value: 'short', label: 'Short' },
  { value: 'watch', label: 'Watching' },
  { value: 'avoid', label: 'Avoid' },
] as const;

function draftKey(symbol: string, section: string) {
  return `silvernote.draft.${symbol}.${section}`;
}

function SectionCard({ symbol, section, version, count, onCommitted, onHistory }: { symbol: string; section: ThesisSection; version: Version | null; count: number; onCommitted: () => void; onHistory: () => void }) {
  const meta = THESIS_SECTION_META[section];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    let initial = version?.content ?? '';
    try {
      initial = localStorage.getItem(draftKey(symbol, section)) ?? initial;
    } catch {
      // storage unavailable
    }
    setDraft(initial);
    setEditing(true);
  };

  useEffect(() => {
    if (!editing) return;
    const timer = setTimeout(() => {
      try {
        if (draft && draft !== version?.content) localStorage.setItem(draftKey(symbol, section), draft);
      } catch {
        // storage unavailable
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, editing, symbol, section, version]);

  const commit = async () => {
    setSaving(true);
    try {
      await api(`/api/workspaces/${symbol}/versions`, { body: { section, content: draft, change_note: note || undefined } });
      try {
        localStorage.removeItem(draftKey(symbol, section));
      } catch {
        // storage unavailable
      }
      toast.success(`${meta.title} committed`);
      setEditing(false);
      setNote('');
      onCommitted();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div layout className={cn('rounded-sm border bg-surface-1', section === 'disconfirming' ? 'border-loss/25' : 'border-line')}>
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div>
          <div className={cn('text-[13px] font-semibold', section === 'disconfirming' ? 'text-loss' : 'text-ink')}>{meta.title}</div>
          <div className="mt-0.5 text-[11.5px] text-faint">{meta.prompt}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {count > 0 ? (
            <button onClick={onHistory} className="flex items-center gap-1 rounded-xs px-1.5 py-1 text-[11px] text-muted hover:bg-white/5 hover:text-ink" title="Version history">
              <History className="size-3.5" />
              {count}
            </button>
          ) : null}
          {!editing ? (
            <button onClick={startEditing} className="rounded-xs p-1 text-muted hover:bg-white/5 hover:text-ink" aria-label={`Edit ${meta.title}`}>
              <Pencil className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="px-3.5 pt-2 pb-3.5">
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-40 font-mono text-[12.5px]" placeholder="Markdown supported. Be specific: numbers, dates, what you expect to see." />
            <div className="flex items-center gap-2">
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What changed in your view? (optional)" className="h-7.5 flex-1 text-[12px]" />
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={saving} onClick={() => void commit()}>
                Commit version
              </Button>
            </div>
            <div className="text-[10.5px] text-faint">Drafts are kept on this device until you commit. Each commit is timestamped with your stance and the price.</div>
          </div>
        ) : version ? (
          <>
            <div className="prose-rn" dangerouslySetInnerHTML={{ __html: renderMarkdown(version.content) }} />
            <div className="mt-2 text-[10.5px] text-faint">
              Committed {relativeTime(version.created_at)}
              {version.price_at ? ` at $${price(version.price_at)}` : ''}
              {version.change_note ? ` · “${version.change_note}”` : ''}
            </div>
          </>
        ) : (
          <button onClick={startEditing} className="w-full rounded-sm border border-dashed border-line-strong py-5 text-[12px] text-muted hover:border-white/25 hover:text-ink-2">
            Write the first version
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function DiffView({ older, newer }: { older: string; newer: string }) {
  const parts = useMemo(() => diffWords(older, newer), [older, newer]);
  return (
    <div className="rounded-sm border border-line bg-surface-1 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">
      {parts.map((part, index) => (
        <span
          key={index}
          className={cn(part.added && 'rounded-[2px] bg-gain/15 text-gain', part.removed && 'rounded-[2px] bg-loss/15 text-loss line-through decoration-loss/60')}
        >
          {part.value}
        </span>
      ))}
    </div>
  );
}

export function VersionTimeline({ versions, filter, onSelect }: { versions: Version[]; filter?: ThesisSection | null; onSelect?: (version: Version) => void }) {
  const shown = filter ? versions.filter((version) => version.section === filter) : versions;
  if (!shown.length) return <p className="px-1 py-4 text-[12px] text-muted">No versions yet. Commit a section to start the timeline.</p>;
  return (
    <ol className="relative ml-2 border-l border-line">
      {shown.map((version, index) => (
        <motion.li key={version.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index, 12) * 0.03 }} className="relative pb-3 pl-4">
          <span className={cn('absolute top-1.5 -left-[4.5px] size-2 rounded-full border border-surface-2', index === 0 ? 'bg-brand shadow-[0_0_8px_rgba(205,212,222,0.54)]' : 'bg-[#5d6470]')} />
          <button onClick={() => onSelect?.(version)} className="w-full rounded-sm px-2 py-1 text-left hover:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-ink">{THESIS_SECTION_META[version.section].title}</span>
              {version.stance ? <Badge tone={version.stance === 'long' ? 'gain' : version.stance === 'short' ? 'loss' : 'neutral'}>{version.stance}</Badge> : null}
              {version.conviction ? <span className="font-mono text-[10px] text-faint">conv {version.conviction}/5</span> : null}
            </div>
            <div className="mt-0.5 text-[11px] text-faint">
              {dateTime(version.created_at)}
              {version.price_at ? ` · $${price(version.price_at)}` : ''}
              {version.target_price ? ` · target $${price(version.target_price)}` : ''}
            </div>
            {version.change_note ? <div className="mt-0.5 text-[11.5px] text-ink-2">“{version.change_note}”</div> : null}
          </button>
        </motion.li>
      ))}
    </ol>
  );
}

export function CompanyWorkspace({ symbol, name, currentPrice }: { symbol: string; name: string; currentPrice: number | null }) {
  const { data, mutate, isLoading } = useSWR<WorkspaceData>(`/api/workspaces/${symbol}`);
  const { askAssistant } = useShell();
  const router = useRouter();
  const [historySection, setHistorySection] = useState<ThesisSection | null>(null);
  const [selected, setSelected] = useState<Version | null>(null);
  // Typed text wins until the saved value comes back from the server.
  const [targetEdit, setTargetEdit] = useState<string | null>(null);
  const target = targetEdit ?? (data?.meta?.target_price ? String(data.meta.target_price) : '');

  const saveMeta = async (patch: Record<string, unknown>) => {
    await api(`/api/workspaces/${symbol}`, { method: 'PUT', body: patch });
    void revalidate(`/api/company/${symbol}`);
    await mutate();
  };

  const createPitch = async () => {
    const pitch = await api<{ id: string }>('/api/pitches', { body: { symbol } });
    router.push(`/pitches/${pitch.id}`);
  };

  if (isLoading && !data) return <Skeleton className="h-96 w-full" />;
  const versions = data?.versions ?? [];
  const meta = data?.meta;
  const upside = meta?.target_price && currentPrice ? meta.target_price / currentPrice - 1 : null;
  const previousOfSelected = selected ? versions.find((version) => version.section === selected.section && version.created_at < selected.created_at) : null;
  const thesisText = THESIS_SECTIONS.map((section) => (data?.current[section] ? `## ${THESIS_SECTION_META[section].title}\n${data.current[section]?.content}` : '')).filter(Boolean).join('\n\n');

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <Panel>
          <div className="flex flex-wrap items-end gap-4 p-4">
            <div>
              <div className="mb-1.5 text-[11.5px] text-muted">Stance</div>
              <div className="flex gap-1">
                {STANCES.map((stance) => (
                  <button
                    key={stance.value}
                    onClick={() => void saveMeta({ stance: stance.value })}
                    className={cn(
                      'h-7.5 rounded-sm border px-2.5 text-[12px] transition-colors',
                      (meta?.stance ?? 'watch') === stance.value ? 'border-brand/60 bg-brand-wash text-ink shadow-[0_0_12px_-4px_rgba(205,212,222,0.54)]' : 'border-line text-muted hover:text-ink-2',
                    )}
                  >
                    {stance.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11.5px] text-muted">Conviction</div>
              <div className="flex h-7.5 items-center gap-1">
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    onClick={() => void saveMeta({ conviction: level })}
                    aria-label={`Conviction ${level}`}
                    className={cn('h-5 w-3 rounded-[2px] transition-colors', level <= (meta?.conviction ?? 3) ? 'bg-brand shadow-[0_0_8px_rgba(205,212,222,0.36)]' : 'bg-white/10 hover:bg-white/20')}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11.5px] text-muted">Target price</div>
              <div className="flex items-center gap-2">
                <Input
                  value={target}
                  inputMode="decimal"
                  onChange={(event) => setTargetEdit(event.target.value)}
                  onBlur={() => {
                    if (targetEdit === null) return;
                    const value = targetEdit.trim() ? Number(targetEdit) : null;
                    if (value === (meta?.target_price ?? null) || !(value === null || (Number.isFinite(value) && value > 0))) {
                      setTargetEdit(null);
                      return;
                    }
                    void saveMeta({ target_price: value }).finally(() => setTargetEdit(null));
                  }}
                  placeholder="$"
                  className="h-7.5 w-24"
                />
                {upside !== null ? <span className={cn('num text-[12px] font-medium', upside >= 0 ? 'text-gain' : 'text-loss')}>{signedPct(upside, 1)} upside</span> : null}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11.5px] text-muted">Horizon</div>
              <Select value={meta?.horizon ?? ''} onChange={(event) => void saveMeta({ horizon: event.target.value || null })} className="h-7.5 w-32">
                <option value="">Not set</option>
                <option value="< 6 months">&lt; 6 months</option>
                <option value="6–12 months">6–12 months</option>
                <option value="1–3 years">1–3 years</option>
                <option value="3+ years">3+ years</option>
              </Select>
            </div>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                icon={<Sparkles className="size-3.5 text-brand" />}
                onClick={() =>
                  askAssistant(
                    thesisText
                      ? `Challenge my thesis on ${name} (${symbol}). Find the weakest assumptions, what the bear case would say, and which disconfirming signals I'm missing.\n\n${thesisText}`
                      : `I'm starting research on ${name} (${symbol}). Draft a first thesis outline: why it could work, key drivers, main risks, catalysts, and what would prove it wrong.`,
                    { type: 'company', symbol, name },
                  )
                }
              >
                {thesisText ? 'Challenge thesis' : 'Draft with Grok'}
              </Button>
              <Button variant="primary" icon={<Presentation className="size-3.5" />} onClick={() => void createPitch()}>
                Build pitch
              </Button>
            </div>
          </div>
        </Panel>
        <div className="grid gap-3 lg:grid-cols-2">
          {THESIS_SECTIONS.map((section) => (
            <SectionCard
              key={section}
              symbol={symbol}
              section={section}
              version={data?.current[section] ?? null}
              count={versions.filter((version) => version.section === section).length}
              onCommitted={() => void mutate()}
              onHistory={() => setHistorySection(section)}
            />
          ))}
        </div>
      </div>
      <Panel className="self-start">
        <PanelHeader kicker="Every change, timestamped" title="Thesis timeline" actions={<Badge tone="outline">{versions.length} versions</Badge>} />
        <div className="max-h-[70vh] overflow-y-auto px-3 pb-3">
          <VersionTimeline versions={versions} onSelect={setSelected} />
        </div>
      </Panel>

      <Drawer open={Boolean(historySection) || Boolean(selected)} onClose={() => { setHistorySection(null); setSelected(null); }} title={selected ? `${THESIS_SECTION_META[selected.section].title} · ${dateTime(selected.created_at)}` : historySection ? `${THESIS_SECTION_META[historySection].title} history` : ''} width={620}>
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div key={selected.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <GitCompareArrows className="size-3.5 text-brand" />
                {previousOfSelected ? `Changes since ${dateTime(previousOfSelected.created_at)}` : 'First version of this section'}
              </div>
              <DiffView older={previousOfSelected?.content ?? ''} newer={selected.content} />
              {selected.change_note ? <p className="text-[12.5px] text-ink-2">Note: “{selected.change_note}”</p> : null}
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Back to history
              </Button>
            </motion.div>
          ) : historySection ? (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-3">
              <VersionTimeline versions={versions} filter={historySection} onSelect={setSelected} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Drawer>
    </div>
  );
}

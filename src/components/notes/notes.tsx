'use client';

import { Eye, FilePlus2, GitCompareArrows, History, Pencil, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Delta } from '@/components/motion/delta';
import { ScoreRing } from '@/components/motion/score-ring';
import { Page } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Drawer } from '@/components/ui/overlay';
import { Badge, EmptyState, Input, Panel, PanelHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { DiffView } from '@/components/workspace/company-workspace';
import { api } from '@/lib/client';
import { dateTime, price, relativeTime } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { THESIS_SECTION_META, type ThesisSection } from '@/lib/schemas';
import { cn } from '@/lib/utils';

type NoteSummary = { id: string; symbol: string | null; title: string; snippet: string; tags: string[]; pinned: boolean; updated_at: string; versions: number };
type NoteDetail = NoteSummary & { content: string; created_at: string; versions: Array<{ id: string; title: string; content: string; created_at: string }> };
type Workspace = { symbol: string; name: string | null; stance: string; conviction: number; target_price: number | null; price: number | null; change_pct: number | null; score: number | null; versions: number; last_commit: string | null; updated_at: string };
type Activity = { id: string; symbol: string; name: string | null; section: ThesisSection; change_note: string | null; stance: string | null; conviction: number | null; target_price: number | null; price_at: number | null; created_at: string };

function NoteEditor({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const { data, mutate } = useSWR<NoteDetail>(`/api/notes/${id}`);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tags, setTags] = useState('');
  const [mode, setMode] = useState<'write' | 'preview' | 'split'>('split');
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [history, setHistory] = useState(false);
  const [compare, setCompare] = useState<string | null>(null);
  const loadedId = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!data || loadedId.current === data.id) return;
    loadedId.current = data.id;
    setTitle(data.title);
    setContent(data.content);
    setSymbol(data.symbol ?? '');
    setTags((data.tags ?? []).join(', '));
    setStatus('saved');
  }, [data]);

  const save = useCallback(
    async (snapshot = false) => {
      setStatus('saving');
      try {
        await api(`/api/notes/${id}`, {
          method: 'PATCH',
          body: {
            title,
            content,
            symbol: symbol.trim() ? symbol.trim().toUpperCase() : null,
            tags: tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
            snapshot,
          },
        });
        setStatus('saved');
        void mutate();
        onChanged();
        if (snapshot) toast.success('Version saved');
      } catch (error) {
        setStatus('dirty');
        toast.error((error as Error).message);
      }
    },
    [id, title, content, symbol, tags, mutate, onChanged],
  );

  const touch = () => {
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(false), 1400);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!data) return <Skeleton className="h-[60vh]" />;
  const versions = data.versions ?? [];
  const selectedVersion = versions.find((version) => version.id === compare);
  const previous = selectedVersion ? versions[versions.indexOf(selectedVersion) + 1] : null;

  return (
    <Panel className="flex min-h-[70vh] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
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
        <span className="text-[11px] text-faint">
          {status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved changes' : `Saved · edited ${relativeTime(data.updated_at)}`}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHistory(true)}>
            {versions.length} versions
          </Button>
          <Button size="sm" variant="outline" onClick={() => void save(true)}>
            Save version
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={data.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            onClick={async () => {
              await api(`/api/notes/${id}`, { method: 'PATCH', body: { pinned: !data.pinned } });
              void mutate();
              onChanged();
            }}
            aria-label={data.pinned ? 'Unpin' : 'Pin'}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            onClick={async () => {
              if (!window.confirm('Delete this note and its history?')) return;
              await api(`/api/notes/${id}`, { method: 'DELETE' });
              onDeleted();
            }}
            aria-label="Delete note"
          />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_120px_1fr] gap-2 border-b border-line px-4 py-2.5">
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            touch();
          }}
          placeholder="Untitled note"
          className="bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:text-faint"
        />
        <Input
          value={symbol}
          onChange={(event) => {
            setSymbol(event.target.value.toUpperCase());
            touch();
          }}
          placeholder="Ticker"
          className="h-7 font-mono text-[12px] uppercase"
        />
        <Input
          value={tags}
          onChange={(event) => {
            setTags(event.target.value);
            touch();
          }}
          placeholder="tags, comma separated"
          className="h-7 text-[12px]"
        />
      </div>
      <div className={cn('grid min-h-0 flex-1', mode === 'split' ? 'grid-cols-2 divide-x divide-line' : 'grid-cols-1')}>
        {mode !== 'preview' ? (
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              touch();
            }}
            placeholder={'Write in markdown.\n\n## Observation\n- …\n\n## So what\n- …'}
            className="min-h-[55vh] resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-ink-2 outline-none placeholder:text-faint"
          />
        ) : null}
        {mode !== 'write' ? (
          <div className="prose-rn min-h-[55vh] overflow-y-auto p-4" dangerouslySetInnerHTML={{ __html: renderMarkdown(content || '*Nothing written yet.*') }} />
        ) : null}
      </div>
      <Drawer open={history} onClose={() => { setHistory(false); setCompare(null); }} title={selectedVersion ? `Version · ${dateTime(selectedVersion.created_at)}` : 'Version history'} width={620}>
        {selectedVersion ? (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <GitCompareArrows className="size-3.5 text-brand" />
              {previous ? `Changes since ${dateTime(previous.created_at)}` : 'First version'}
            </div>
            <DiffView older={previous ? `${previous.title}\n\n${previous.content}` : ''} newer={`${selectedVersion.title}\n\n${selectedVersion.content}`} />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCompare(null)}>
                Back
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTitle(selectedVersion.title);
                  setContent(selectedVersion.content);
                  setHistory(false);
                  setCompare(null);
                  touch();
                  toast('Restored — a new version is saved with your next change');
                }}
              >
                Restore this version
              </Button>
            </div>
          </div>
        ) : (
          <ol className="relative m-4 ml-6 border-l border-line">
            {versions.map((version, index) => (
              <li key={version.id} className="relative pb-3 pl-4">
                <span className={cn('absolute top-1.5 -left-[4.5px] size-2 rounded-full', index === 0 ? 'bg-brand shadow-[0_0_8px_rgba(205,212,222,0.54)]' : 'bg-[#5d6470]')} />
                <button onClick={() => setCompare(version.id)} className="w-full rounded-sm px-2 py-1 text-left hover:bg-white/[0.03]">
                  <div className="text-[12px] text-ink">{version.title || 'Untitled'}</div>
                  <div className="text-[11px] text-faint">
                    {dateTime(version.created_at)} · {version.content.length.toLocaleString()} characters
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Drawer>
    </Panel>
  );
}

function ThesesBoard() {
  const { data: workspaces, isLoading } = useSWR<Workspace[]>('/api/workspaces');
  const { data: activity } = useSWR<Activity[]>('/api/thesis-activity');
  return (
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <Panel>
        <PanelHeader kicker="One workspace per company" title="Theses" />
        {isLoading && !workspaces ? (
          <Skeleton className="mx-4 mb-4 h-48" />
        ) : workspaces?.length ? (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-y border-line bg-surface-1 text-left text-[11px] text-muted">
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Stance</th>
                <th className="px-3 py-2 font-medium">Conviction</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Target · upside</th>
                <th className="px-3 py-2 text-right font-medium">Score</th>
                <th className="px-3 py-2 text-right font-medium">Versions</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((workspace) => {
                const upside = workspace.target_price && workspace.price ? workspace.target_price / workspace.price - 1 : null;
                return (
                  <tr key={workspace.symbol} className="border-b border-line hover:bg-white/[0.025]">
                    <td className="px-4 py-2">
                      <Link href={`/company/${workspace.symbol}?tab=workspace`} className="flex items-center gap-2">
                        <CompanyLogo symbol={workspace.symbol} size="sm" />
                        <span className="font-mono text-[12px] font-semibold text-ink hover:text-white">{workspace.symbol}</span>
                        <span className="max-w-44 truncate text-[11.5px] text-muted">{workspace.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={workspace.stance === 'long' ? 'gain' : workspace.stance === 'short' ? 'loss' : 'neutral'}>{workspace.stance}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <span key={level} className={cn('h-3 w-1.5 rounded-[1px]', level <= workspace.conviction ? 'bg-brand' : 'bg-white/10')} />
                        ))}
                      </div>
                    </td>
                    <td className="num px-3 py-2 text-right text-ink">{price(workspace.price)}</td>
                    <td className="px-3 py-2 text-right">
                      {workspace.target_price ? (
                        <span className="flex items-center justify-end gap-2">
                          <span className="num text-ink-2">{price(workspace.target_price)}</span>
                          <Delta value={upside} digits={1} className="text-[11.5px]" />
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">{workspace.score !== null ? <ScoreRing score={workspace.score} size="xs" /> : <span className="text-faint">—</span>}</div>
                    </td>
                    <td className="num px-3 py-2 text-right text-muted">
                      {workspace.versions}
                      <div className="text-[10.5px] text-faint">{workspace.last_commit ? relativeTime(workspace.last_commit) : ''}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No theses yet" body="Open any company and use its Workspace tab to write a thesis, drivers, risks, catalysts and what would prove you wrong." />
        )}
      </Panel>
      <Panel>
        <PanelHeader kicker="Every change, timestamped" title="Research timeline" />
        {activity?.length ? (
          <ol className="relative mx-4 mb-4 ml-6 border-l border-line">
            {activity.map((item, index) => (
              <motion.li key={item.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index, 15) * 0.02 }} className="relative pb-3 pl-4">
                <span className={cn('absolute top-1.5 -left-[4.5px] size-2 rounded-full', index === 0 ? 'bg-brand shadow-[0_0_8px_rgba(205,212,222,0.54)]' : 'bg-[#5d6470]')} />
                <Link href={`/company/${item.symbol}?tab=workspace`} className="block rounded-sm px-2 py-1 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="font-mono font-semibold text-ink">{item.symbol}</span>
                    <span className="text-ink-2">{THESIS_SECTION_META[item.section]?.title}</span>
                    {item.stance ? <Badge tone={item.stance === 'long' ? 'gain' : item.stance === 'short' ? 'loss' : 'neutral'}>{item.stance}</Badge> : null}
                  </div>
                  <div className="text-[11px] text-faint">
                    {dateTime(item.created_at)}
                    {item.price_at ? ` · at $${price(item.price_at)}` : ''}
                  </div>
                  {item.change_note ? <div className="text-[11.5px] text-muted">“{item.change_note}”</div> : null}
                </Link>
              </motion.li>
            ))}
          </ol>
        ) : (
          <div className="px-4 pb-5 text-[12px] text-muted">Commits to any company workspace appear here.</div>
        )}
      </Panel>
    </div>
  );
}

export function Notes() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') === 'theses' ? 'theses' : 'notes';
  const selected = params.get('note');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const { data: notes, mutate, isLoading } = useSWR<NoteSummary[]>(`/api/notes${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`);

  const create = useCallback(async () => {
    const note = await api<{ id: string }>('/api/notes', { body: { title: '', content: '' } });
    await mutate();
    router.replace(`/notes?note=${note.id}`);
  }, [mutate, router]);

  useEffect(() => {
    if (params.get('new') === '1') void create();
    // Only on first load with ?new=1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = selected ?? notes?.[0]?.id ?? null;

  return (
    <Page
      kicker="Timestamped and versioned"
      title="Notes & theses"
      actions={
        <>
          <Segmented
            value={tab}
            onChange={(value) => router.replace(value === 'theses' ? '/notes?tab=theses' : '/notes')}
            options={[
              { value: 'notes', label: 'Journal' },
              { value: 'theses', label: 'Theses' },
            ]}
          />
          {tab === 'notes' ? (
            <Button variant="primary" icon={<FilePlus2 className="size-3.5" />} onClick={() => void create()}>
              New note
            </Button>
          ) : null}
        </>
      }
    >
      {tab === 'theses' ? (
        <ThesesBoard />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Panel className="flex max-h-[calc(100dvh-170px)] flex-col self-start">
            <div className="relative p-2">
              <Search className="pointer-events-none absolute top-1/2 left-4.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes" className="pl-8" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {isLoading && !notes ? <Skeleton className="h-40" /> : null}
              {notes?.map((note) => (
                <button
                  key={note.id}
                  onClick={() => router.replace(`/notes?note=${note.id}`)}
                  className={cn('mb-0.5 w-full rounded-sm px-2.5 py-2 text-left transition-colors', note.id === active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]')}
                >
                  <div className="flex items-center gap-1.5">
                    {note.pinned ? <Pin className="size-3 text-brand" /> : null}
                    <span className={cn('truncate text-[12.5px]', note.id === active ? 'text-ink' : 'text-ink-2')}>{note.title || 'Untitled note'}</span>
                    {note.symbol ? <span className="ml-auto font-mono text-[10px] text-muted">{note.symbol}</span> : null}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-faint">{note.snippet || 'Empty'}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">
                    {relativeTime(note.updated_at)}
                    {note.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded-[2px] bg-white/[0.05] px-1">
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
              {notes && !notes.length ? <div className="px-3 py-8 text-center text-[12px] text-muted">{debounced ? 'No matches.' : 'No notes yet.'}</div> : null}
            </div>
          </Panel>
          {active ? (
            <NoteEditor
              key={active}
              id={active}
              onChanged={() => void mutate()}
              onDeleted={() => {
                void mutate();
                router.replace('/notes');
              }}
            />
          ) : (
            <Panel>
              <EmptyState icon={<FilePlus2 className="size-4" />} title="Start your research journal" body="Notes are timestamped and every meaningful edit is kept as a version you can diff and restore. Link a note to a ticker to see it on that company’s page." action={<Button variant="primary" onClick={() => void create()}>New note</Button>} />
            </Panel>
          )}
        </div>
      )}
    </Page>
  );
}

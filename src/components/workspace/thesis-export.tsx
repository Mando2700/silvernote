'use client';

import { Check, FileDown, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Field, Input, Skeleton, Switch } from '@/components/ui/primitives';
import type { WorkspaceData } from '@/components/workspace/company-workspace';
import { exportThesisPdf, type ThesisExportInput, type ThesisImage } from '@/components/workspace/thesis-pdf';
import { THESIS_SECTIONS } from '@/lib/schemas';
import { cn } from '@/lib/utils';

type Media = { headquarters: ThesisExportInput['headquarters']; images: Array<ThesisImage & { kind: string; suggested: boolean; description: string | null }> };
type ExportFacts = { profile: ThesisExportInput['profile']; facts: ThesisExportInput['facts'] };

const AUTHOR_KEY = 'silvernote.export.author';
const MAX_IMAGES = 5;

const KIND_LABEL: Record<string, string> = {
  headquarters: 'Headquarters',
  building: 'Offices',
  company: 'Company',
  interior: 'Interior',
  night: 'Night view',
  city: 'HQ city',
  product: 'Product',
  leadership: 'Leadership',
};

function readAuthor() {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? '';
  } catch {
    return '';
  }
}

export function ThesisExportDialog({ open, onClose, symbol, name, workspace }: { open: boolean; onClose: () => void; symbol: string; name: string; workspace: WorkspaceData | undefined }) {
  const { data: media, isLoading: mediaLoading } = useSWR<Media>(open ? `/api/company/${symbol}/media` : null);
  const { data: details } = useSWR<ExportFacts>(open ? `/api/workspaces/${symbol}/export` : null);
  // Null until the user picks: the suggested photos are selected by default.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [author, setAuthor] = useState(readAuthor);
  const [includeOverview, setIncludeOverview] = useState(true);
  const [includeFinancials, setIncludeFinancials] = useState(true);
  const [exporting, setExporting] = useState(false);

  const images = media?.images ?? [];
  const selected = picked ?? images.filter((image) => image.suggested).slice(0, 3).map((image) => image.id);
  const sections = THESIS_SECTIONS.flatMap((section) => (workspace?.current[section]?.content.trim() ? [{ section, content: workspace.current[section]!.content }] : []));

  const toggle = (id: string) => {
    if (selected.includes(id)) setPicked(selected.filter((item) => item !== id));
    else if (selected.length >= MAX_IMAGES) toast.message(`Up to ${MAX_IMAGES} photos per document.`);
    else setPicked([...selected, id]);
  };

  const makeCover = (id: string) => setPicked([id, ...selected.filter((item) => item !== id)]);

  const run = async () => {
    setExporting(true);
    try {
      try {
        localStorage.setItem(AUTHOR_KEY, author.trim());
      } catch {
        // Private mode: the name just isn't remembered.
      }
      await exportThesisPdf({
        symbol,
        name,
        preparedBy: author.trim(),
        stance: workspace?.meta?.stance ?? 'watch',
        conviction: workspace?.meta?.conviction ?? null,
        targetPrice: workspace?.meta?.target_price ?? null,
        horizon: workspace?.meta?.horizon ?? null,
        sections,
        profile: details?.profile ?? null,
        facts: details?.facts ?? null,
        headquarters: media?.headquarters ?? null,
        images: selected.map((id) => images.find((image) => image.id === id)).filter((image): image is Media['images'][number] => Boolean(image)),
        includeOverview,
        includeFinancials,
      });
      onClose();
    } catch (reason) {
      toast.error(`Export failed: ${(reason as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-3xl"
      title="Export thesis as PDF"
      description="A clean research note with a photo cover, key data, your thesis and financials. No app branding."
      footer={
        <>
          <span className="mr-auto text-[12px] text-muted">
            {sections.length} of {THESIS_SECTIONS.length} sections written · {selected.length} photo{selected.length === 1 ? '' : 's'}
          </span>
          <Button variant="ghost" onClick={onClose} disabled={exporting}>
            Cancel
          </Button>
          <Button variant="primary" icon={<FileDown className="size-3.5" />} loading={exporting} disabled={!details || mediaLoading} onClick={() => void run()}>
            Download PDF
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[11.5px] font-medium text-ink-2">Photos</span>
            <span className="text-[11px] text-muted">The first pick is the cover · click a photo again to remove it</span>
          </div>
          {mediaLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="aspect-[4/3] w-full" />
              ))}
            </div>
          ) : images.length ? (
            <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {images.map((image) => {
                const order = selected.indexOf(image.id);
                return (
                  <div key={image.id} className={cn('group relative overflow-hidden rounded-sm border transition-colors', order >= 0 ? 'border-brand/70' : 'border-line hover:border-line-strong')}>
                    <button type="button" onClick={() => toggle(image.id)} className="block w-full text-left" aria-pressed={order >= 0} title={image.description ?? image.caption}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own image route */}
                      <img src={`/api/company/${symbol}/media/${image.id}`} alt={image.caption} loading="lazy" className={cn('aspect-[4/3] w-full bg-surface-3 object-cover transition-opacity', order < 0 && 'opacity-60 group-hover:opacity-90')} />
                      <div className="px-2 py-1.5">
                        <div className="truncate text-[11.5px] text-ink">{image.caption}</div>
                        <div className="truncate text-[10.5px] text-faint">{[image.credit, image.license].filter(Boolean).join(' · ')}</div>
                      </div>
                    </button>
                    <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-[3px] bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{KIND_LABEL[image.kind] ?? image.kind}</span>
                    {order >= 0 ? (
                      <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-[3px] bg-brand px-1.5 py-0.5 text-[10px] font-medium text-black">
                        <Check className="size-3" />
                        {order === 0 ? 'Cover' : `Fig. ${order}`}
                      </span>
                    ) : null}
                    {order > 0 ? (
                      <button type="button" onClick={() => makeCover(image.id)} className="absolute right-1.5 bottom-12 rounded-[3px] bg-black/65 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        Make cover
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-sm border border-dashed border-line px-3 py-4 text-[12.5px] text-muted">
              <ImageOff className="size-4 shrink-0" />
              No freely licensed photos found for {name}. The PDF will use a typographic cover.
            </div>
          )}
          {images.length ? <p className="mt-2 text-[11px] text-faint">Photos from Wikimedia Commons. Each one is credited in the PDF, as its licence requires.</p> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Prepared by" hint="Shown on the cover and in the footer. Leave blank to omit.">
            <Input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Name, firm" maxLength={80} />
          </Field>
          <div className="flex flex-col gap-2.5 pt-5">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Switch checked={includeOverview} onChange={setIncludeOverview} label="Include company overview" />
              Company overview
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Switch checked={includeFinancials} onChange={setIncludeFinancials} label="Include financial summary" />
              Financial summary
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}

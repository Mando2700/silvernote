'use client';

import { AlertTriangle, ImagePlus, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Modal } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';
import { Badge, Field, Input, Segmented, Select } from '@/components/ui/primitives';
import { localToday } from '@/lib/dates';
import { api } from '@/lib/client';
import { money, price } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Mirrors `ImportCandidate` in src/lib/services/portfolio-import.ts. */
type Candidate = {
  id: string;
  rawText: string | null;
  extractedSymbol: string | null;
  symbol: string | null;
  name: string | null;
  isCash: boolean;
  quantity: number | null;
  price: number | null;
  marketValue: number | null;
  averageCost: number | null;
  costBasis: number | null;
  allocationPercent: number | null;
  currency: string | null;
  confidence: number;
  matches: Array<{ symbol: string; name: string }>;
  warnings: string[];
  errors: string[];
  status: 'valid' | 'needs_review' | 'invalid';
};
type ParseResponse = { candidates: Candidate[]; notes: string[]; ignoredSensitiveData: string[]; unreadable: boolean; partial: boolean };
type Photo = { id: string; name: string; preview: string; base64: string; mimeType: 'image/jpeg' };
type Row = Candidate & { removed: boolean; edited: boolean };

const MAX_PHOTOS = 4;
const MAX_EDGE = 2000;
const TICKER = /^[A-Z0-9.\-]{1,16}$/;

/** Downscale to a JPEG the vision model reads well; also converts PNG/WEBP/HEIC (where the browser decodes it). */
async function preparePhoto(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`${file.name}: this browser can’t open that image. Use PNG or JPG.`));
      element.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser can’t prepare the image for upload.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { id: crypto.randomUUID(), name: file.name, preview: dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const num = (value: string) => {
  const parsed = Number(value.replace(/[\s,]/g, ''));
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function ImportPhotosModal({
  open,
  onClose,
  portfolios,
  defaultPortfolioId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  portfolios: Array<{ id: string; name: string }>;
  defaultPortfolioId: string | null;
  onImported: (portfolioId: string) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<Omit<ParseResponse, 'candidates'> | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [target, setTarget] = useState<'new' | 'existing'>('new');
  const [portfolioId, setPortfolioId] = useState(defaultPortfolioId ?? '');
  const [name, setName] = useState('Imported portfolio');
  const [costMode, setCostMode] = useState<'imported' | 'today'>('imported');
  const [tradedAt, setTradedAt] = useState(() => localToday());
  const [totalValue, setTotalValue] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhotos([]);
    setRows(null);
    setMeta(null);
    setTotalValue('');
  };
  const close = () => {
    if (reading || saving) return;
    reset();
    onClose();
  };

  const addFiles = async (files: FileList | File[]) => {
    const images = [...files].filter((file) => file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name));
    if (!images.length) return toast.error('Choose a PNG, JPG or HEIC screenshot.');
    const room = MAX_PHOTOS - photos.length;
    if (images.length > room) toast.message(`Up to ${MAX_PHOTOS} photos per import; extra ones were skipped.`);
    const prepared = await Promise.allSettled(images.slice(0, room).map(preparePhoto));
    for (const result of prepared) if (result.status === 'rejected') toast.error((result.reason as Error).message);
    setPhotos((current) => [...current, ...prepared.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))]);
  };

  const read = async () => {
    setReading(true);
    try {
      const response = await api<ParseResponse>('/api/portfolios/import/parse', { body: { images: photos.map(({ base64, mimeType }) => ({ base64, mimeType })) } });
      const { candidates, ...rest } = response;
      if (!candidates.length) {
        toast.error(response.unreadable ? 'Couldn’t read the photo clearly. Crop it to the holdings table and try again.' : 'No holdings found in the photo.');
        return;
      }
      setRows(candidates.map((candidate) => ({ ...candidate, removed: false, edited: false })));
      setMeta(rest);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setReading(false);
    }
  };

  const update = (id: string, patch: Partial<Row>) => setRows((current) => current?.map((row) => (row.id === id ? { ...row, ...patch, edited: true } : row)) ?? null);

  const total = num(totalValue);
  const needsTotal = rows?.some((row) => !row.removed && !row.quantity && !row.marketValue && row.allocationPercent !== null) ?? false;

  /** Each active row resolved into what will be saved, or the reason it can't be yet. */
  const plan = useMemo(() => {
    return (rows ?? [])
      .filter((row) => !row.removed)
      .map((row) => {
        const symbol = row.symbol?.trim().toUpperCase() ?? '';
        const marketValue = row.marketValue ?? (total && row.allocationPercent ? (total * row.allocationPercent) / 100 : null);
        const quantity = row.isCash ? marketValue ?? row.quantity : (row.quantity ?? (marketValue && row.price ? marketValue / row.price : null));
        const buyPrice = row.isCash ? 1 : costMode === 'imported' ? (row.averageCost ?? row.price) : row.price;
        let problem: string | null = null;
        if (!row.isCash && !TICKER.test(symbol)) problem = 'Enter a ticker';
        else if (!quantity) problem = row.allocationPercent !== null ? 'Enter total value' : 'Enter shares';
        else if (!row.isCash && !buyPrice) problem = 'Enter a price';
        return { row, symbol, quantity, buyPrice, value: row.isCash ? quantity : quantity && row.price ? quantity * row.price : marketValue, problem };
      });
  }, [rows, total, costMode]);

  const blocking = plan.filter((item) => item.problem).length;
  const importValue = plan.reduce((sum, item) => sum + (item.value ?? 0), 0);

  const save = async () => {
    setSaving(true);
    try {
      const cash = plan.filter((item) => item.row.isCash).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      const created = await api<{ id: string; name: string }>('/api/portfolios/import', {
        body: {
          target: target === 'existing' && portfolioId ? { portfolioId } : { name: name.trim() || 'Imported portfolio' },
          tradedAt,
          cash: cash || undefined,
          rows: plan.filter((item) => !item.row.isCash).map((item) => ({ symbol: item.symbol, quantity: Number((item.quantity as number).toFixed(6)), price: Number((item.buyPrice as number).toFixed(4)) })),
        },
      });
      toast.success(`Imported ${plan.length} holding${plan.length === 1 ? '' : 's'} into ${created.name}`);
      reset();
      onImported(created.id);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reviewing = rows !== null;

  return (
    <Modal
      open={open}
      onClose={close}
      className={reviewing ? 'max-w-5xl' : 'max-w-xl'}
      title={reviewing ? 'Review imported holdings' : 'Import portfolio from photos'}
      description={
        reviewing
          ? 'Check every row before saving. Grok can misread photos; importing records opening buys and never places trades.'
          : 'Screenshots of a broker app, statement or allocation chart. Grok reads the holdings; you review them before anything is saved.'
      }
      footer={
        reviewing ? (
          <>
            <span className="mr-auto text-[12px] text-muted">
              {plan.length} holding{plan.length === 1 ? '' : 's'} · {money(importValue, { digits: 0 })}
              {blocking ? <span className="text-warning"> · {blocking} need{blocking === 1 ? 's' : ''} attention</span> : null}
            </span>
            <Button variant="ghost" onClick={() => setRows(null)} disabled={saving}>
              Back
            </Button>
            <Button variant="primary" loading={saving} disabled={!plan.length || blocking > 0 || (target === 'existing' && !portfolioId)} onClick={() => void save()}>
              Import {plan.length ? plan.length : ''} holding{plan.length === 1 ? '' : 's'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={reading}>
              Cancel
            </Button>
            <Button variant="primary" loading={reading} disabled={!photos.length} onClick={() => void read()}>
              {reading ? 'Reading holdings…' : `Read ${photos.length > 1 ? `${photos.length} photos` : 'photo'}`}
            </Button>
          </>
        )
      }
    >
      {!reviewing ? (
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
            disabled={reading || photos.length >= MAX_PHOTOS}
            className={cn(
              'flex flex-col items-center gap-2 rounded-sm border border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:border-brand/50 hover:bg-white/[0.02] disabled:opacity-50',
              dragging && 'border-brand bg-brand-wash',
            )}
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-white/[0.05] text-ink-2">
              <ImagePlus className="size-4.5" />
            </span>
            <span className="text-[13px] font-medium text-ink">Drop screenshots here or choose photos</span>
            <span className="text-[11.5px] text-muted">PNG, JPG or HEIC · up to {MAX_PHOTOS} photos (e.g. a long list across screens)</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {photos.length ? (
            <div className="grid grid-cols-4 gap-2">
              {photos.map((photo) => (
                <div key={photo.id} className="group relative aspect-[3/4] overflow-hidden rounded-sm border border-line bg-surface-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt={photo.name} className="size-full object-cover object-top" />
                  {!reading ? (
                    <button
                      onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
                      className="absolute top-1 right-1 rounded-xs bg-black/70 p-1 text-ink opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Remove ${photo.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                  {reading ? <div className="absolute inset-0 animate-pulse bg-brand/10" /> : null}
                </div>
              ))}
            </div>
          ) : null}
          <p className="flex items-start gap-2 text-[11.5px] text-muted">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-faint" />
            Crop to the holdings if you can. Account numbers, names, emails and unrelated balances are ignored. Photos are sent to xAI for reading and aren’t stored.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {meta?.partial || meta?.notes.length ? (
            <div className="flex items-start gap-2 rounded-sm border border-warning/25 bg-warning/5 px-3 py-2 text-[12px] text-ink-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <div>
                {meta.partial ? <p>The photo looks cut off. Add another screenshot if some holdings are missing.</p> : null}
                {meta.notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </div>
          ) : null}

          <div className="max-h-[46vh] overflow-auto rounded-sm border border-line">
            <table className="w-full min-w-[860px] text-[12.5px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-line bg-surface-1 text-left text-[11px] text-muted">
                  <th className="px-3 py-2 font-medium">Holding</th>
                  <th className="px-2 py-2 text-right font-medium">Shares</th>
                  <th className="px-2 py-2 text-right font-medium">Avg cost</th>
                  <th className="px-2 py-2 text-right font-medium">Price</th>
                  <th className="px-2 py-2 text-right font-medium">Value</th>
                  <th className="px-2 py-2 font-medium">Check</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const item = plan.find((entry) => entry.row.id === row.id);
                  const notes = row.edited ? [] : [...row.errors, ...row.warnings];
                  return (
                    <tr key={row.id} className={cn('border-b border-line align-top', row.removed && 'opacity-40')}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn('size-1.5 shrink-0 rounded-full', item?.problem ? 'bg-loss' : row.status === 'valid' || row.edited ? 'bg-gain' : 'bg-warning')}
                            title={`Confidence ${Math.round(row.confidence * 100)}%`}
                          />
                          {row.isCash ? (
                            <Badge>CASH</Badge>
                          ) : (
                            <Input
                              value={row.symbol ?? ''}
                              onChange={(event) => update(row.id, { symbol: event.target.value.toUpperCase() })}
                              placeholder={row.extractedSymbol ?? 'Ticker'}
                              disabled={row.removed}
                              className="h-7 w-20 font-mono text-[12px] uppercase"
                              aria-label="Ticker"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="max-w-52 truncate text-[12px] text-ink-2">{row.name ?? row.rawText ?? '—'}</div>
                            {!row.isCash && row.matches.length > 1 && !row.removed ? (
                              <Select
                                value=""
                                onChange={(event) => {
                                  const match = row.matches.find((entry) => entry.symbol === event.target.value);
                                  if (match) update(row.id, { symbol: match.symbol, name: match.name });
                                }}
                                className="mt-1 h-6 w-52 text-[11px]"
                                aria-label="Other matches"
                              >
                                <option value="">Other matches…</option>
                                {row.matches.map((match) => (
                                  <option key={match.symbol} value={match.symbol}>
                                    {match.symbol} · {match.name}
                                  </option>
                                ))}
                              </Select>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {row.isCash ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <NumberCell value={row.quantity} placeholder={item?.quantity ? String(Number(item.quantity.toFixed(4))) : '0'} disabled={row.removed} onChange={(value) => update(row.id, { quantity: value })} label="Shares" />
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {row.isCash ? <span className="text-faint">—</span> : <NumberCell value={row.averageCost} placeholder="—" disabled={row.removed} onChange={(value) => update(row.id, { averageCost: value })} label="Average cost" />}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {row.isCash ? <span className="text-faint">—</span> : <NumberCell value={row.price} placeholder="—" disabled={row.removed} onChange={(value) => update(row.id, { price: value })} label="Current price" />}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {row.isCash ? (
                          <NumberCell value={row.quantity} placeholder="0" disabled={row.removed} onChange={(value) => update(row.id, { quantity: value, marketValue: value })} label="Cash amount" />
                        ) : (
                          <span className="num inline-block pt-1 text-ink">{item?.value ? money(item.value, { digits: 0 }) : row.allocationPercent !== null ? `${row.allocationPercent}%` : '—'}</span>
                        )}
                      </td>
                      <td className="max-w-64 px-2 py-2 text-[11px] leading-snug">
                        {item?.problem ? <p className="pt-1 text-loss">{item.problem}</p> : null}
                        {notes
                          .filter((note) => !item?.problem || !row.errors.includes(note))
                          .slice(0, 2)
                          .map((note) => (
                            <p key={note} className="pt-1 text-muted">
                              {note}
                            </p>
                          ))}
                        {!item?.problem && !notes.length && !row.removed ? <p className="pt-1 text-faint">{row.edited ? 'Edited' : 'Looks right'}</p> : null}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => setRows((current) => current?.map((entry) => (entry.id === row.id ? { ...entry, removed: !entry.removed } : entry)) ?? null)}
                          className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink"
                          aria-label={row.removed ? 'Restore row' : 'Remove row'}
                          title={row.removed ? 'Restore' : 'Remove'}
                        >
                          {row.removed ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Import into">
              <div className="grid gap-2">
                <Segmented
                  size="xs"
                  value={target}
                  onChange={setTarget}
                  options={[{ value: 'new' as const, label: 'New portfolio' }, ...(portfolios.length ? [{ value: 'existing' as const, label: 'Existing' }] : [])]}
                />
                {target === 'new' ? (
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Portfolio name" maxLength={60} />
                ) : (
                  <Select value={portfolioId} onChange={(event) => setPortfolioId(event.target.value)}>
                    <option value="">Choose a portfolio</option>
                    {portfolios.map((portfolio) => (
                      <option key={portfolio.id} value={portfolio.id}>
                        {portfolio.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </Field>
            <Field label="Cost basis" hint={costMode === 'imported' ? 'Rows without an average cost use the current price.' : 'P&L starts from the import date.'}>
              <Segmented
                size="xs"
                value={costMode}
                onChange={setCostMode}
                options={[
                  { value: 'imported', label: 'From photo' },
                  { value: 'today', label: 'Current price' },
                ]}
              />
            </Field>
            <Field label="Opening trade date" hint="Performance and risk history start here.">
              <Input type="date" value={tradedAt} max={localToday()} onChange={(event) => setTradedAt(event.target.value)} />
            </Field>
            {needsTotal ? (
              <Field label="Total portfolio value" hint="Sizes rows that only show an allocation %." className="md:col-span-3">
                <Input inputMode="decimal" value={totalValue} onChange={(event) => setTotalValue(event.target.value)} placeholder="e.g. 125000" className="max-w-60" />
              </Field>
            ) : null}
          </div>
          {plan.length ? (
            <p className="text-[11.5px] text-muted">
              Saved as {plan.filter((item) => !item.row.isCash).length} opening buy{plan.filter((item) => !item.row.isCash).length === 1 ? '' : 's'} on {tradedAt}
              {plan.some((item) => item.row.isCash) ? ` plus ${money(plan.filter((item) => item.row.isCash).reduce((sum, item) => sum + (item.quantity ?? 0), 0), { digits: 0 })} cash` : ''}. You can edit or delete them later under Transactions. Buy prices: {plan
                .filter((item) => !item.row.isCash && item.buyPrice)
                .slice(0, 3)
                .map((item) => `${item.symbol} $${price(item.buyPrice)}`)
                .join(', ')}
              {plan.filter((item) => !item.row.isCash).length > 3 ? '…' : ''}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function NumberCell({ value, placeholder, disabled, onChange, label }: { value: number | null; placeholder: string; disabled?: boolean; onChange: (value: number | null) => void; label: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <Input
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => {
        setText(event.target.value);
        onChange(num(event.target.value));
      }}
      className="num ml-auto h-7 w-24 text-right text-[12px]"
    />
  );
}

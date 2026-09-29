'use client';

import { BarChart3, ClipboardCopy, Download, FileText, Image as ImageIcon, LayoutDashboard, LineChart, Link2, List, PieChart, Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { loadLogos, logoSymbols, renderShareImage, SHARE_FORMATS, SHARE_TEMPLATES, SHARE_THEMES, type ShareFormat, type ShareImageConfig, type ShareImageEnv, type ShareTemplate, type ShareTheme } from '@/components/portfolio/share/share-canvas';
import { CreateLinkButton, DEFAULT_LINK_SETTINGS, LinkList, LinkSettingsForm, type LinkSettings } from '@/components/portfolio/share/share-links';
import { Group, PrivacyControls, RangePicker, ToggleRow } from '@/components/portfolio/share/share-controls';
import { SharedPortfolio } from '@/components/portfolio/share/shared-view';
import { useMarketColors } from '@/components/shell/providers';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Field, Input, Segmented } from '@/components/ui/primitives';
import { DEFAULT_SHARE_OPTIONS, normalizeShareOptions, shareOptionsSchema, type ShareLinkItem, type ShareOptions } from '@/lib/share/options';
import { buildShareView, shareSummaryText, type ShareSource, type ShareSourceHolding } from '@/lib/share/view';
import { cn } from '@/lib/utils';

export type ShareStudioDetail = {
  portfolio: { id: string; name: string; benchmark: string; cash: number };
  holdings: ShareSourceHolding[];
  summary: { fixedIncome: number };
};

type Performance = { points: Array<{ t: number; twr: number; benchmark: number }> };

const DEFAULT_IMAGE: ShareImageConfig = { template: 'summary', format: 'square', theme: 'silver', caption: '', mark: true, date: true, colors: 'color' };
const TEMPLATE_ICON: Record<ShareTemplate, ComponentType<{ className?: string }>> = { summary: LayoutDashboard, holdings: List, allocation: PieChart, performance: LineChart, sectors: BarChart3 };
const THEME_SWATCH: Record<ShareTheme, string> = { silver: 'linear-gradient(135deg,#f4f6f9,#646d7b)', midnight: 'linear-gradient(135deg,#b0c9ff,#3a55a0)', paper: 'linear-gradient(135deg,#ffffff,#d5d7dc)', noir: 'linear-gradient(135deg,#ffffff,#000000)' };

const STORAGE_KEY = 'share:studio:v1';

/** What the last share used, so the studio opens the way you left it. Only a per-browser convenience. */
function loadPrefs(): { options: ShareOptions; image: ShareImageConfig } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as { options?: unknown; image?: Partial<ShareImageConfig> } | null;
    const options = shareOptionsSchema.safeParse(saved?.options);
    const image = saved?.image ?? {};
    return {
      options: options.success ? options.data : DEFAULT_SHARE_OPTIONS,
      image: {
        ...DEFAULT_IMAGE,
        ...(image.template && image.template in TEMPLATE_ICON ? { template: image.template } : {}),
        ...(image.format && image.format in SHARE_FORMATS ? { format: image.format } : {}),
        ...(image.theme && image.theme in SHARE_THEMES ? { theme: image.theme } : {}),
        ...(typeof image.mark === 'boolean' ? { mark: image.mark } : {}),
        ...(typeof image.date === 'boolean' ? { date: image.date } : {}),
        ...(image.colors === 'color' || image.colors === 'mono' ? { colors: image.colors } : {}),
      },
    };
  } catch {
    return { options: DEFAULT_SHARE_OPTIONS, image: DEFAULT_IMAGE };
  }
}

function savePrefs(options: ShareOptions, image: ShareImageConfig) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ options, image: { template: image.template, format: image.format, theme: image.theme, mark: image.mark, date: image.date, colors: image.colors } }));
  } catch {}
}

function fontEnv(market: ShareImageEnv['market'], logos: ShareImageEnv['logos']): ShareImageEnv {
  const style = getComputedStyle(document.documentElement);
  const family = (name: string, fallback: string) => `${style.getPropertyValue(name).trim() || 'system-ui'}, ${fallback}`;
  return { sans: family('--font-geist-sans', 'system-ui, sans-serif'), mono: family('--font-geist-mono', 'ui-monospace, monospace'), market, logos };
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'portfolio';

export function ShareStudio({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: ShareStudioDetail }) {
  const market = useMarketColors();
  const portfolioId = detail.portfolio.id;
  const [tab, setTab] = useState<'image' | 'link'>('image');
  const [initial] = useState(loadPrefs);
  const [options, setOptions] = useState<ShareOptions>(initial.options);
  const [image, setImage] = useState<ShareImageConfig>(initial.image);
  const [title, setTitle] = useState(detail.portfolio.name);
  const [link, setLink] = useState<LinkSettings>(DEFAULT_LINK_SETTINGS);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'download' | 'copy' | 'share' | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The image is dated when the studio was opened.
  const [asOf] = useState(() => Date.now());

  const { data: performance } = useSWR<Performance>(open ? `/api/portfolios/${portfolioId}/performance` : null);
  const source = useMemo<ShareSource>(
    () => ({
      name: detail.portfolio.name,
      benchmark: detail.portfolio.benchmark,
      cash: detail.portfolio.cash,
      fixedIncome: detail.summary.fixedIncome,
      holdings: detail.holdings,
      performance: performance?.points ?? null,
      asOf,
    }),
    [detail, performance, asOf],
  );
  const effective = useMemo(() => normalizeShareOptions(options), [options]);
  const view = useMemo(() => buildShareView(source, effective, title), [source, effective, title]);

  const patchOptions = (patch: Partial<ShareOptions>) =>
    setOptions((current) => {
      const next = { ...current, ...patch };
      savePrefs(next, image);
      return next;
    });
  const patchImage = (patch: Partial<ShareImageConfig>) =>
    setImage((current) => {
      const next = { ...current, ...patch };
      savePrefs(options, next);
      return next;
    });

  // Preview: redraw whenever anything it depends on changes (after the app font has loaded).
  useEffect(() => {
    if (!open || tab !== 'image') return;
    let cancelled = false;
    void (async () => {
      const logos = image.colors === 'color' ? await loadLogos(logoSymbols(view)) : new Map();
      const env = fontEnv(market, logos);
      try {
        await Promise.all([document.fonts.load(`600 20px ${env.sans}`), document.fonts.load(`600 20px ${env.mono}`)]);
      } catch {}
      if (!cancelled && canvasRef.current) renderShareImage(canvasRef.current, view, image, env, 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, view, image, market]);

  const makeBlob = async () => {
    const canvas = document.createElement('canvas');
    const env = fontEnv(market, image.colors === 'color' ? await loadLogos(logoSymbols(view)) : new Map());
    await Promise.all([document.fonts.load(`600 20px ${env.sans}`), document.fonts.load(`600 20px ${env.mono}`)]).catch(() => {});
    renderShareImage(canvas, view, image, env, 2);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be created.'))), 'image/png'));
  };
  const fileName = `${slug(title)}-${image.template}-${image.format}.png`;
  const run = async (kind: 'download' | 'copy' | 'share', action: () => Promise<string | void>) => {
    setBusy(kind);
    try {
      const message = await action();
      if (message) toast.success(message);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast.error((error as Error).message || 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };
  const download = () =>
    run('download', async () => {
      const url = URL.createObjectURL(await makeBlob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return 'Image downloaded';
    });
  const copyImage = () =>
    run('copy', async () => {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('This browser cannot copy images. Use Download instead.');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': makeBlob() })]);
      return 'Image copied';
    });
  const shareImage = () =>
    run('share', async () => {
      const file = new File([await makeBlob()], fileName, { type: 'image/png' });
      if (!navigator.canShare?.({ files: [file] })) throw new Error('Sharing files is not supported here. Use Download instead.');
      await navigator.share({ files: [file], title: view.title });
    });
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(shareSummaryText(view));
      toast.success('Summary copied');
    } catch {
      toast.error('Could not copy the summary.');
    }
  };

  const local = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const format = SHARE_FORMATS[image.format];
  const showRange = options.returns && (image.template === 'summary' || image.template === 'performance');
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share portfolio"
      description="Choose exactly what is visible, then export an image or create a link."
      className="max-w-5xl"
      footer={
        tab === 'image' ? (
          <>
            <Button variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => void copySummary()}>
              Copy summary
            </Button>
            {canShareFiles ? (
              <Button variant="outline" icon={<Share2 className="size-3.5" />} loading={busy === 'share'} onClick={() => void shareImage()}>
                Share…
              </Button>
            ) : null}
            <Button variant="outline" icon={<ClipboardCopy className="size-3.5" />} loading={busy === 'copy'} onClick={() => void copyImage()}>
              Copy image
            </Button>
            <Button variant="primary" icon={<Download className="size-3.5" />} loading={busy === 'download'} onClick={() => void download()}>
              Download PNG
            </Button>
          </>
        ) : (
          <CreateLinkButton portfolioId={portfolioId} title={title} options={effective} settings={link} onCreated={(created: ShareLinkItem) => {
              setCreatedId(created.id);
              // A passcode belongs to the link it was set on, not to the next one.
              setLink((current) => ({ ...current, passcode: '' }));
            }} />
        )
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'image', label: (<span className="inline-flex items-center gap-1.5"><ImageIcon className="size-3" /> Image</span>) },
            { value: 'link', label: (<span className="inline-flex items-center gap-1.5"><Link2 className="size-3" /> Link</span>) },
          ]}
        />
        {tab === 'link' && local ? <span className="hidden text-[11.5px] text-muted sm:block">Running locally: links only open on this computer.</span> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-6 lg:max-h-[62vh] lg:overflow-y-auto lg:pr-2">
          <Group title={tab === 'image' ? 'Header' : 'Title'}>
            <Field label="Title">
              <Input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder={detail.portfolio.name} />
            </Field>
            {tab === 'image' ? (
              <Field label="Caption" hint="Optional line under the title.">
                <Input value={image.caption} maxLength={120} onChange={(event) => patchImage({ caption: event.target.value })} placeholder="e.g. Q3 update" />
              </Field>
            ) : null}
          </Group>

          {tab === 'image' ? (
            <>
              <Group title="Template">
                <div className="grid grid-cols-5 gap-1.5">
                  {SHARE_TEMPLATES.map((template) => {
                    const Icon = TEMPLATE_ICON[template.id];
                    const active = image.template === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        title={template.hint}
                        aria-pressed={active}
                        onClick={() => patchImage({ template: template.id })}
                        className={cn('flex flex-col items-center gap-1.5 rounded-sm border px-1 py-2.5 text-[10.5px] transition-colors', active ? 'border-brand/50 bg-brand-wash text-ink' : 'border-line text-muted hover:border-line-strong hover:text-ink-2')}
                      >
                        <Icon className={cn('size-4', active && 'text-brand')} />
                        {template.label}
                      </button>
                    );
                  })}
                </div>
              </Group>

              <Group title="Look">
                <div className="flex flex-col gap-3">
                  <Segmented size="xs" value={image.format} onChange={(next: ShareFormat) => patchImage({ format: next })} options={(Object.keys(SHARE_FORMATS) as ShareFormat[]).map((id) => ({ value: id, label: `${SHARE_FORMATS[id].ratio}` }))} className="self-start" />
                  <div className="flex gap-2">
                    {(Object.keys(SHARE_THEMES) as ShareTheme[]).map((id) => (
                      <button key={id} type="button" aria-pressed={image.theme === id} onClick={() => patchImage({ theme: id })} className={cn('flex flex-1 flex-col items-center gap-1.5 rounded-sm border py-2 text-[10.5px] transition-colors', image.theme === id ? 'border-brand/50 bg-brand-wash text-ink' : 'border-line text-muted hover:border-line-strong')}>
                        <span className="size-5 rounded-full border border-white/20" style={{ background: THEME_SWATCH[id] }} />
                        {SHARE_THEMES[id].label}
                      </button>
                    ))}
                  </div>
                  {showRange ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11.5px] text-muted">Return period</span>
                      <RangePicker value={options.range} onChange={(range) => patchOptions({ range })} />
                    </div>
                  ) : null}
                  <div className="divide-y divide-line rounded-sm border border-line px-3 py-1">
                    <ToggleRow label="Stock colors & logos" checked={image.colors === 'color'} onChange={(on) => patchImage({ colors: on ? 'color' : 'mono' })} />
                    <ToggleRow label="SilverNote mark" checked={image.mark} onChange={(mark) => patchImage({ mark })} />
                    <ToggleRow label="Date" checked={image.date} onChange={(date) => patchImage({ date })} />
                  </div>
                </div>
              </Group>
            </>
          ) : (
            <LinkSettingsForm options={options} onOptions={patchOptions} settings={link} onSettings={(patch) => setLink((current) => ({ ...current, ...patch }))} />
          )}

          <PrivacyControls options={options} onChange={patchOptions} />

          {tab === 'link' ? <LinkList portfolioId={portfolioId} focusId={createdId} /> : null}
        </div>

        <div className="min-w-0">
          {tab === 'image' ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-full rounded-md border border-line bg-[repeating-conic-gradient(rgba(255,255,255,0.025)_0_25%,transparent_0_50%)] [background-size:16px_16px] p-3">
                <canvas ref={canvasRef} className="mx-auto block h-auto max-h-[56vh] w-auto max-w-full rounded-sm shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)]" style={{ aspectRatio: `${format.w} / ${format.h}` }} aria-label="Image preview" />
              </div>
              <div className="text-[11px] text-faint">
                {format.w * 2} × {format.h * 2} px · PNG
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-line bg-bg">
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] text-muted">
                <span>Preview · what visitors see</span>
                <span>{link.mode === 'live' ? 'Live' : 'Snapshot'}</span>
              </div>
              <div className="max-h-[56vh] overflow-y-auto p-4">
                <SharedPortfolio view={view} message={link.message.trim() || null} logoSrc={(symbol) => `/api/logo/${encodeURIComponent(symbol)}`} />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

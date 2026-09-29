'use client';

import { Check, Copy, ExternalLink, Eye, Link2, Lock, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { Group, RangePicker, ToggleRow } from '@/components/portfolio/share/share-controls';
import { Button } from '@/components/ui/button';
import { Badge, Field, Input, Segmented, Select, Textarea } from '@/components/ui/primitives';
import { api } from '@/lib/client';
import { relativeTime } from '@/lib/format';
import { describeShare, SHARE_EXPIRIES, type ShareExpiry, type ShareLinkItem, type ShareMode, type ShareOptions } from '@/lib/share/options';
import { cn } from '@/lib/utils';

export type LinkSettings = { message: string; mode: ShareMode; expires: ShareExpiry; passcode: string };
export const DEFAULT_LINK_SETTINGS: LinkSettings = { message: '', mode: 'live', expires: 'never', passcode: '' };

const EXPIRY_LABEL: Record<ShareExpiry, string> = { never: 'Never', '1d': 'In 1 day', '7d': 'In 7 days', '30d': 'In 30 days', '90d': 'In 90 days' };

const linkUrl = (token: string) => `${window.location.origin}/s/${token}`;

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/** Page sections, then how the link behaves: live or frozen, when it expires, whether it needs a passcode. */
export function LinkSettingsForm({ options, onOptions, settings, onSettings }: { options: ShareOptions; onOptions: (patch: Partial<ShareOptions>) => void; settings: LinkSettings; onSettings: (patch: Partial<LinkSettings>) => void }) {
  const sectionsFor = <K extends keyof ShareOptions['sections']>(key: K, value: boolean) => onOptions({ sections: { ...options.sections, [key]: value } });
  return (
    <>
      <Group title="Page">
        <Field label="Note for viewers" hint="Shown under the title. Optional.">
          <Textarea value={settings.message} maxLength={280} onChange={(event) => onSettings({ message: event.target.value })} placeholder="Why you are sharing this…" className="min-h-16" />
        </Field>
        <div className="divide-y divide-line rounded-sm border border-line px-3 py-1">
          <ToggleRow label="Performance chart" hint={!options.returns ? 'Needs gains & performance' : undefined} checked={options.sections.performance} disabled={!options.returns} onChange={(value) => sectionsFor('performance', value)} />
          <ToggleRow label="Allocation" checked={options.sections.allocation} onChange={(value) => sectionsFor('allocation', value)} />
          <ToggleRow label="Sectors" checked={options.sections.sectors} onChange={(value) => sectionsFor('sectors', value)} />
          <ToggleRow label="Holdings table" hint={options.detail === 'sectors' ? 'Not with sectors only' : undefined} checked={options.sections.holdings} disabled={options.detail === 'sectors'} onChange={(value) => sectionsFor('holdings', value)} />
        </div>
        {options.sections.performance && options.returns ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-muted">Chart range</span>
            <RangePicker value={options.range} onChange={(range) => onOptions({ range })} />
          </div>
        ) : null}
      </Group>

      <Group title="Access">
        <div className="flex flex-col gap-1.5">
          <Segmented
            value={settings.mode}
            onChange={(mode) => onSettings({ mode })}
            options={[
              { value: 'live', label: 'Live' },
              { value: 'snapshot', label: 'Snapshot' },
            ]}
            className="self-start"
          />
          <p className="text-[11.5px] leading-relaxed text-muted">{settings.mode === 'live' ? 'Follows your portfolio: new trades and prices show up on the page. Privacy rules are applied on every visit.' : 'Freezes what you see in the preview today. Later trades never appear.'}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expires">
            <Select value={settings.expires} onChange={(event) => onSettings({ expires: event.target.value as ShareExpiry })}>
              {SHARE_EXPIRIES.map((expiry) => (
                <option key={expiry} value={expiry}>
                  {EXPIRY_LABEL[expiry]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Passcode">
            <Input type="password" autoComplete="new-password" value={settings.passcode} onChange={(event) => onSettings({ passcode: event.target.value })} placeholder="None" />
          </Field>
        </div>
        {settings.passcode && settings.passcode.length < 4 ? <p className="text-[11.5px] text-warning">A passcode needs at least 4 characters.</p> : null}
      </Group>
    </>
  );
}

function statusBadge(link: ShareLinkItem) {
  if (link.status === 'revoked') return <Badge tone="loss">Turned off</Badge>;
  if (link.status === 'expired') return <Badge tone="warning">Expired</Badge>;
  return link.mode === 'live' ? <Badge tone="brand">Live</Badge> : <Badge>Snapshot</Badge>;
}

function expiryText(link: ShareLinkItem) {
  if (!link.expires_at || link.status !== 'ok') return null;
  const days = Math.ceil((new Date(link.expires_at).getTime() - Date.now()) / 86_400_000);
  return days <= 1 ? 'Expires within a day' : `Expires in ${days} days`;
}

export function LinkList({ portfolioId, focusId }: { portfolioId: string; focusId: string | null }) {
  const key = `/api/portfolios/${portfolioId}/shares`;
  const { data: links, mutate } = useSWR<ShareLinkItem[]>(key);
  const [copied, setCopied] = useState<string | null>(null);

  // A link that was just created scrolls into view in the (long) column.
  useEffect(() => {
    if (focusId) document.getElementById(`share-link-${focusId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusId, links?.length]);

  if (!links?.length) return null;

  const copy = async (link: ShareLinkItem) => {
    if (await copyText(linkUrl(link.token))) {
      setCopied(link.id);
      setTimeout(() => setCopied((current) => (current === link.id ? null : current)), 1600);
    } else toast.error('Could not copy. Select the link and copy it manually.');
  };
  const patch = async (link: ShareLinkItem, body: object, message: string) => {
    try {
      await api(`${key}/${link.id}`, { method: 'PATCH', body });
      await mutate();
      toast.success(message);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const remove = async (link: ShareLinkItem) => {
    if (!window.confirm('Delete this link? Anyone who has it will lose access.')) return;
    try {
      await api(`${key}/${link.id}`, { method: 'DELETE' });
      await mutate();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <Group title={`Your links · ${links.length}`}>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.id} id={`share-link-${link.id}`} className={cn('rounded-sm border bg-surface-1 p-3 transition-colors', link.id === focusId ? 'border-brand/50' : 'border-line', link.status !== 'ok' && 'opacity-70')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {statusBadge(link)}
                  {link.protected ? (
                    <Badge tone="outline">
                      <Lock className="size-2.5" /> Passcode
                    </Badge>
                  ) : null}
                  <span className="truncate text-[12.5px] font-medium text-ink">{link.title || 'Untitled link'}</span>
                </div>
                <div className="mt-1 text-[11px] text-muted">{describeShare(link.options)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-faint">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="size-3" /> {link.view_count} view{link.view_count === 1 ? '' : 's'}
                    {link.last_viewed_at ? ` · last ${relativeTime(link.last_viewed_at)}` : ''}
                  </span>
                  <span>Created {relativeTime(link.created_at)}</span>
                  {expiryText(link) ? <span>{expiryText(link)}</span> : null}
                </div>
              </div>
            </div>
            <div className="mt-2.5 truncate rounded-xs border border-line bg-surface-2 px-2 py-1 font-mono text-[10.5px] text-muted select-all">{linkUrl(link.token)}</div>
            <div className="mt-2 flex items-center gap-1.5">
              <Button size="xs" variant="outline" icon={copied === link.id ? <Check className="size-3 text-gain" /> : <Copy className="size-3" />} onClick={() => void copy(link)}>
                {copied === link.id ? 'Copied' : 'Copy link'}
              </Button>
              <a href={linkUrl(link.token)} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-xs border border-line-strong px-2 text-[11px] font-medium text-ink-2 hover:text-ink">
                <ExternalLink className="size-3" /> Open
              </a>
              <span className="flex-1" />
              {link.status === 'revoked' ? (
                <Button size="xs" variant="ghost" icon={<Undo2 className="size-3" />} onClick={() => void patch(link, { revoked: false }, 'Link turned back on')}>
                  Restore
                </Button>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => void patch(link, { revoked: true }, 'Link turned off')}>
                  Turn off
                </Button>
              )}
              <button type="button" onClick={() => void remove(link)} aria-label="Delete link" className="rounded-xs p-1 text-faint hover:bg-white/5 hover:text-ink">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Group>
  );
}

/** Creates a link with the current privacy options and settings, then copies its address. */
export function CreateLinkButton({ portfolioId, title, options, settings, onCreated }: { portfolioId: string; title: string; options: ShareOptions; settings: LinkSettings; onCreated: (link: ShareLinkItem) => void }) {
  const [busy, setBusy] = useState(false);
  const { mutate } = useSWR<ShareLinkItem[]>(`/api/portfolios/${portfolioId}/shares`);
  const invalid = settings.passcode.length > 0 && settings.passcode.length < 4;

  const create = async () => {
    setBusy(true);
    try {
      const link = await api<ShareLinkItem>(`/api/portfolios/${portfolioId}/shares`, {
        body: { title: title.trim() || null, message: settings.message.trim() || null, mode: settings.mode, options, expires: settings.expires, passcode: settings.passcode || null },
      });
      await mutate();
      onCreated(link);
      const copied = await copyText(linkUrl(link.token));
      toast.success(copied ? 'Link created and copied' : 'Link created');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="primary" size="md" icon={<Link2 className="size-3.5" />} loading={busy} disabled={invalid} onClick={() => void create()}>
      Create link
    </Button>
  );
}

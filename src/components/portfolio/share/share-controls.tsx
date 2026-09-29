'use client';

import type { ReactNode } from 'react';

import { Input, Segmented, Switch } from '@/components/ui/primitives';
import { AMOUNT_LABEL, DETAIL_LABEL, SCALED_BASE, SHARE_AMOUNTS, SHARE_DETAILS, SHARE_RANGES, type ShareOptions, type ShareRange } from '@/lib/share/options';
import { cn } from '@/lib/utils';

/** Copies text, falling back to a hidden textarea where the async clipboard is blocked (embedded frames, plain http). */
export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(field);
      field.select();
      const done = document.execCommand('copy');
      field.remove();
      return done;
    } catch {
      return false;
    }
  }
}

/** A labelled block of controls in the studio's left column. */
export function Group({ title, hint, children, className }: { title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      <div>
        <h4 className="kicker">{title}</h4>
        {hint ? <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1', disabled && 'opacity-45')}>
      <div className="min-w-0">
        <div className="text-[12.5px] text-ink-2">{label}</div>
        {hint ? <div className="text-[11px] text-muted">{hint}</div> : null}
      </div>
      <Switch checked={checked && !disabled} onChange={disabled ? () => {} : onChange} label={label} />
    </div>
  );
}

export function RangePicker({ value, onChange }: { value: ShareRange; onChange: (value: ShareRange) => void }) {
  return <Segmented size="xs" value={value} onChange={onChange} options={SHARE_RANGES.map((range) => ({ value: range, label: range }))} />;
}

const AMOUNT_HINT = {
  exact: 'Real dollar values and gains.',
  scaled: `Same mix and returns, shown as a ${'$'}${SCALED_BASE / 1000}K portfolio. Your real size stays private.`,
  hidden: 'Weights and percentages only. No dollar figure anywhere.',
} as const;

/** What viewers will and will not see, in one line. */
export function revealSummary(options: ShareOptions) {
  const sees = ['weights'];
  if (options.returns) sees.push('returns');
  if (options.amounts === 'exact') sees.push('dollar amounts');
  if (options.amounts === 'scaled') sees.push('a $100K model');
  if (options.shares) sees.push('share counts');
  if (options.detail !== 'sectors') sees.push('tickers');
  const hides: string[] = [];
  if (options.amounts === 'hidden') hides.push('dollar amounts');
  if (options.amounts === 'scaled') hides.push('your real value');
  if (!options.shares) hides.push('share counts');
  if (!options.returns) hides.push('gains & losses');
  if (options.detail === 'sectors') hides.push('tickers');
  return { sees, hides };
}

/** The privacy controls: identical for the image and the link, so what you preview is what you share. */
export function PrivacyControls({ options, onChange }: { options: ShareOptions; onChange: (patch: Partial<ShareOptions>) => void }) {
  const summary = revealSummary(options);
  const sectorsOnly = options.detail === 'sectors';
  return (
    <Group title="Privacy" hint={AMOUNT_HINT[options.amounts]}>
      <Segmented value={options.amounts} onChange={(amounts) => onChange({ amounts })} options={SHARE_AMOUNTS.map((amounts) => ({ value: amounts, label: AMOUNT_LABEL[amounts] }))} className="self-start" />
      <div className="flex flex-col gap-1.5">
        <span className="text-[11.5px] text-muted">Holdings shown</span>
        <Segmented size="xs" value={options.detail} onChange={(detail) => onChange({ detail })} options={SHARE_DETAILS.map((detail) => ({ value: detail, label: DETAIL_LABEL[detail] }))} className="self-start" />
      </div>
      <div className="divide-y divide-line rounded-sm border border-line px-3 py-1">
        <ToggleRow label="Gains, losses & performance" checked={options.returns} onChange={(returns) => onChange({ returns })} />
        <ToggleRow label="Share counts" hint={options.amounts !== 'exact' ? 'Needs exact amounts' : sectorsOnly ? 'Not with sectors only' : undefined} checked={options.shares} disabled={options.amounts !== 'exact' || sectorsOnly} onChange={(shares) => onChange({ shares })} />
        <ToggleRow label="Include cash" hint="Off: weights are of the invested part" checked={options.cash} onChange={(cash) => onChange({ cash })} />
        <div className="py-1">
          <ToggleRow label="Show my name" checked={options.owner !== null} onChange={(on) => onChange({ owner: on ? (options.owner ?? '') : null })} />
          {options.owner !== null ? <Input value={options.owner} maxLength={40} onChange={(event) => onChange({ owner: event.target.value })} placeholder="Your name or handle" className="mt-1" aria-label="Name to show" autoFocus={options.owner === ''} /> : null}
        </div>
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">
        <span className="text-ink-2">Viewers see</span> {summary.sees.join(', ')}.{summary.hides.length ? <> <span className="text-ink-2">Hidden:</span> {summary.hides.join(', ')}.</> : null}
      </p>
    </Group>
  );
}

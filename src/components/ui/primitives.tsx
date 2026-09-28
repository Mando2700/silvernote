'use client';

import { motion } from 'motion/react';
import { forwardRef, useId, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function Panel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel', className)} {...props}>
      {children}
    </div>
  );
}

export function PanelHeader({
  kicker,
  title,
  actions,
  className,
  children,
}: {
  kicker?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-3.5 pb-3', className)}>
      <div className="min-w-0">
        {kicker ? <div className="kicker mb-1">{kicker}</div> : null}
        {title ? <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h2> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'gain' | 'loss' | 'warning' | 'outline';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-white/[0.06] text-ink-2 border-transparent',
    brand: 'bg-brand-wash text-brand-soft border-brand/30',
    gain: 'bg-gain/10 text-gain border-gain/25',
    loss: 'bg-loss/10 text-loss border-loss/25',
    warning: 'bg-warning/10 text-warning border-warning/25',
    outline: 'bg-transparent text-muted border-line-strong',
  } as const;
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-xs border px-1.5 font-mono text-[10.5px] font-medium tracking-wide whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-[3px] border border-line-strong bg-surface-3 px-1 font-mono text-[10px] text-muted', className)}>
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-sm bg-white/[0.04]', className)}>
      <div className="absolute inset-0 -translate-x-full animate-sweep bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon ? <div className="mb-1 grid size-10 place-items-center rounded-md border border-line-strong bg-surface-3 text-muted">{icon}</div> : null}
      <div className="text-[13.5px] font-medium text-ink">{title}</div>
      {body ? <div className="max-w-sm text-[12.5px] leading-relaxed text-muted">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[11.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

const inputBase =
  'w-full rounded-sm border border-line-strong bg-surface-1 px-2.5 text-[13px] text-ink placeholder:text-faint transition-[border-color,box-shadow] outline-none focus:border-brand/60 focus:shadow-[0_0_0_3px_rgba(205,212,222,0.07)]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(inputBase, 'h-8', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputBase, 'min-h-24 py-2 leading-relaxed', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(inputBase, 'h-8 appearance-none bg-[length:10px] bg-[right_8px_center] bg-no-repeat pr-7', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23858a95' fill='none' stroke-width='1.4'/%3E%3C/svg%3E\")" }} {...props}>
      {children}
    </select>
  );
});

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-4.5 w-8 shrink-0 rounded-full border transition-colors', checked ? 'border-brand/60 bg-brand/80' : 'border-line-strong bg-surface-4')}
    >
      <motion.span
        className="absolute top-[2px] left-[2px] size-3 rounded-full bg-white shadow"
        animate={{ x: checked ? 14 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

/** Segmented control with a sliding indicator (shared layout animation). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('inline-flex max-w-full overflow-x-auto rounded-sm border border-line bg-surface-1 p-0.5 [scrollbar-width:none]', className)} role="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative shrink-0 whitespace-nowrap rounded-[3px] font-medium transition-colors',
              size === 'xs' ? 'h-5.5 px-2 text-[11px]' : 'h-6.5 px-2.5 text-[12px]',
              active ? 'text-ink' : 'text-muted hover:text-ink-2',
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[3px] border border-white/10 bg-surface-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            ) : null}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Underlined tabs with an animated silver indicator. */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: Array<{ value: T; label: ReactNode; badge?: ReactNode }>;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-center gap-1 overflow-x-auto', className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn('relative flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium whitespace-nowrap transition-colors', active ? 'text-ink' : 'text-muted hover:text-ink-2')}
          >
            {tab.label}
            {tab.badge}
            {active ? (
              <motion.span
                layoutId={`tab-${id}`}
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-brand shadow-[0_0_12px_rgba(205,212,222,0.48)]"
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="truncate text-[11.5px] text-muted">{label}</span>
      <span className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">{value}</span>
      {sub ? <span className="truncate text-[11.5px]">{sub}</span> : null}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-line', className)} />;
}

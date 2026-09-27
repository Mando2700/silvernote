import { useId } from 'react';

import { cn } from '@/lib/utils';

/** SilverNote mark: a brushed-silver tile carrying a rising price line. */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  const id = `metal-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7f8fa" />
          <stop offset="0.3" stopColor="#d3d9e1" />
          <stop offset="0.52" stopColor="#959daa" />
          <stop offset="0.72" stopColor="#e6e9ee" />
          <stop offset="1" stopColor="#aab1bb" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#ffffff" strokeOpacity="0.55" />
      <path d="M7.5 21.5 L13 15.5 L17.5 18.5 L24.5 10.5" fill="none" stroke="#0b0c0f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.5" cy="10.5" r="2.1" fill="#0b0c0f" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-mono text-[13px] font-semibold tracking-[0.22em]', className)}>
      <span className="text-silver">SILVER</span>
      <span className="text-ink">NOTE</span>
    </span>
  );
}

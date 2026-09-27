'use client';

import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'sheen bg-silver text-[#0b0c0f] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_0_0_1px_rgba(205,212,222,0.35),0_8px_24px_-12px_rgba(205,212,222,0.5)] hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_0_0_1px_rgba(236,241,248,0.5),0_10px_30px_-10px_rgba(205,212,222,0.65)]',
  secondary: 'bg-surface-4 text-ink border border-line-strong hover:bg-[#232832] hover:border-white/20',
  outline: 'border border-line-strong text-ink-2 hover:text-ink hover:border-white/25 hover:bg-white/[0.03]',
  ghost: 'text-ink-2 hover:text-ink hover:bg-white/[0.05]',
  danger: 'bg-transparent border border-critical/40 text-[#ff8a8e] hover:bg-critical/10',
};

const SIZES: Record<Size, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-xs',
  sm: 'h-7.5 px-2.5 text-[12.5px] gap-1.5 rounded-sm',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-sm',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background,box-shadow,border-color,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, className, size = 'sm', variant = 'ghost', children, ...props },
  ref,
) {
  const square = size === 'xs' ? 'w-6 px-0' : size === 'sm' ? 'w-7.5 px-0' : 'w-9 px-0';
  return (
    <Button ref={ref} aria-label={label} title={label} variant={variant} size={size} className={cn(square, className)} {...props}>
      {children}
    </Button>
  );
});

/** Pulls gently toward the pointer; springs back on leave. Disabled under reduced motion. */
export function Magnetic({ children, strength = 0.28, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 260, damping: 18, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 260, damping: 18, mass: 0.4 });
  return (
    <motion.div
      ref={ref}
      className={cn('inline-flex', className)}
      style={reduced ? undefined : { x: springX, y: springY }}
      onPointerMove={(event) => {
        if (reduced || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        x.set((event.clientX - (rect.left + rect.width / 2)) * strength);
        y.set((event.clientY - (rect.top + rect.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

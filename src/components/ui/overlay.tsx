'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true on the client: portals need `document`. */
function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const mounted = useMounted();
  useEscape(open, onClose);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn('panel relative w-full max-w-lg bg-surface-2 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]', className)}
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            {title ? (
              <div className="flex items-start justify-between gap-4 px-5 pt-4.5 pb-1">
                <div>
                  <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
                  {description ? <p className="mt-1 text-[12.5px] text-muted">{description}</p> : null}
                </div>
                <button onClick={onClose} className="rounded-sm p-1 text-muted hover:bg-white/5 hover:text-ink" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>
            ) : null}
            <div className="px-5 py-4">{children}</div>
            {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const mounted = useMounted();
  useEscape(open, onClose);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70]">
          <motion.div className="absolute inset-0 bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="absolute top-0 right-0 flex h-full flex-col border-l border-line-strong bg-surface-2 shadow-[-30px_0_60px_-20px_rgba(0,0,0,0.8)]"
            style={{ width: `min(${width}px, 100vw)` }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-[14px] font-semibold">{title}</div>
              <button onClick={onClose} className="rounded-sm p-1 text-muted hover:bg-white/5 hover:text-ink" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Lightweight hover/focus card anchored to its trigger. */
export function HoverCard({
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  className,
  openDelay = 120,
}: {
  trigger: ReactNode;
  children: ReactNode;
  side?: 'bottom' | 'top';
  align?: 'center' | 'start' | 'end';
  className?: string;
  openDelay?: number;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), openDelay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 90);
  };
  const alignClass = align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'start' ? 'left-0' : 'right-0';
  return (
    <span className="relative inline-flex" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>
      {trigger}
      <AnimatePresence>
        {open ? (
          <motion.div
            className={cn('absolute z-[60]', alignClass, side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2')}
            initial={{ opacity: 0, y: side === 'bottom' ? -4 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: side === 'bottom' ? -4 : 4 }}
            transition={{ duration: 0.14 }}
          >
            <div className={cn('panel bg-surface-3 p-3 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)]', className)}>{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

/** Click-to-open menu. */
export function Menu({
  trigger,
  items,
  align = 'end',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: Array<{ label: ReactNode; onSelect: () => void; icon?: ReactNode; danger?: boolean } | 'separator'>;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  useEscape(open, () => setOpen(false));
  const toggle = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, ...(align === 'end' ? { right: window.innerWidth - rect.right } : { left: rect.left }) });
    setOpen((value) => !value);
  };
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle })}
      {mounted
        ? createPortal(
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menuRef}
            style={pos}
            className="panel fixed z-[200] min-w-44 bg-surface-3 p-1 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)]"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
          >
            {items.map((item, index) =>
              item === 'separator' ? (
                <div key={`sep-${index}`} className="my-1 h-px bg-line" />
              ) : (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-[12.5px] transition-colors',
                    item.danger ? 'text-[#ff8a8e] hover:bg-critical/10' : 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              ),
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}

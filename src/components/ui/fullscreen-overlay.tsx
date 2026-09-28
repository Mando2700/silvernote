'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders children into document.body via a portal, escaping any ancestor
 * that establishes a containing block for `position: fixed` (e.g. a
 * framer-motion element with `layout`, which sets `will-change: transform`).
 * Without this, a plain `fixed inset-0` inside such an ancestor is
 * positioned relative to that ancestor instead of the viewport, so it can
 * render underneath the sidebar instead of covering it.
 *
 * Only ever mounted client-side, in response to a user interaction, so no
 * SSR/hydration guard is needed before calling createPortal.
 */
export function FullscreenOverlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-4 flex flex-col">{children}</div>
    </div>,
    document.body,
  );
}

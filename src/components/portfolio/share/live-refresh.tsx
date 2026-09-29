'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Keeps a live link current: re-renders the page on the server every minute while it is on screen. */
export function LiveRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}

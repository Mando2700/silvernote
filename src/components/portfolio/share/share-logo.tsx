'use client';

import { useState } from 'react';

/** A company logo tile ringed in the stock's color, over a lettered fallback while it loads or when there is none. */
export function ShareLogo({ symbol, color, src, size = 20 }: { symbol: string; color: string; src?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const radius = Math.max(4, Math.round(size * 0.26));
  return (
    <span className="relative inline-grid shrink-0 place-items-center overflow-hidden bg-surface-4 font-mono font-semibold text-ink-2" style={{ width: size, height: size, borderRadius: radius, boxShadow: `0 0 0 1.5px ${color}`, fontSize: Math.max(8, size * 0.42) }} aria-hidden>
      {symbol.replace(/[^A-Z0-9]/gi, '').slice(0, 1)}
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 size-full bg-surface-4 object-contain" />
      ) : null}
    </span>
  );
}

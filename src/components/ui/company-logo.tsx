'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

const SIZES = { xs: 16, sm: 20, md: 28, lg: 44, xl: 60 } as const;

type Size = keyof typeof SIZES | number;

/**
 * Company logo tile fading in over a silver monogram. The server trims each logo and centres it
 * on a square tile with a contrasting background. Logos come from /api/logo, which fetches each one once and caches it.
 */
export function CompanyLogo({ symbol, size = 'sm', className }: { symbol: string; size?: Size; className?: string }) {
  const px = typeof size === 'number' ? size : SIZES[size];
  // Remount per symbol so load state never leaks between rows that reuse a component.
  return <LogoTile key={symbol} symbol={symbol} px={px} className={className} />;
}

function LogoTile({ symbol, px, className }: { symbol: string; px: number; className?: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const radius = Math.max(3, Math.round(px * 0.24));

  // An image cached by the browser can finish before hydration attaches onLoad/onError.
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete) setStatus(image.naturalWidth > 0 ? 'ready' : 'missing');
  }, []);

  const letters = symbol.replace(/[^A-Z0-9]/gi, '').slice(0, px >= 28 ? 2 : 1);

  return (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden border border-white/10 bg-surface-4', className)}
      style={{ width: px, height: px, borderRadius: radius }}
      aria-hidden
    >
      {status !== 'ready' ? (
        <span className="font-mono leading-none font-semibold text-brand-soft" style={{ fontSize: Math.max(8, px * (letters.length > 1 ? 0.34 : 0.46)) }}>
          {letters}
        </span>
      ) : null}
      {status !== 'missing' ? (
        // eslint-disable-next-line @next/next/no-img-element -- small same-origin images; next/image adds nothing here
        <img
          ref={imageRef}
          src={`/api/logo/${encodeURIComponent(symbol)}?v=4`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('missing')}
          className={cn('absolute inset-0 size-full object-cover transition-opacity duration-300', status === 'ready' ? 'opacity-100' : 'opacity-0')}
        />
      ) : null}
    </span>
  );
}

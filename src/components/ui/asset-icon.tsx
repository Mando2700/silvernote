import { useId } from 'react';

/** Metal tints for the ingot: light face, mid tone, shadow. */
const METALS: Record<string, [string, string, string]> = {
  'GC-F': ['#fbe7a1', '#e2b54b', '#9c7022'],
  'SI-F': ['#f7f8fa', '#c5cbd3', '#828a96'],
  'PL-F': ['#f1f4f7', '#bfc8d2', '#7f8a98'],
  'PA-F': ['#eee9e1', '#c3bbad', '#857d70'],
  'HG-F': ['#f8c29b', '#d17a45', '#8a4520'],
};

function Ingot({ id, tint }: { id: string; tint: [string, string, string] }) {
  const [light, mid, dark] = tint;
  return (
    <>
      <defs>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mid} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <path d="M9 13.5 L23 13.5 L26.5 21.5 L5.5 21.5 Z" fill={`url(#${id}-front)`} />
      <path d="M10.5 10 L21.5 10 L23 13.5 L9 13.5 Z" fill={`url(#${id}-top)`} />
      <path d="M10.5 10 L21.5 10 L23 13.5 L9 13.5 Z" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="0.6" strokeLinejoin="round" />
      <path d="M8 16.5 L24 16.5" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="0.8" />
    </>
  );
}

function Drop({ id, accent }: { id: string; accent: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-drop`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a4237" />
          <stop offset="1" stopColor="#0b0a08" />
        </linearGradient>
      </defs>
      <path d="M16 5.5 C16 5.5 8.5 14 8.5 19 a7.5 7.5 0 0 0 15 0 C23.5 14 16 5.5 16 5.5 Z" fill={`url(#${id}-drop)`} stroke={accent} strokeWidth="1.2" />
      <path d="M12.2 19.5 a4 4 0 0 0 3 3.6" fill="none" stroke={accent} strokeOpacity="0.85" strokeWidth="1.4" strokeLinecap="round" />
    </>
  );
}

function Flame({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-flame`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#1d4fd1" />
          <stop offset="1" stopColor="#6fb6ff" />
        </linearGradient>
      </defs>
      <path d="M16 4.5 C17.5 9 22.5 11.5 22.5 18 a6.5 6.5 0 0 1 -13 0 C9.5 14 12 12 13 9 C14 11.5 15 12 15.5 12 C15.5 9.5 15.2 7 16 4.5 Z" fill={`url(#${id}-flame)`} />
      <path d="M16 15 C17 17 19 18 19 20.5 a3 3 0 0 1 -6 0 C13 18.5 15 17.5 16 15 Z" fill="#d8ecff" />
    </>
  );
}

function Coin({ fill, glyph, glyphColor = '#ffffff' }: { fill: string; glyph: string; glyphColor?: string }) {
  return (
    <>
      <circle cx="16" cy="16" r="11" fill={fill} />
      <circle cx="16" cy="16" r="11" fill="none" stroke="#ffffff" strokeOpacity="0.25" />
      <text x="16" y="16.5" textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" fill={glyphColor} fontFamily="ui-sans-serif, system-ui, sans-serif">
        {glyph}
      </text>
    </>
  );
}

function Ether() {
  return (
    <>
      <circle cx="16" cy="16" r="11" fill="#627eea" />
      <path d="M16 6.5 L10.5 16 L16 19.2 L21.5 16 Z" fill="#ffffff" fillOpacity="0.95" />
      <path d="M16 6.5 L16 19.2 L21.5 16 Z" fill="#c1ccf7" />
      <path d="M10.5 17.2 L16 25.5 L21.5 17.2 L16 20.4 Z" fill="#ffffff" fillOpacity="0.95" />
      <path d="M16 20.4 L16 25.5 L21.5 17.2 Z" fill="#c1ccf7" />
    </>
  );
}

function Solana({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sol`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="11" fill="#0d0b14" />
      {[10.5, 15, 19.5].map((y, index) => (
        <path key={y} d={index === 1 ? `M10 ${y} L20 ${y} L22.5 ${y + 2.5} L12.5 ${y + 2.5} Z` : `M12.5 ${y} L22.5 ${y} L20 ${y + 2.5} L10 ${y + 2.5} Z`} fill={`url(#${id}-sol)`} />
      ))}
    </>
  );
}

function Xrp() {
  return (
    <>
      <circle cx="16" cy="16" r="11" fill="#23292f" />
      <path d="M10 9.5 L13.6 13.1 a3.4 3.4 0 0 0 4.8 0 L22 9.5 M10 22.5 L13.6 18.9 a3.4 3.4 0 0 1 4.8 0 L22 22.5" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** Icon for a commodity or crypto symbol, or null when there is none (the caller falls back to its monogram). */
export function AssetIcon({ symbol, px }: { symbol: string; px: number }) {
  const id = `asset-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  let art: React.ReactNode;
  if (METALS[symbol]) art = <Ingot id={id} tint={METALS[symbol]} />;
  else if (symbol === 'CL-F') art = <Drop id={id} accent="#e2a43b" />;
  else if (symbol === 'BZ-F') art = <Drop id={id} accent="#3fb6a8" />;
  else if (symbol === 'NG-F') art = <Flame id={id} />;
  else if (symbol === 'BTC-USD') art = <Coin fill="#f7931a" glyph="₿" />;
  else if (symbol === 'ETH-USD') art = <Ether />;
  else if (symbol === 'SOL-USD') art = <Solana id={id} />;
  else if (symbol === 'XRP-USD') art = <Xrp />;
  else if (symbol === 'DOGE-USD') art = <Coin fill="#c2a633" glyph="Ð" />;
  else return null;
  return (
    <svg width={px} height={px} viewBox="0 0 32 32" aria-hidden className="absolute inset-0 size-full">
      <rect width="32" height="32" fill="#14161b" />
      {art}
    </svg>
  );
}

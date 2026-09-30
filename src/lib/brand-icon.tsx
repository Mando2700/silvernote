import { ImageResponse } from 'next/og';

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7f8fa"/><stop offset="0.3" stop-color="#d3d9e1"/><stop offset="0.52" stop-color="#959daa"/><stop offset="0.72" stop-color="#e6e9ee"/><stop offset="1" stop-color="#aab1bb"/></linearGradient></defs><rect width="32" height="32" fill="url(#m)"/><path d="M7.5 21.5 L13 15.5 L17.5 18.5 L24.5 10.5" fill="none" stroke="#0b0c0f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24.5" cy="10.5" r="2.1" fill="#0b0c0f"/></svg>`;

/** The SilverNote mark as a square PNG (full-bleed: the OS applies its own corner mask). */
export function brandIcon(size: number) {
  const src = `data:image/svg+xml;base64,${Buffer.from(MARK).toString('base64')}`;
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} width={size} height={size} alt="" />
    ),
    { width: size, height: size },
  );
}

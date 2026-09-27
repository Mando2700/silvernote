import 'server-only';

import sharp from 'sharp';

const SIZE = 128;
const LIGHT_TILE = { r: 255, g: 255, b: 255, alpha: 1 };
const DARK_TILE = { r: 28, g: 31, b: 38, alpha: 1 };

/** Wide wordmarks get less padding so they don't shrink to a sliver; square marks get more. */
function innerSize(width: number, height: number) {
  const aspect = Math.max(width, height) / Math.min(width, height);
  return Math.round(SIZE * (aspect > 2.2 ? 0.9 : aspect > 1.4 ? 0.84 : 0.76));
}

/**
 * Turns a raw logo into a square PNG tile: margins trimmed, the mark centred with even padding,
 * and a background chosen for contrast (dark for white marks). Logos that are opaque blocks with
 * their own background colour fill the whole tile.
 */
export async function normalizeLogo(input: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const at = (x: number, y: number) => (y * width + x) * 4;
    const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)].map((i) => [data[i], data[i + 1], data[i + 2], data[i + 3]]);
    const [cr, cg, cb, ca] = corners[0];
    const cornersMatch = corners.every(([r, g, b, a]) => Math.abs(r - cr) + Math.abs(g - cg) + Math.abs(b - cb) < 30 && Math.abs(a - ca) < 30);
    const transparentBg = ca < 20;
    const whiteBg = !transparentBg && cornersMatch && cr > 235 && cg > 235 && cb > 235;
    // Any other opaque image is a mark on its own background colour (e.g. white letters on navy, or a dark gradient).
    const solidBg = !transparentBg && !whiteBg;

    if (solidBg) {
      const average = (channel: number) => Math.round(corners.reduce((total, corner) => total + corner[channel], 0) / corners.length);
      const fill = { r: average(0), g: average(1), b: average(2), alpha: 1 };
      const trimmed = await sharp(input).trim({ threshold: 40, background: fill }).toBuffer({ resolveWithObject: true }).catch(() => null);
      // Only zoom in when trimming found a clearly smaller mark; otherwise keep the whole image.
      const small = trimmed && trimmed.info.width * trimmed.info.height < width * height * 0.6;
      const source = small ? trimmed.data : Buffer.from(input);
      const w = small ? trimmed.info.width : width;
      const h = small ? trimmed.info.height : height;
      const inner = small ? innerSize(w, h) : SIZE;
      const mark = await sharp(source).resize(inner, inner, { fit: 'contain', background: fill }).flatten({ background: fill }).toBuffer();
      return new Uint8Array(
        await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: fill } }).composite([{ input: mark, gravity: 'center' }]).flatten({ background: fill }).png().toBuffer(),
      );
    }

    // Brightness of the visible mark decides the tile colour.
    let lum = 0;
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      const isBg = transparentBg ? a < 0.08 : data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
      if (isBg) continue;
      lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * a;
      weight += a;
    }
    if (weight === 0) return null;
    const background = transparentBg && lum / weight > 200 ? DARK_TILE : LIGHT_TILE;

    const pipeline = whiteBg ? sharp(input).flatten({ background: '#ffffff' }).trim({ threshold: 12, background: '#ffffff' }) : sharp(input).trim({ threshold: 12 });
    const trimmed = await pipeline
      .toBuffer({ resolveWithObject: true })
      .catch(() => null);
    const source = trimmed?.data ?? Buffer.from(input);
    const w = trimmed?.info.width ?? width;
    const h = trimmed?.info.height ?? height;
    const inner = innerSize(w, h);
    const mark = await sharp(source).resize(inner, inner, { fit: 'inside' }).toBuffer();
    return new Uint8Array(
      await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background } })
        .composite([{ input: mark, gravity: 'center' }])
        .flatten({ background })
        .png()
        .toBuffer(),
    );
  } catch {
    return null;
  }
}

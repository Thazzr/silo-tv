// Silo sends a ThumbHash (https://evanw.github.io/thumbhash/) with its artwork. A card that is
// still loading only needs the picture's average colour, which sits in the first three bytes of
// the hash, so the cheap read (`thumbhashColor`) serves every card. The full decode
// (`thumbhashToBitmap`, our own implementation of the published algorithm) is used only for
// spoiler protection, where a card must show a blurred stand-in instead of the real picture.

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** The average colour of a base64 ThumbHash as `rgb(r, g, b)`, or null when it cannot be read. */
export function thumbhashColor(hash: string | undefined): string | null {
  if (!hash) return null;
  let bytes: string;
  try {
    bytes = atob(hash);
  } catch {
    return null;
  }
  if (bytes.length < 5) return null;
  const header = bytes.charCodeAt(0) | (bytes.charCodeAt(1) << 8) | (bytes.charCodeAt(2) << 16);
  // Luminance and the two chroma axes of the hash's DC term (the picture's average).
  const l = (header & 63) / 63;
  const p = ((header >> 6) & 63) / 31.5 - 1;
  const q = ((header >> 12) & 63) / 31.5 - 1;
  const b = l - (2 / 3) * p;
  const r = (3 * l - b + q) / 2;
  const g = r - q;
  const channel = (v: number) => Math.round(clamp(v) * 255);
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

/** The decoded picture of a ThumbHash: `rgba` holds width x height pixels, four bytes each. */
export interface ThumbhashBitmap {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** The longer side of a decoded preview; a ThumbHash only carries a few frequencies anyway. */
const PREVIEW_SIDE = 32;

function hashBytes(hash: string): number[] | null {
  let raw: string;
  try {
    raw = atob(hash);
  } catch {
    return null;
  }
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i += 1) bytes.push(raw.charCodeAt(i));
  return bytes;
}

/**
 * Decodes a base64 ThumbHash into a small bitmap (the longer side is 32 px), or null when the hash
 * cannot be read. The hash stores a few low-frequency cosine terms of the picture's luminance and
 * its two chroma axes; summing them back per pixel gives a soft blur of the original that cannot
 * be read as the picture. Opacity is not decoded: the result is always opaque.
 */
export function thumbhashToBitmap(hash: string | undefined): ThumbhashBitmap | null {
  if (!hash) return null;
  const bytes = hashBytes(hash);
  if (!bytes || bytes.length < 5) return null;

  const header24 = bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16);
  const header16 = bytes[3]! | (bytes[4]! << 8);
  const lDc = (header24 & 63) / 63;
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = header24 >> 23 !== 0;
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const landscape = header16 >> 15 !== 0;
  const lx = Math.max(3, landscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = Math.max(3, landscape ? header16 & 7 : hasAlpha ? 5 : 7);

  // The coefficients are packed two to a byte, after the header (and the alpha byte, if any).
  const acStart = hasAlpha ? 6 : 5;
  let nibble = 0;
  const channel = (nx: number, ny: number, scale: number): number[] => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy += 1) {
      for (let cx = cy === 0 ? 1 : 0; cx * ny < nx * (ny - cy); cx += 1) {
        const byte = bytes[acStart + (nibble >> 1)] ?? 0;
        const value = (byte >> ((nibble & 1) << 2)) & 15;
        nibble += 1;
        ac.push((value / 7.5 - 1) * scale);
      }
    }
    return ac;
  };
  const lAc = channel(lx, ly, lScale);
  // Chroma is boosted a little: quantisation flattens it.
  const pAc = channel(3, 3, pScale * 1.25);
  const qAc = channel(3, 3, qScale * 1.25);
  if (acStart + Math.ceil(nibble / 2) > bytes.length) return null;

  const ratio = lx / ly;
  const width = Math.max(1, Math.round(ratio > 1 ? PREVIEW_SIDE : PREVIEW_SIDE * ratio));
  const height = Math.max(1, Math.round(ratio > 1 ? PREVIEW_SIDE / ratio : PREVIEW_SIDE));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const fx: number[] = [];
  const fy: number[] = [];
  const to255 = (v: number) => Math.round(clamp(v) * 255);

  for (let y = 0, i = 0; y < height; y += 1) {
    for (let cy = 0; cy < ly; cy += 1) fy[cy] = Math.cos((Math.PI / height) * (y + 0.5) * cy);
    for (let x = 0; x < width; x += 1, i += 4) {
      for (let cx = 0; cx < Math.max(lx, 3); cx += 1) {
        fx[cx] = Math.cos((Math.PI / width) * (x + 0.5) * cx);
      }
      let l = lDc;
      let p = pDc;
      let q = qDc;
      for (let cy = 0, j = 0; cy < ly; cy += 1) {
        const fy2 = fy[cy]! * 2;
        for (let cx = cy === 0 ? 1 : 0; cx * ly < lx * (ly - cy); cx += 1, j += 1) {
          l += lAc[j]! * fx[cx]! * fy2;
        }
      }
      for (let cy = 0, j = 0; cy < 3; cy += 1) {
        const fy2 = fy[cy]! * 2;
        for (let cx = cy === 0 ? 1 : 0; cx < 3 - cy; cx += 1, j += 1) {
          const f = fx[cx]! * fy2;
          p += pAc[j]! * f;
          q += qAc[j]! * f;
        }
      }
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = to255(r);
      rgba[i + 1] = to255(g);
      rgba[i + 2] = to255(b);
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** A map that forgets its oldest entry once it holds more than `max`. */
export class BoundedCache<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly max: number) {}

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  get(key: string): V | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}

const PREVIEW_CACHE_SIZE = 200;
/** A failed decode is remembered too (as null), so a card does not retry it on every draw. */
const previews = new BoundedCache<string | null>(PREVIEW_CACHE_SIZE);

/**
 * The blurred stand-in of a picture as a `data:` URL: the decoded ThumbHash drawn once on a tiny
 * canvas. Shown scaled up, the browser's own smoothing does the blurring, so the card needs no
 * CSS filter. Null when the hash cannot be read or there is no canvas. Cached per hash.
 */
export function thumbhashPreview(hash: string | undefined): string | null {
  if (!hash) return null;
  const cached = previews.get(hash);
  if (cached !== undefined) return cached;
  let url: string | null = null;
  const bitmap = thumbhashToBitmap(hash);
  if (bitmap) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (context) {
        const data = context.createImageData(bitmap.width, bitmap.height);
        data.data.set(bitmap.rgba);
        context.putImageData(data, 0, 0);
        url = canvas.toDataURL('image/png') || null;
      }
    } catch {
      url = null;
    }
  }
  previews.set(hash, url);
  return url;
}

/** Test hook: forgets every cached preview. */
export function clearThumbhashPreviews(): void {
  previews.clear();
}

// Builders for ThumbHash test vectors and a canvas for jsdom (which has none).
import { vi } from 'vitest';
import { clearThumbhashPreviews } from '../ui/media/thumbhash';

export interface HashParts {
  /** Average luminance and the two chroma axes, 0 to 63. */
  l?: number;
  p?: number;
  q?: number;
  /** Strength of the luminance coefficients, 0 to 31; the chroma scales, 0 to 63. */
  lScale?: number;
  pScale?: number;
  qScale?: number;
  landscape?: boolean;
  /** The short side's coefficient count (3 to 7); the long side is 7. */
  count?: number;
  /** The first coefficients, as nibbles from 0 to 15 (7.5 is zero); the rest are 0. */
  ac?: number[];
}

/** A base64 ThumbHash with the given parts, padded with zero coefficients. */
export function makeHash(parts: HashParts = {}): string {
  const { l = 32, p = 32, q = 32, lScale = 0, pScale = 0, qScale = 0 } = parts;
  const header24 = l | (p << 6) | (q << 12) | (lScale << 18);
  const header16 =
    (parts.count ?? 3) | (pScale << 3) | (qScale << 9) | (parts.landscape ? 1 << 15 : 0);
  const nibbles = [...(parts.ac ?? []), ...new Array<number>(48).fill(0)].slice(0, 48);
  const bytes = [header24 & 255, (header24 >> 8) & 255, (header24 >> 16) & 255];
  bytes.push(header16 & 255, (header16 >> 8) & 255);
  for (let i = 0; i < nibbles.length; i += 2) bytes.push(nibbles[i]! | (nibbles[i + 1]! << 4));
  return btoa(String.fromCharCode(...bytes));
}

/** A portrait hash (3 x 7 coefficients), which decodes to a 14 x 32 bitmap. */
export const PORTRAIT_HASH = makeHash({ l: 40, count: 3 });

/**
 * Gives jsdom a canvas that records what is drawn and answers `toDataURL` with
 * `data:image/png;base64,<width>x<height>`. Call in `beforeEach`; the returned spy counts encodes.
 */
export function stubCanvas() {
  clearThumbhashPreviews();
  const context = {
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    putImageData: () => undefined,
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);
  return vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return `data:image/png;base64,${this.width}x${this.height}`;
  });
}

// Pure helpers for the server's branding: where its images live and whether its accent colour is
// readable. No React and no requests in here.

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Contrast the accent needs against the black page (WCAG AA for normal text). */
export const MIN_ACCENT_CONTRAST = 4.5;

function parseHex(color: string): [number, number, number] | null {
  const match = HEX_COLOR.exec(color.trim());
  if (!match) return null;
  let digits = match[1]!;
  if (digits.length === 3) digits = digits.replace(/./g, (c) => c + c);
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of `#rgb` / `#rrggbb`, or null for anything else. */
export function luminance(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** Contrast ratio of a colour against pure black, or null when it is not a hex colour. */
export function contrastOnBlack(color: string): number | null {
  const l = luminance(color);
  return l === null ? null : (l + 0.05) / 0.05;
}

/** The accent when it keeps 4.5:1 on the black page, else null: a dim accent is ignored. */
export function usableAccent(color: string | undefined): string | null {
  if (!color) return null;
  const ratio = contrastOnBlack(color);
  return ratio !== null && ratio >= MIN_ACCENT_CONTRAST ? color.trim() : null;
}

/**
 * Resolves an image reference of the branding document against the server origin. The reference
 * is otherwise opaque (its query carries a version); only http(s) results are accepted, so a
 * `data:` or `javascript:` reference never reaches an element.
 */
export function resolveAssetUrl(origin: string, reference: string | undefined): string | null {
  if (!reference || !reference.trim()) return null;
  try {
    const url = new URL(reference.trim(), `${origin}/`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The host of a server origin, for the name shown when the server has none. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** First letter of a name, upper case, for the initial badges. */
export function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

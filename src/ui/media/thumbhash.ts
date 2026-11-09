// Silo sends a ThumbHash (https://evanw.github.io/thumbhash/) with its artwork. The placeholder
// of a card that is still loading only needs the picture's average colour, which sits in the first
// three bytes of the hash, so the full decode (a canvas per card) is not worth its cost on a TV.

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

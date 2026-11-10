import type { CSSProperties } from 'react';
import type { SubtitleAppearance } from '../../features/settings/profileSettings';

/**
 * Font size per profile size, in CSS pixels on the 1080p layout (the app scales as a whole to
 * 720p). Small is the smallest comfortably readable size at TV distance.
 */
export const FONT_SIZES_PX: Record<SubtitleAppearance['fontSize'], number> = {
  small: 36,
  medium: 44,
  large: 52,
  xlarge: 62,
  xxlarge: 72,
};

/** How far the block rises while the controls are open: above their dark band (45 vh). */
export const LIFT = 'translateY(-46vh)';

/** `#rrggbb` and a percentage as an `rgba()` colour. */
export function rgba(hex: string, percent: number): string {
  const n = parseInt(hex.slice(1), 16);
  const alpha = Math.max(0, Math.min(100, percent)) / 100;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Eight directions around the glyph: a static outline that looks the same on every Chromium the
// app supports, unlike -webkit-text-stroke, which eats into the glyph.
const RING: readonly (readonly [number, number])[] = [
  [-2, 0],
  [2, 0],
  [0, -2],
  [0, 2],
  [-2, -2],
  [2, -2],
  [-2, 2],
  [2, 2],
];

function ring(color: string): string[] {
  return RING.map(([x, y]) => `${x}px ${y}px 0 ${color}`);
}

export interface SubtitleStyles {
  /** The positioned block; its lines are centred and at most about 80 % of the screen wide. */
  block: CSSProperties;
  /** One subtitle line. */
  line: CSSProperties;
}

export function subtitleStyles(appearance: SubtitleAppearance, lifted: boolean): SubtitleStyles {
  const effect = rgba(appearance.backgroundColor, appearance.backgroundOpacity);
  const shadows: string[] = [];
  if (appearance.backgroundStyle === 'shadow') {
    shadows.push(`0 3px 8px ${effect}`, `0 0 4px ${effect}`);
  } else if (appearance.backgroundStyle === 'outline') {
    shadows.push(...ring(effect));
  }
  if (appearance.textOutline) shadows.push(...ring(appearance.textOutlineColor));

  const line: CSSProperties = {
    fontFamily: `${appearance.fontFamily}, sans-serif`,
    fontSize: `${FONT_SIZES_PX[appearance.fontSize]}px`,
    color: rgba(appearance.fontColor, appearance.textOpacity),
    textShadow: shadows.length > 0 ? shadows.join(', ') : 'none',
    backgroundColor: appearance.backgroundStyle === 'box' ? effect : 'transparent',
  };

  const block: CSSProperties = {};
  if (appearance.position === 'top') block.top = 'var(--safe-y)';
  else if (appearance.position === 'lower-third') block.bottom = '22vh';
  else block.bottom = 'var(--safe-y)';
  // Only the bottom positions can collide with the controls.
  if (lifted && appearance.position !== 'top') block.transform = LIFT;
  return { block, line };
}

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

/**
 * The resting gap between the subtitles and the screen's edge, as a fraction of the screen's
 * height. These are the web player's offsets; each is above the TV's 5 % safe area.
 */
export const RESTING_GAP: Record<SubtitleAppearance['position'], number> = {
  bottom: 0.07,
  'lower-third': 0.12,
  top: 0.07,
};

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

/** A length in CSS pixels at the given scale, rounded so a scaled value stays free of float noise. */
function px(value: number, scale: number): string {
  return `${Math.round(value * scale * 100) / 100}px`;
}

function ring(color: string, scale: number): string[] {
  return RING.map(([x, y]) => `${px(x, scale)} ${px(y, scale)} 0 ${color}`);
}

/**
 * A box the subtitles are drawn into instead of the screen (the appearance preview), in CSS
 * pixels. Sizes and offsets scale with its height against the 1080p layout, and the positions
 * are measured in the box, not in `vh` or the screen's safe area.
 */
export interface SubtitleFrame {
  width: number;
  height: number;
}

export interface SubtitleStyles {
  /** The positioned block; its lines are centred and at most about 80 % of the screen wide. */
  block: CSSProperties;
  /** One subtitle line. */
  line: CSSProperties;
}

export function subtitleStyles(
  appearance: SubtitleAppearance,
  /** How far the block rises above its position, in CSS pixels (see `measureLift`). */
  lift: number,
  frame?: SubtitleFrame,
): SubtitleStyles {
  const scale = frame ? frame.height / 1080 : 1;
  const effect = rgba(appearance.backgroundColor, appearance.backgroundOpacity);
  const shadows: string[] = [];
  if (appearance.backgroundStyle === 'shadow') {
    shadows.push(`0 ${px(3, scale)} ${px(8, scale)} ${effect}`, `0 0 ${px(4, scale)} ${effect}`);
  } else if (appearance.backgroundStyle === 'outline') {
    shadows.push(...ring(effect, scale));
  }
  if (appearance.textOutline) shadows.push(...ring(appearance.textOutlineColor, scale));

  const line: CSSProperties = {
    fontFamily: `${appearance.fontFamily}, sans-serif`,
    fontSize: px(FONT_SIZES_PX[appearance.fontSize], scale),
    color: rgba(appearance.fontColor, appearance.textOpacity),
    textShadow: shadows.length > 0 ? shadows.join(', ') : 'none',
    backgroundColor: appearance.backgroundStyle === 'box' ? effect : 'transparent',
  };
  // The line's padding comes from the stylesheet on screen; a frame scales it with the rest.
  if (frame) line.padding = `${px(2, scale)} ${px(14, scale)}`;

  const block: CSSProperties = {};
  const gap = RESTING_GAP[appearance.position];
  const edge = appearance.position === 'top' ? 'top' : 'bottom';
  block[edge] = frame ? px(frame.height * gap, 1) : `${Math.round(gap * 10000) / 100}vh`;
  if (lift > 0) block.transform = `translateY(-${px(lift, 1)})`;
  return { block, line };
}

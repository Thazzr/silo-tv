import type { MessageKey } from '../../i18n';
import type { SubtitleAppearance } from './profileSettings';

type Look = SubtitleAppearance;

/** One stop of a row: the stored value and the text that names it. */
export interface Stop<V> {
  value: V;
  text: MessageKey;
}

// The choices and their order are Silo's web client's (the appearance dialog), so a viewer finds
// the same ones on every device.

export const SIZES: readonly Stop<Look['fontSize']>[] = [
  { value: 'small', text: 'settings.subtitles.size.small' },
  { value: 'medium', text: 'settings.subtitles.size.medium' },
  { value: 'large', text: 'settings.subtitles.size.large' },
  { value: 'xlarge', text: 'settings.subtitles.size.xlarge' },
  { value: 'xxlarge', text: 'settings.subtitles.size.xxlarge' },
];

export const FONTS: readonly Stop<string>[] = [
  { value: 'sans-serif', text: 'settings.subtitles.font.sans' },
  { value: 'serif', text: 'settings.subtitles.font.serif' },
  { value: 'monospace', text: 'settings.subtitles.font.mono' },
];

export const FONT_COLORS: readonly Stop<string>[] = [
  { value: '#ffffff', text: 'settings.subtitles.color.white' },
  { value: '#facc15', text: 'settings.subtitles.color.yellow' },
  { value: '#22c55e', text: 'settings.subtitles.color.green' },
  { value: '#06b6d4', text: 'settings.subtitles.color.cyan' },
  { value: '#d946ef', text: 'settings.subtitles.color.magenta' },
  { value: '#ef4444', text: 'settings.subtitles.color.red' },
  { value: '#3b82f6', text: 'settings.subtitles.color.blue' },
  { value: '#9ca3af', text: 'settings.subtitles.color.gray' },
  { value: '#000000', text: 'settings.subtitles.color.black' },
];

export const BACKGROUND_COLORS: readonly Stop<string>[] = [
  { value: '#000000', text: 'settings.subtitles.color.black' },
  { value: '#374151', text: 'settings.subtitles.color.darkGray' },
  { value: '#1e3a5f', text: 'settings.subtitles.color.navy' },
  { value: '#7f1d1d', text: 'settings.subtitles.color.darkRed' },
  { value: '#14532d', text: 'settings.subtitles.color.darkGreen' },
];

export const STYLES: readonly Stop<Look['backgroundStyle']>[] = [
  { value: 'box', text: 'settings.subtitles.style.box' },
  { value: 'shadow', text: 'settings.subtitles.style.shadow' },
  { value: 'outline', text: 'settings.subtitles.style.outline' },
  { value: 'none', text: 'settings.subtitles.style.none' },
];

export const POSITIONS: readonly Stop<Look['position']>[] = [
  { value: 'bottom', text: 'settings.subtitles.position.bottom' },
  { value: 'lower-third', text: 'settings.subtitles.position.lowerThird' },
  { value: 'top', text: 'settings.subtitles.position.top' },
];

/** What one press of Left or Right changes an opacity by, in percent. */
export const OPACITY_STEP = 5;
/** The contract's bounds: the text must stay visible, the background may vanish. */
export const TEXT_OPACITY_RANGE = { min: 1, max: 100 } as const;
export const BACKGROUND_OPACITY_RANGE = { min: 0, max: 100 } as const;

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The name of a stop, or the stored value itself when it is none of the stops. */
export function stopText<V>(stops: readonly Stop<V>[], value: V, t: Translate): string {
  const stop = stops.find((candidate) => candidate.value === value);
  return stop ? t(stop.text) : String(value);
}

/** "Large · White · Box": size, text colour and background style in one line. */
export function summarizeAppearance(look: Look, t: Translate): string {
  return [
    stopText(SIZES, look.fontSize, t),
    stopText(FONT_COLORS, look.fontColor, t),
    stopText(STYLES, look.backgroundStyle, t),
  ].join(' · ');
}

/**
 * The stop one step from `current`; the ends hold. A current value that is none of the stops
 * (stored by another client) goes to the first stop on a step forward and to the last on a step
 * back.
 */
export function stepValue<V>(values: readonly V[], current: V, direction: 1 | -1): V {
  const at = values.indexOf(current);
  if (at < 0) return direction === 1 ? values[0]! : values[values.length - 1]!;
  return values[Math.max(0, Math.min(values.length - 1, at + direction))]!;
}

/** An opacity one step on, held inside its range; a step always lands on a multiple of the step. */
export function stepOpacity(
  current: number,
  direction: 1 | -1,
  range: { min: number; max: number },
): number {
  const aligned =
    direction === 1
      ? Math.floor(current / OPACITY_STEP) + 1
      : Math.ceil(current / OPACITY_STEP) - 1;
  return Math.max(range.min, Math.min(range.max, aligned * OPACITY_STEP));
}

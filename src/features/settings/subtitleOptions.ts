import type { MessageKey } from '../../i18n';
import type { SubtitleAppearance } from './profileSettings';

type Look = SubtitleAppearance;

/** One stop of a row: the stored value and the text that names it. */
export interface Stop<V> {
  value: V;
  text: MessageKey;
}

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

export const COLORS: readonly Stop<string>[] = [
  { value: '#ffffff', text: 'settings.subtitles.color.white' },
  { value: '#ffff00', text: 'settings.subtitles.color.yellow' },
  { value: '#00ffff', text: 'settings.subtitles.color.cyan' },
  { value: '#00ff00', text: 'settings.subtitles.color.green' },
  { value: '#ff00ff', text: 'settings.subtitles.color.magenta' },
  { value: '#ff0000', text: 'settings.subtitles.color.red' },
  { value: '#0000ff', text: 'settings.subtitles.color.blue' },
  { value: '#000000', text: 'settings.subtitles.color.black' },
  { value: '#808080', text: 'settings.subtitles.color.gray' },
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

export const TEXT_OPACITIES: readonly number[] = [25, 50, 75, 100];
export const BACKGROUND_OPACITIES: readonly number[] = [0, 25, 50, 75, 100];

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
    stopText(COLORS, look.fontColor, t),
    stopText(STYLES, look.backgroundStyle, t),
  ].join(' · ');
}

/**
 * The stop one step from `current` in a list that wraps around. A current value that is none of
 * the stops (stored by another client) goes to the first stop on a step forward and to the last
 * on a step back.
 */
export function stepValue<V>(values: readonly V[], current: V, direction: 1 | -1): V {
  const at = values.indexOf(current);
  if (at < 0) return direction === 1 ? values[0]! : values[values.length - 1]!;
  return values[(at + direction + values.length) % values.length]!;
}

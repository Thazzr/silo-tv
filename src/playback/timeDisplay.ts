import type { Language } from '../i18n/translate';
import { getPlatform, type KeyValueStore } from '../platform';
import { formatClock } from './format';

// What the player's clock above the scrubber says. A choice for this TV, kept like `resumeRewind`:
// never read from or sent to a server.
export const TIME_MODES = ['combined', 'position', 'remaining', 'endsAt'] as const;
export type TimeMode = (typeof TIME_MODES)[number];
export const TIME_MODE_DEFAULT: TimeMode = 'combined';

/** The profile setting `ui.time_format`. `auto` follows the app language: German 24 h, English 12 h. */
export type TimeFormat = 'auto' | '12h' | '24h';

const STORAGE_KEY = 'silo-tv.settings.timeDisplay';

/** The stored mode, or Combined when it is missing, unknown or storage fails. */
export function getTimeMode(store: KeyValueStore = getPlatform().storage): TimeMode {
  try {
    const raw = store.get(STORAGE_KEY);
    return TIME_MODES.find((mode) => mode === raw) ?? TIME_MODE_DEFAULT;
  } catch {
    return TIME_MODE_DEFAULT;
  }
}

export function setTimeMode(mode: TimeMode, store: KeyValueStore = getPlatform().storage): void {
  try {
    store.set(STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable; the setting then simply does not stick.
  }
}

const two = (n: number) => String(n).padStart(2, '0');

/** "15:26" or "3:26 PM" for a wall-clock moment. */
export function formatWallClock(date: Date, format: TimeFormat, lang: Language): string {
  const twelve = format === '12h' || (format === 'auto' && lang === 'en');
  if (!twelve) return `${two(date.getHours())}:${two(date.getMinutes())}`;
  const hours = date.getHours() % 12 || 12;
  return `${hours}:${two(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** The pieces of the clock for a position; a piece is null when the mode or the data lacks it. */
export interface TimeParts {
  position: string | null;
  total: string | null;
  /** "−11:20" with the true minus sign. */
  remaining: string | null;
  /** The wall-clock time the title ends at. */
  endsAt: string | null;
}

export function timeParts(
  mode: TimeMode,
  position: number,
  duration: number,
  nowMs: number,
  format: TimeFormat,
  lang: Language,
): TimeParts {
  const known = duration > 0;
  const left = Math.max(0, duration - position);
  return {
    position: mode === 'combined' || mode === 'position' ? formatClock(position) : null,
    total: mode === 'combined' || mode === 'position' ? formatClock(duration) : null,
    remaining: mode === 'remaining' && known ? `−${formatClock(left)}` : null,
    endsAt:
      (mode === 'combined' || mode === 'endsAt') && known
        ? formatWallClock(new Date(nowMs + left * 1000), format, lang)
        : null,
  };
}

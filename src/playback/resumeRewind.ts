import { getPlatform, type KeyValueStore } from '../platform';

// Silo's settings contract names this `player.resume_rewind_seconds` (client_local, integer 0-30,
// default 7, 0 turns it off). It is one value for this TV: never read from or sent to a server.
export const REWIND_DEFAULT_SECONDS = 7;
export const REWIND_MAX_SECONDS = 30;
/** What the settings screen offers; any other stored value in range still applies. */
export const REWIND_CHOICES = [0, 5, 7, 10, 15, 20, 30] as const;

const STORAGE_KEY = 'silo-tv.settings.resumeRewindSeconds';

function readRaw(store: KeyValueStore): string | null {
  try {
    return store.get(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The stored rewind, or 7 when it is missing or not an integer from 0 to 30. */
export function getResumeRewind(store: KeyValueStore = getPlatform().storage): number {
  const raw = readRaw(store);
  if (raw === null || !/^\d{1,2}$/.test(raw)) return REWIND_DEFAULT_SECONDS;
  const value = Number(raw);
  return value >= 0 && value <= REWIND_MAX_SECONDS ? value : REWIND_DEFAULT_SECONDS;
}

export function setResumeRewind(seconds: number, store: KeyValueStore = getPlatform().storage) {
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > REWIND_MAX_SECONDS) return;
  try {
    store.set(STORAGE_KEY, String(seconds));
  } catch {
    // Storage can be unavailable; the setting then simply does not stick.
  }
}

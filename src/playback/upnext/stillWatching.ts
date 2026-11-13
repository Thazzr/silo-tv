import { getPlatform, type KeyValueStore } from '../../platform';

// Silo's settings contract names this `player.passout_threshold` (client_local, integer 0-20,
// default 3, 0 never asks): how many episodes start by themselves in a row before the next one
// waits for the viewer. It is one value for this TV, never read from or sent to a server.
export const STILL_WATCHING_DEFAULT = 3;
export const STILL_WATCHING_MAX = 20;
/** What the settings screen offers; any other stored value in range still applies. */
export const STILL_WATCHING_CHOICES = [0, 1, 2, 3, 5, 10, 20] as const;

const STORAGE_KEY = 'silo-tv.settings.stillWatchingThreshold';

/**
 * The automatic advances in a row in this app session. It lives in memory: it describes this one
 * session, which nothing else can observe. Any start the viewer makes clears it.
 */
let automaticStarts = 0;

export function recordAutoAdvance(): void {
  automaticStarts += 1;
}

export function resetStillWatchingStreak(): void {
  automaticStarts = 0;
}

function readRaw(store: KeyValueStore): string | null {
  try {
    return store.get(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The stored threshold, or 3 when it is missing or not an integer from 0 to 20. */
export function getStillWatchingThreshold(store: KeyValueStore = getPlatform().storage): number {
  const raw = readRaw(store);
  if (raw === null || !/^\d{1,2}$/.test(raw)) return STILL_WATCHING_DEFAULT;
  const value = Number(raw);
  return value <= STILL_WATCHING_MAX ? value : STILL_WATCHING_DEFAULT;
}

export function setStillWatchingThreshold(
  threshold: number,
  store: KeyValueStore = getPlatform().storage,
) {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > STILL_WATCHING_MAX) return;
  try {
    store.set(STORAGE_KEY, String(threshold));
  } catch {
    // Storage can be unavailable; the setting then simply does not stick.
  }
}

/** With threshold N, N automatic advances are allowed; the next one waits for the viewer. */
export function isStillWatchingGated(store: KeyValueStore = getPlatform().storage): boolean {
  const threshold = getStillWatchingThreshold(store);
  return threshold > 0 && automaticStarts >= threshold;
}

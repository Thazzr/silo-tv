import { getPlatform, type KeyValueStore } from '../platform';

// The app language the viewer chose for this TV. `auto` follows the TV's own language (see
// `detectLanguage`). Kept on this device only, like `resumeRewind`.
export const LANGUAGE_CHOICES = ['auto', 'de', 'en'] as const;
export type LanguageSetting = (typeof LANGUAGE_CHOICES)[number];

const STORAGE_KEY = 'silo-tv.settings.language';

/** Set when storage refuses a write, so the choice still holds until the app closes. */
let session: LanguageSetting | null = null;
const listeners = new Set<() => void>();

/** The stored choice, or `auto` when it is missing, unknown or storage fails. */
export function getLanguageSetting(store: KeyValueStore = getPlatform().storage): LanguageSetting {
  try {
    const raw = store.get(STORAGE_KEY);
    return LANGUAGE_CHOICES.find((choice) => choice === raw) ?? 'auto';
  } catch {
    return session ?? 'auto';
  }
}

export function setLanguageSetting(
  choice: LanguageSetting,
  store: KeyValueStore = getPlatform().storage,
): void {
  try {
    store.set(STORAGE_KEY, choice);
    session = null;
  } catch {
    // Storage can be unavailable; the choice then lasts until the app closes.
    session = choice;
  }
  for (const listener of [...listeners]) listener();
}

/** For `useSyncExternalStore`: the provider re-renders the whole app when the choice changes. */
export function subscribeLanguageSetting(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

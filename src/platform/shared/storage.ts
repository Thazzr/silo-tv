import type { KeyValueStore } from '../types';

/**
 * A key-value store over a web Storage that never throws: a missing, blocked or full storage
 * reads as "nothing stored" and drops writes, so the app still works for this page load.
 * The backing storage is looked up per call because even touching `localStorage` can throw.
 */
export function createKeyValueStore(backing: () => Storage | null | undefined): KeyValueStore {
  return {
    get(key) {
      try {
        return backing()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        backing()?.setItem(key, value);
      } catch {
        // Storage full or blocked.
      }
    },
    remove(key) {
      try {
        backing()?.removeItem(key);
      } catch {
        // Storage blocked.
      }
    },
  };
}

export const localKeyValueStore: KeyValueStore = createKeyValueStore(() => localStorage);

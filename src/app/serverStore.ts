import { getPlatform, type KeyValueStore } from '../platform';

// Bump when the stored shape changes.
const STORAGE_KEY = 'silo-tv.server.v1';

/** The origin of the server the user connected to last, or null. */
export function loadServer(storage: KeyValueStore | null = getPlatform().storage): string | null {
  return storage?.get(STORAGE_KEY) || null;
}

export function saveServer(
  origin: string,
  storage: KeyValueStore | null = getPlatform().storage,
): void {
  // The store drops the write when storage is full or blocked: the choice then only lasts for
  // this page load.
  storage?.set(STORAGE_KEY, origin);
}

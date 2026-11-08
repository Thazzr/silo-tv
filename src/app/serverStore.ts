// Bump when the stored shape changes.
const STORAGE_KEY = 'silo-tv.server.v1';

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** The origin of the server the user connected to last, or null. */
export function loadServer(storage: Storage | null = safeStorage()): string | null {
  try {
    return storage?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function saveServer(origin: string, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, origin);
  } catch {
    // Storage full or blocked: the choice only lasts for this page load.
  }
}

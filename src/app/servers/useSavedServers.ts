import { useSyncExternalStore } from 'react';
import type { SavedServer, ServerRegistry } from './registry';

/** The registry's list (current server first), re-read whenever it changes. */
export function useSavedServers(registry: ServerRegistry): SavedServer[] {
  return useSyncExternalStore(registry.subscribe, () => registry.list());
}

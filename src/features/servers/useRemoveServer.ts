import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSiloClient } from '../../api/client';
import type { DeviceIdentity } from '../../api/deviceIdentity';
import { currentTransport } from '../../api/transport';
import type { ServerRegistry } from '../../app/servers';

// A server that does not answer must not keep the dialog open for long.
const LOGOUT_TIMEOUT_MS = 5000;

/**
 * Removes a server: ends the session on the server when there is one (best effort, the answer
 * does not matter), then deletes the local session and the entry, and drops the cached data of
 * that server.
 */
export function useRemoveServer(registry: ServerRegistry, device: DeviceIdentity) {
  const queryClient = useQueryClient();
  return useCallback(
    async (origin: string): Promise<void> => {
      if (registry.hasSession(origin)) {
        const client = createSiloClient({
          baseUrl: origin,
          transport: currentTransport,
          session: registry.session(origin),
          device,
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            client.POST('/api/v2/auth/logout'),
            new Promise((resolve) => {
              timer = setTimeout(resolve, LOGOUT_TIMEOUT_MS);
            }),
          ]);
        } catch {
          // Unreachable server: the tokens are forgotten here, which is all that can be done.
        } finally {
          clearTimeout(timer);
        }
      }
      registry.remove(origin);
      queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(origin) });
    },
    [registry, device, queryClient],
  );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Navigator } from '../app/nav';
import { SiloProvider } from '../app/SiloContext';
import type { DeviceIdentity } from '../api/deviceIdentity';
import { Session } from '../api/session';
import type { KeyValueStore } from '../platform';
import { I18nProvider } from '../i18n';
import { BASE_URL } from './apiFixtures';

export const testDevice: DeviceIdentity = { id: 'a'.repeat(32), name: 'LG webOS TV' };

export function memoryStorage(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}

export function newQueryClient(): QueryClient {
  // No retries and no cache time: a failing request must show its error state right away.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
}

/**
 * Renders a screen with i18n (English), React Query and a Silo client for the test server, as the
 * only (root) entry of a screen stack: Back on it opens the exit popup unless the screen handles it.
 */
export function renderWithSilo(
  ui: ReactNode,
  options: { session?: Session; queryClient?: QueryClient; lang?: 'de' | 'en' } = {},
) {
  const session = options.session ?? new Session(memoryStorage());
  const queryClient = options.queryClient ?? newQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider lang={options.lang ?? 'en'}>
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator initial={null} renderScreen={() => ui} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, session, queryClient };
}

/** Same without a Silo client, for the server screen and the app root. */
export function renderApp(ui: ReactNode) {
  const queryClient = newQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider lang="en">{ui}</I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

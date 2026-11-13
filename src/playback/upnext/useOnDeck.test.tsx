// The On Deck read on its own: what it hands the row must keep its identity while the data stays
// the same, or the row redraws its cards on every tick of the end screen's countdown.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Session } from '../../api/session';
import { SiloProvider } from '../../app/SiloContext';
import { BASE_URL, account } from '../../test/apiFixtures';
import { onDeckEpisode, serveOnDeck } from '../../test/onDeckFixtures';
import { memoryStorage, testDevice } from '../../test/renderFlow';
import { useOnDeck } from './useOnDeck';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useOnDeck', () => {
  it('keeps the same items array across a re-render with unchanged data', async () => {
    serveOnDeck(server, {
      entries: [onDeckEpisode('x1'), onDeckEpisode('x2')],
    });
    const session = new Session(memoryStorage());
    session.set({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      user: account,
      profileId: 'p1',
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          {children}
        </SiloProvider>
      </QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useOnDeck(undefined), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    const settled = result.current.items;
    rerender();
    expect(result.current.items).toBe(settled);
  });
});

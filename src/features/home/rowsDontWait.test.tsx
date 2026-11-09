import { QueryClient } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import {
  homeCapabilities,
  homeSection,
  primeHomeCapabilities,
  serveHome,
} from '../../test/homeFixtures';
import { serveLibrary } from '../../test/libraryFixtures';
import { memoryStorage, newQueryClient, renderWithSilo } from '../../test/renderFlow';
import { FocusIndexMemory } from '../../ui/media';
import { LibraryScreen } from '../library/LibraryScreen';
import { LibraryMemory } from '../library/libraryMemory';
import { HomeScreen } from './HomeScreen';

// The rows must never wait for the home capabilities: that read can take 20 s or never answer.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const CAPABILITIES_KEY = ['home', 'capabilities', BASE_URL];

function signedIn() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return session;
}

/** The production cache time (5 minutes), not the test default of none. */
const productionClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

/** Replaces the capabilities answer with one the test releases (or never releases) by hand. */
function holdCapabilities() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  server.use(
    http.get(`${BASE_URL}/api/v2/home/capabilities`, async () => {
      reads += 1;
      await gate;
      return HttpResponse.json(homeCapabilities({ section_item_limit_max: 100 }));
    }),
  );
  return { release, reads: () => reads };
}

const home = (queryClient?: QueryClient) =>
  renderWithSilo(
    <HomeScreen
      rowMemory={new FocusIndexMemory()}
      onPlay={vi.fn()}
      onOpenDetail={vi.fn()}
      onExploreSection={vi.fn()}
    />,
    { session: signedIn(), queryClient },
  );

const library = (queryClient?: QueryClient) =>
  renderWithSilo(
    <LibraryScreen
      kind="movie"
      memory={new LibraryMemory()}
      onPlay={vi.fn()}
      onOpenDetail={vi.fn()}
      onExploreSection={vi.fn()}
      onOpenCollection={vi.fn()}
    />,
    { session: signedIn(), queryClient },
  );

describe('Home rows and the home capabilities', () => {
  it('load at once, without item_limit, while the capabilities do not answer', async () => {
    const calls = serveHome(server);
    const held = holdCapabilities();
    home();
    await screen.findByTestId('row-recent');
    expect(held.reads()).toBe(1);
    expect(calls.lists).toHaveLength(1);
    expect(calls.lists[0]!.has('item_limit')).toBe(false);
  });

  it('are neither read again nor hidden when the capabilities answer later', async () => {
    const calls = serveHome(server);
    const held = holdCapabilities();
    const queryClient = productionClient();
    home(queryClient);
    await screen.findByTestId('row-recent');
    await act(async () => {
      held.release();
      await vi.waitFor(() => expect(queryClient.getQueryData(CAPABILITIES_KEY)).toBeDefined());
    });
    expect(calls.lists).toHaveLength(1);
    expect(screen.getByTestId('row-recent')).toBeInTheDocument();
    expect(screen.queryByTestId('row-skeleton')).toBeNull();
  });

  it('use item_limit from capabilities that are already cached', async () => {
    const calls = serveHome(server);
    const queryClient = newQueryClient();
    primeHomeCapabilities(queryClient, homeCapabilities({ section_item_limit_max: 12 }));
    home(queryClient);
    await screen.findByTestId('row-recent');
    expect(calls.lists[0]!.get('item_limit')).toBe('12');
  });

  it('keep the capabilities for the session once nothing shows them any more', async () => {
    const calls = serveHome(server, { sections: [homeSection('recent')] });
    const queryClient = productionClient();
    const first = home(queryClient);
    await screen.findByTestId('row-recent');
    await vi.waitFor(() => expect(queryClient.getQueryData(CAPABILITIES_KEY)).toBeDefined());
    // The cache time starts at unmount, so the fake clock must already run then.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      first.unmount();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    } finally {
      vi.useRealTimers();
    }
    expect(queryClient.getQueryData(CAPABILITIES_KEY)).toBeDefined();
    home(queryClient);
    await screen.findByTestId('row-recent');
    expect(calls.capabilities).toBe(1);
  });
});

describe('Library Recommended rows and the home capabilities', () => {
  it('load at once, without item_limit, while the capabilities do not answer', async () => {
    const calls = serveLibrary(server);
    const held = holdCapabilities();
    library();
    await screen.findByText('Row lib-1-rec');
    expect(held.reads()).toBe(1);
    expect(calls.sections).toHaveLength(1);
    expect(calls.sections[0]!.query.has('item_limit')).toBe(false);
  });

  it('are not requested again when the capabilities answer later', async () => {
    const calls = serveLibrary(server);
    const held = holdCapabilities();
    const queryClient = productionClient();
    library(queryClient);
    await screen.findByText('Row lib-1-rec');
    await act(async () => {
      held.release();
      await vi.waitFor(() => expect(queryClient.getQueryData(CAPABILITIES_KEY)).toBeDefined());
    });
    expect(calls.sections).toHaveLength(1);
    expect(screen.getByText('Row lib-1-rec')).toBeInTheDocument();
  });

  it('use item_limit from capabilities that are already cached', async () => {
    const calls = serveLibrary(server);
    const queryClient = newQueryClient();
    primeHomeCapabilities(queryClient, homeCapabilities({ section_item_limit_max: 100 }));
    library(queryClient);
    await screen.findByText('Row lib-1-rec');
    expect(calls.sections[0]!.query.get('item_limit')).toBe('20');
  });
});

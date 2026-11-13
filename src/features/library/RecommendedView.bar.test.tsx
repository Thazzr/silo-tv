import { act, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { setFocus } from '../../app/nav';
import { BarAwayStore, ShellBarContext } from '../../app/shell/ShellBar';
import { account } from '../../test/apiFixtures';
import { homeSection } from '../../test/homeFixtures';
import { serveLibrary } from '../../test/libraryFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { cardFocusKey } from '../../ui/media';
import { HERO_PLAY_KEY } from '../home/Carousel';
import { LibraryScreen } from './LibraryScreen';
import { LibraryMemory } from './libraryMemory';

// The Recommended view tells the shell's top bar when its content has left the top.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup(sections: ReturnType<typeof homeSection>[]) {
  serveLibrary(server, { sections: { 'lib-1': sections } });
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const store = new BarAwayStore();
  renderWithSilo(
    <ShellBarContext.Provider value={store}>
      <LibraryScreen
        kind="movie"
        memory={new LibraryMemory()}
        onPlay={vi.fn()}
        onOpenDetail={vi.fn()}
        onExploreSection={vi.fn()}
        onOpenCollection={vi.fn()}
      />
    </ShellBarContext.Provider>,
    { session },
  );
  return store;
}

const focus = (focusKey: string) => act(async () => void (await setFocus(focusKey)));

describe('Recommended and the top bar', () => {
  it('with a hero: away while the focus is in the rows, at the top again above them', async () => {
    const store = setup([
      homeSection('feat', 12, { featured: true, item_limit: 5, title: 'Trending' }),
      homeSection('first', 3, { title: 'First' }),
    ]);
    await screen.findByTestId('hero-carousel');
    await screen.findByText('First');
    await focus(HERO_PLAY_KEY);
    expect(store.isAway()).toBe(false);
    await focus(cardFocusKey('lib-1/first', 'first-1'));
    await waitFor(() => expect(store.isAway()).toBe(true));
    await focus(HERO_PLAY_KEY);
    await waitFor(() => expect(store.isAway()).toBe(false));
  });

  it('without a hero: at the top in the first row, away once a later row has scrolled up', async () => {
    const store = setup([
      homeSection('first', 3, { title: 'First' }),
      homeSection('second', 3, { title: 'Second' }),
    ]);
    await screen.findByText('First');
    await focus(cardFocusKey('lib-1/first', 'first-1'));
    // Nothing has moved: the first row is where it starts.
    await act(async () => {});
    expect(store.isAway()).toBe(false);
    await focus(cardFocusKey('lib-1/second', 'second-1'));
    await waitFor(() => expect(store.isAway()).toBe(true));
    await focus(cardFocusKey('lib-1/first', 'first-1'));
    await waitFor(() => expect(store.isAway()).toBe(false));
  });
});

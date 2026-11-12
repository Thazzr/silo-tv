import { act, screen } from '@testing-library/react';
import { setLanguageSetting } from '../../i18n/languageSetting';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { homeSection } from '../../test/homeFixtures';
import { serveLibrary } from '../../test/libraryFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { LibraryScreen } from './LibraryScreen';
import { LibraryMemory } from './libraryMemory';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
afterEach(() => act(() => setLanguageSetting('auto')));

function render(lang: 'de' | 'en' | undefined) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  renderWithSilo(
    <LibraryScreen
      kind="movie"
      memory={new LibraryMemory()}
      onPlay={vi.fn()}
      onOpenDetail={vi.fn()}
      onExploreSection={vi.fn()}
      onOpenCollection={vi.fn()}
    />,
    { session, lang },
  );
}

const sections = () => ({
  sections: {
    'lib-1': [
      homeSection('rec', 2, {
        title: 'Recommended for You',
        title_key: 'home.section.recommendedForYou',
      }),
      homeSection('typed', 2, { title: 'My Picks' }),
    ],
  },
});

describe('the library rows: section titles', () => {
  it('shows the German title of a keyed row and a typed one as typed', async () => {
    serveLibrary(server, sections());
    render('de');
    await screen.findByText('Empfohlen für dich');
    expect(screen.getAllByTestId('row-title').map((el) => el.textContent)).toEqual([
      'Empfohlen für dich',
      'My Picks',
    ]);
  });

  it('shows the titles as sent in an English interface', async () => {
    serveLibrary(server, sections());
    render('en');
    await screen.findByText('Recommended for You');
    expect(screen.getAllByTestId('row-title').map((el) => el.textContent)).toEqual([
      'Recommended for You',
      'My Picks',
    ]);
  });

  it('switches the keyed row to German when the language changes, without a remount', async () => {
    serveLibrary(server, sections());
    act(() => setLanguageSetting('en'));
    render(undefined);
    await screen.findByText('Recommended for You');
    act(() => setLanguageSetting('de'));
    expect(screen.getAllByTestId('row-title')[0]!.textContent).toBe('Empfohlen für dich');
  });
});

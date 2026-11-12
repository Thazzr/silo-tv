import { act, fireEvent, screen } from '@testing-library/react';
import { setLanguageSetting } from '../../i18n/languageSetting';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { setFocus } from '../../app/nav';
import { account } from '../../test/apiFixtures';
import { homeSection, serveHome } from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { FocusIndexMemory, cardFocusKey } from '../../ui/media';
import { HomeScreen } from './HomeScreen';

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
  const onExploreSection = vi.fn();
  renderWithSilo(
    <HomeScreen
      rowMemory={new FocusIndexMemory()}
      onPlay={vi.fn()}
      onOpenDetail={vi.fn()}
      onExploreSection={onExploreSection}
    />,
    { session, lang },
  );
  return { onExploreSection };
}

const sections = () => [
  homeSection('trend', 2, {
    title: 'Trending This Week',
    title_key: 'home.section.trendingThisWeek',
  }),
  homeSection('lib', 25, {
    title: 'Recently Added in Movies',
    title_key: 'home.section.recentlyAddedIn',
    title_args: { library: 'Filme' },
    total_count: 25,
    has_more: true,
  }),
  homeSection('typed', 2, { title: 'My Picks' }),
];

const rowTitles = () => screen.getAllByTestId('row-title').map((el) => el.textContent);

describe('HomeScreen: section titles', () => {
  it('shows the German title of a keyed section, filled from its arguments', async () => {
    serveHome(server, { sections: sections() });
    render('de');
    await screen.findByTestId('row-trend');
    expect(rowTitles()).toEqual([
      'Diese Woche im Trend',
      'Kürzlich hinzugefügt in Filme',
      'My Picks',
    ]);
  });

  it('shows the titles as sent in an English interface', async () => {
    serveHome(server, { sections: sections() });
    render('en');
    await screen.findByTestId('row-trend');
    expect(rowTitles()).toEqual(['Trending This Week', 'Recently Added in Movies', 'My Picks']);
  });

  it('hands the translated title to the Explore all page', async () => {
    serveHome(server, { sections: sections() });
    const { onExploreSection } = render('de');
    await screen.findByTestId('row-lib');
    await setFocus(cardFocusKey('lib', 'lib-1'));
    for (let i = 0; i < 20; i += 1) await pressKey(KEY.right);
    fireEvent.keyDown(window, { keyCode: KEY.enter });
    fireEvent.keyUp(window, { keyCode: KEY.enter });
    expect(onExploreSection).toHaveBeenCalledWith({
      id: 'lib',
      title: 'Kürzlich hinzugefügt in Filme',
    });
  });

  it('switches the keyed row to German when the language changes, without a remount', async () => {
    serveHome(server, { sections: sections() });
    act(() => setLanguageSetting('en'));
    render(undefined);
    await screen.findByTestId('row-trend');
    expect(rowTitles()[0]).toBe('Trending This Week');
    act(() => setLanguageSetting('de'));
    expect(rowTitles()[0]).toBe('Diese Woche im Trend');
  });
});

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { SectionGridScreen } from '../../features/home/SectionGridScreen';
import { I18nProvider } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import { branding, catalogPage, profile, profileCollection } from '../../test/flowFixtures';
import { homeSection, resumeEpisode, serveHome } from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import { cardFocusKey, FocusIndexMemory, gridCardKey } from '../../ui/media';
import { getCurrentFocusKey, Navigator, type NavApi } from '../nav';
import { SiloProvider } from '../SiloContext';
import { ShellScreen } from './ShellScreen';
import { ShellMemory } from './tabs';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type Screen = { name: 'shell' } | { name: 'grid'; sectionId: string; title: string };

/** The shell with Home and the row grid on a screen stack, like the app flow has them. */
function renderHome() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const memory = new ShellMemory();
  const gridMemory = new FocusIndexMemory();
  const onPlay = vi.fn();
  const renderScreen = (screen: Screen, nav: NavApi<Screen>) =>
    screen.name === 'shell' ? (
      <ShellScreen
        memory={memory}
        onPlay={onPlay}
        onExploreSection={(section) =>
          nav.push({ name: 'grid', sectionId: section.id, title: section.title })
        }
        onSwitchProfile={() => undefined}
        onSwitchServer={() => undefined}
        launchMode="every"
        onLaunchMode={() => undefined}
      />
    ) : (
      <SectionGridScreen
        sectionId={screen.sectionId}
        title={screen.title}
        memory={gridMemory}
        onPlay={onPlay}
        onBack={nav.pop}
      />
    );
  render(
    <QueryClientProvider client={newQueryClient()}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator<Screen> initial={{ name: 'shell' }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onPlay };
}

function serve(sections: ReturnType<typeof homeSection>[]) {
  const calls = serveHome(server, {
    sections,
    page: () => ({
      ...catalogPage(
        Array.from({ length: 40 }, (_, i) => ({
          content_id: `p${i + 1}`,
          genres: [],
          keywords: [],
          status: 'matched',
          title: `Page Title ${i + 1}`,
          type: 'movie',
        })),
      ),
      page: { has_more: true, next_cursor: 'c2' },
    }),
  });
  server.use(
    http.get(`${BASE_URL}/api/v2/profiles`, () =>
      HttpResponse.json(profileCollection([profile({ id: 'p1', name: 'Alex' })])),
    ),
    http.get(`${BASE_URL}/api/v2/theme/branding`, () => HttpResponse.json(branding())),
  );
  return calls;
}

const homeTab = () => screen.getByRole('button', { name: 'Home' });
const key = (row: string, id: string) => cardFocusKey(row, id);

describe('Home in the shell', () => {
  it('Down enters the first row, Up leaves it for the tab bar, Back from a row goes to the tab bar', async () => {
    serve([homeSection('a', 3), homeSection('b', 3)]);
    renderHome();
    await screen.findByTestId('row-a', {}, { timeout: 10_000 });
    await waitFor(() => expect(homeTab()).toHaveFocus());
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('a', 'a-1'));
    await pressKey(KEY.up);
    expect(homeTab()).toHaveFocus();
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('b', 'b-1'));
    await pressKey(KEY.back);
    expect(homeTab()).toHaveFocus();
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
  });

  it('Explore all opens the row as a grid, and Back returns to the same card', async () => {
    const calls = serve([
      homeSection('a', 2),
      homeSection('more', 3, { title: 'More', total_count: 90 }),
    ]);
    renderHome();
    await screen.findByTestId('row-more', {}, { timeout: 10_000 });
    await waitFor(() => expect(homeTab()).toHaveFocus());
    // Into the second row, onto Explore all.
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('more', 'explore'));
    await pressKey(KEY.enter);

    // The grid: the row's title, its first page, the first card focused.
    expect(await screen.findByTestId('section-grid-title')).toHaveTextContent('More');
    await waitFor(() => expect(getCurrentFocusKey()).toBe(gridCardKey('more', 'p1')));
    const request = calls.pages[0]!;
    expect(request.get('source')).toBe('section');
    expect(request.get('scope')).toBe('home');
    expect(request.get('section_id')).toBe('more');
    expect(request.get('limit')).toBe('40');
    expect(request.get('poster_width')).toBe('520');
    await pressKey(KEY.down);

    // Back: Home again, on the Explore all card it was opened from.
    await pressKey(KEY.back);
    await screen.findByTestId('row-more', {}, { timeout: 10_000 });
    await waitFor(() => expect(getCurrentFocusKey()).toBe(key('more', 'explore')));
    expect(screen.queryByTestId('section-grid')).toBeNull();
  });

  it('Back closes the removal question first and leaves the focus on the card', async () => {
    serve([
      homeSection('cw', 2, {
        section_type: 'continue_watching',
        items: [resumeEpisode('e1'), resumeEpisode('e2')],
      }),
    ]);
    renderHome();
    await screen.findByTestId('row-cw', {}, { timeout: 10_000 });
    await waitFor(() => expect(homeTab()).toHaveFocus());
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('cw', 'e1'));
    fireEvent.keyDown(window, { keyCode: 405 });
    const dialog = await screen.findByTestId('remove-dialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('remove-dialog')).toBeNull());
    expect(getCurrentFocusKey()).toBe(key('cw', 'e1'));
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
    // The next Back is the shell's: to the tab bar.
    await pressKey(KEY.back);
    expect(homeTab()).toHaveFocus();
  });
});

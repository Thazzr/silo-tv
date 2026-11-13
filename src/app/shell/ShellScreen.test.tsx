import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import {
  branding,
  catalogItem,
  library,
  profile,
  profileCollection,
} from '../../test/flowFixtures';
import { homeSection, serveHome } from '../../test/homeFixtures';
import { serveLibrary, type LibraryCalls } from '../../test/libraryFixtures';
import { cardFocusKey } from '../../ui/media';
import { KEY, pressKey } from '../../test/keys';
import { matches, serveSearch } from '../../test/searchFixtures';
import { getCurrentFocusKey, setFocus } from '../nav';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import type { LaunchMode } from '../../features/profiles/launchPrefs';
import { ShellScreen, type ShellScreenProps } from './ShellScreen';
import { ShellMemory, type TabId } from './tabs';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const DELAY = 400;
const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const homeTitles = [
  catalogItem({ content_id: 'h1', title: 'Home One' }),
  catalogItem({ content_id: 'h2', title: 'Home Two' }),
  catalogItem({ content_id: 'h3', title: 'Home Three' }),
];
const movieTitles = [
  catalogItem({ content_id: 'f1', title: 'Film One' }),
  catalogItem({ content_id: 'f2', title: 'Film Two' }),
];
const seriesTitles = [catalogItem({ content_id: 's1', title: 'Show One', type: 'series' })];

interface Calls {
  library: LibraryCalls;
  logout: string[];
}

/** The libraries whose sections were read, in order. */
const sectionReads = (calls: Calls) => calls.library.sections.map((read) => read.id);

/** Home lists the first video library (movies here); Series has a library of its own. */
function serve(
  extra: {
    branding?: ReturnType<typeof branding> | 'fail';
    profiles?: ReturnType<typeof profile>[];
  } = {},
): Calls {
  const calls: Calls = {
    library: serveLibrary(server, {
      libraries: [
        library({ id: 'lib-film', name: 'Films', type: 'movies' }),
        library({ id: 'lib-show', name: 'Shows', type: 'series' }),
      ],
      sections: {
        'lib-film': [homeSection('film-rec', 0, { items: movieTitles, total_count: 2 })],
        'lib-show': [homeSection('show-rec', 0, { items: seriesTitles, total_count: 1 })],
      },
    }),
    logout: [],
  };
  // Home shows one title per row, so Up and Down walk the titles like a list.
  serveHome(server, {
    sections: homeTitles.map((item, i) =>
      homeSection(`r${i + 1}`, 0, { items: [item], total_count: 1 }),
    ),
  });
  server.use(
    http.get(`${BASE_URL}/api/v2/profiles`, () =>
      HttpResponse.json(profileCollection(extra.profiles ?? [profile({ id: 'p1', name: 'Alex' })])),
    ),
    http.get(`${BASE_URL}/api/v2/theme/branding`, () =>
      extra.branding === 'fail'
        ? HttpResponse.error()
        : HttpResponse.json(extra.branding ?? branding()),
    ),
    http.post(`${BASE_URL}/api/v2/auth/logout`, ({ request }) => {
      calls.logout.push(request.headers.get('Authorization') ?? '');
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

function signedIn(profileId = 'p1') {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId,
  });
  return session;
}

function setup(
  options: {
    memory?: ShellMemory;
    launchMode?: LaunchMode;
    offer?: ShellScreenProps['offer'];
    profileId?: string;
  } = {},
) {
  const memory = options.memory ?? new ShellMemory();
  const onPlay = vi.fn();
  const onOpenDetail = vi.fn();
  const onSwitchProfile = vi.fn();
  const onSwitchServer = vi.fn();
  const onLaunchMode = vi.fn();
  const onOpenSettings = vi.fn();
  const session = signedIn(options.profileId);
  const view = renderWithSilo(
    <ShellScreen
      memory={memory}
      onPlay={onPlay}
      onOpenDetail={onOpenDetail}
      onSwitchProfile={onSwitchProfile}
      onSwitchServer={onSwitchServer}
      onOpenSettings={onOpenSettings}
      launchMode={options.launchMode ?? 'every'}
      onLaunchMode={onLaunchMode}
      offer={options.offer}
    />,
    { session },
  );
  return {
    memory,
    onPlay,
    onOpenDetail,
    onSwitchProfile,
    onSwitchServer,
    onLaunchMode,
    onOpenSettings,
    ...view,
  };
}

const tab = (name: string) => screen.getByRole('button', { name });
const avatar = () => screen.getByRole('button', { name: /Profile menu for/ });
const shown = () =>
  (['home', 'movies', 'series', 'forYou', 'calendar', 'search'] as TabId[]).find(
    (id) => screen.queryByTestId(`tab-${id}`) !== null,
  );

async function ready() {
  await waitFor(() => expect(tab('Home')).toHaveFocus());
  await screen.findByTestId('row-r1');
}

/**
 * Presses a key that must move the focus and waits until it did. pressKey alone waits one task,
 * which a loaded machine can overrun: the next key would then start from the old focus.
 */
async function move(key: number) {
  const before = document.activeElement;
  await pressKey(key);
  await waitFor(() => expect(document.activeElement).not.toBe(before));
}

/** Moves to a tab with Right/Left, activates it with OK and waits until its content shows. */
async function goToTab(key: number, times: number, id: TabId) {
  for (let i = 0; i < times; i++) await move(key);
  await pressKey(KEY.enter);
  await waitFor(() => expect(shown()).toBe(id), { timeout: 3000 });
}

describe('ShellScreen keys', () => {
  it('opens with the Home tab focused and selected, and lists the tabs and the avatar', async () => {
    serve();
    setup();
    await ready();
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names.slice(0, 6)).toEqual([
      'Home',
      'Movies',
      'Series',
      'For You',
      'Calendar',
      'Search',
    ]);
    expect(tab('Home')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('avatar')).toHaveTextContent('A');
    // The list does not steal the focus from the bar.
    expect(screen.getByRole('button', { name: /Home One/ })).not.toHaveFocus();
  });

  it('Left and Right move across the tabs and the avatar and stop at both ends', async () => {
    serve();
    setup();
    await ready();
    const order = ['Movies', 'Series', 'For You', 'Calendar', 'Search'];
    for (const name of order) {
      await pressKey(KEY.right);
      expect(tab(name)).toHaveFocus();
    }
    await pressKey(KEY.right);
    expect(avatar()).toHaveFocus();
    await pressKey(KEY.right);
    expect(avatar()).toHaveFocus();
    await pressKey(KEY.left);
    expect(tab('Search')).toHaveFocus();
    for (let i = 0; i < 5; i++) await pressKey(KEY.left);
    expect(tab('Home')).toHaveFocus();
    await pressKey(KEY.left);
    expect(tab('Home')).toHaveFocus();
  });

  it('Down enters the content and Up from the first row returns to the selected tab', async () => {
    serve();
    setup();
    await ready();
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: /Home One/ })).toHaveFocus();
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: /Home Two/ })).toHaveFocus();
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    expect(tab('Home')).toHaveFocus();
  });

  it('Up from the content goes to the selected tab, not to the one that was merely focused', async () => {
    serve();
    setup();
    await ready();
    // Series is focused but not activated: Home is still selected and shown.
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(tab('Series')).toHaveFocus();
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: /Home One/ })).toHaveFocus();
    expect(shown()).toBe('home');
    await pressKey(KEY.up);
    expect(tab('Home')).toHaveFocus();
  });

  it('Back in the content moves the focus to the selected tab, without the exit popup', async () => {
    serve();
    setup();
    await ready();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: /Home Two/ })).toHaveFocus();
    await pressKey(KEY.back);
    expect(tab('Home')).toHaveFocus();
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
  });

  it('Back on the tab bar of another tab goes to Home; on Home it opens the exit popup', async () => {
    serve();
    setup();
    await ready();
    await goToTab(KEY.right, 1, 'movies');
    await pressKey(KEY.back);
    expect(tab('Home')).toHaveFocus();
    await waitFor(() => expect(shown()).toBe('home'));
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
    await pressKey(KEY.back);
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
    // Cancel keeps the shell as it was.
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument());
    expect(tab('Home')).toHaveFocus();
  });

  it('Back on the avatar goes to the Home tab', async () => {
    serve();
    setup();
    await ready();
    for (let i = 0; i < 6; i++) await pressKey(KEY.right);
    expect(avatar()).toHaveFocus();
    await pressKey(KEY.back);
    expect(tab('Home')).toHaveFocus();
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
  });

  it('every tab remembers its own focused element', async () => {
    serve();
    setup();
    await ready();
    // Home: the third title.
    await move(KEY.down);
    await move(KEY.down);
    await move(KEY.down);
    await waitFor(() => expect(screen.getByRole('button', { name: /Home Three/ })).toHaveFocus());
    await move(KEY.back);
    // The series tab has its own content: Down reaches its pills, and Down again its first card.
    await goToTab(KEY.right, 2, 'series');
    await screen.findByRole('button', { name: /Show One/ });
    await move(KEY.down);
    await move(KEY.down);
    await waitFor(() => expect(screen.getByRole('button', { name: /Show One/ })).toHaveFocus());
    await move(KEY.up);
    await move(KEY.up);
    await waitFor(() => expect(tab('Series')).toHaveFocus());
    // Back to Home: Down lands on the third title again, not on the first.
    await goToTab(KEY.left, 2, 'home');
    await screen.findByRole('button', { name: /Home Three/ });
    await move(KEY.down);
    await waitFor(() => expect(screen.getByRole('button', { name: /Home Three/ })).toHaveFocus());
  });

  it('Down within a tab returns to the element focused there before Up', async () => {
    serve();
    setup();
    await ready();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    expect(tab('Home')).toHaveFocus();
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: /Home One/ })).toHaveFocus();
  });
});

describe('ShellScreen tab activation', () => {
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });

  it('arrow keys across the tabs never switch the content, however long the focus rests', async () => {
    const calls = serve();
    setup();
    await ready();
    const before = sectionReads(calls).length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      for (let i = 0; i < 2; i += 1) {
        await act(async () => {
          fireEvent.keyDown(window, { keyCode: KEY.right });
          for (let n = 0; n < 20; n += 1) await Promise.resolve();
        });
      }
      expect(tab('Series')).toHaveFocus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      // Home stays shown and selected; Series is only highlighted.
      expect(shown()).toBe('home');
      expect(tab('Home')).toHaveAttribute('data-selected', 'true');
      expect(tab('Series')).toHaveAttribute('data-selected', 'false');
      expect(sectionReads(calls).length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('OK on a tab shows its content and marks the tab as selected', async () => {
    const calls = serve();
    setup();
    await ready();
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(shown()).toBe('home');
    await pressKey(KEY.enter);
    await waitFor(() => expect(shown()).toBe('series'));
    expect(tab('Series')).toHaveAttribute('aria-current', 'page');
    await screen.findByRole('button', { name: /Show One/ });
    expect(sectionReads(calls)).toContain('lib-show');
  });

  it('a pointer click switches at once; hovering the tab only moves the highlight', async () => {
    serve();
    setup();
    await ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => {
        fireEvent.mouseEnter(tab('Movies'));
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      });
      expect(tab('Movies')).toHaveFocus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(shown()).toBe('home');
      expect(tab('Home')).toHaveAttribute('data-selected', 'true');
      await act(async () => {
        fireEvent.click(tab('Movies'));
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      });
      expect(shown()).toBe('movies');
    } finally {
      vi.useRealTimers();
    }
    await settle();
  });

  it('Down from a focused tab that is not selected enters the content that is shown', async () => {
    serve();
    setup();
    await ready();
    await move(KEY.right);
    expect(tab('Movies')).toHaveFocus();
    await move(KEY.down);
    expect(screen.getByRole('button', { name: /Home One/ })).toHaveFocus();
    await sleep(DELAY + 200);
    expect(shown()).toBe('home');
    expect(tab('Home')).toHaveAttribute('data-selected', 'true');
    expect(tab('Movies')).toHaveAttribute('data-selected', 'false');
  });

  it('Up from the content lands on the selected tab, not on the one that was merely focused', async () => {
    serve();
    setup();
    await ready();
    await move(KEY.right);
    await move(KEY.right);
    expect(tab('Series')).toHaveFocus();
    await move(KEY.down);
    await move(KEY.up);
    expect(tab('Home')).toHaveFocus();
  });
});

describe('ShellScreen tab content', () => {
  it('Home shows the home rows, Movies the first movie library, Series the first series library', async () => {
    const calls = serve();
    setup();
    await ready();
    expect(screen.getAllByTestId('row-title').map((el) => el.textContent)).toEqual([
      'Row r1',
      'Row r2',
      'Row r3',
    ]);
    await goToTab(KEY.right, 1, 'movies');
    expect(await screen.findByRole('button', { name: /Film One/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await goToTab(KEY.right, 1, 'series');
    expect(await screen.findByRole('button', { name: /Show One/ })).toBeInTheDocument();
    expect(sectionReads(calls)).toEqual(['lib-film', 'lib-show']);
  });

  it('hands a selected title to onOpenDetail', async () => {
    serve();
    const { onOpenDetail } = setup();
    await ready();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(onOpenDetail).toHaveBeenCalledWith({ itemId: 'h2' });
  });

  it.each([
    ['For You', 3],
    ['Calendar', 4],
  ])('%s shows a calm placeholder that keeps Up and Down working', async (name, steps) => {
    serve();
    setup();
    await ready();
    await goToTab(KEY.right, steps, name === 'For You' ? 'forYou' : (name.toLowerCase() as TabId));
    expect(screen.getByTestId('coming-soon')).toHaveTextContent('Coming soon');
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: 'Go to Home' })).toHaveFocus();
    await pressKey(KEY.up);
    expect(tab(name)).toHaveFocus();
  });

  it('the placeholder button leads to Home', async () => {
    serve();
    setup();
    await ready();
    await goToTab(KEY.right, 3, 'forYou');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await waitFor(() => expect(shown()).toBe('home'));
    expect(tab('Home')).toHaveFocus();
  });

  it('keeps the selected tab and its focus in the memory for the next visit', async () => {
    serve();
    const memory = new ShellMemory();
    const first = setup({ memory });
    await ready();
    await goToTab(KEY.right, 2, 'series');
    await screen.findByRole('button', { name: /Show One/ });
    await move(KEY.down);
    await move(KEY.down);
    const card = cardFocusKey('lib-show/show-rec', 's1');
    await waitFor(() => expect(memory.focusOf('series')).toBe(card));
    first.unmount();
    expect(memory.tab).toBe('series');
    expect(memory.focusOf('series')).toBe(card);
    setup({ memory });
    await waitFor(() => expect(tab('Series')).toHaveFocus());
    expect(tab('Series')).toHaveAttribute('aria-current', 'page');
    await screen.findByRole('button', { name: /Show One/ });
  });
});

describe('ShellScreen avatar menu', () => {
  async function openMenu() {
    for (let i = 0; i < 6; i++) await pressKey(KEY.right);
    expect(avatar()).toHaveFocus();
    await pressKey(KEY.enter);
    await screen.findByTestId('avatar-menu');
  }

  it('opens on OK with the focus trapped inside, and Back closes it onto the avatar', async () => {
    serve();
    // Walking to the avatar passes the tabs; their pending switch must not run during the test.
    setup();
    await ready();
    await openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Switch profile',
      'Profile at launchEvery time',
      'Settings',
      'Switch server',
      'Sign out',
    ]);
    await waitFor(() => expect(items[0]).toHaveFocus());
    // Arrow keys cannot leave the menu.
    await pressKey(KEY.up);
    expect(items[0]).toHaveFocus();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(items[4]).toHaveFocus();
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    expect(items[4]).toHaveFocus();
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('avatar-menu')).not.toBeInTheDocument());
    expect(avatar()).toHaveFocus();
    // Back closed the menu only: no exit popup, the shell is as it was.
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
    expect(shown()).toBe('home');
  });

  it('Settings opens the settings screen and the shell remembers to land on the avatar', async () => {
    serve();
    const { onOpenSettings, memory } = setup();
    await ready();
    await openMenu();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus();
    await pressKey(KEY.enter);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(memory.returnToAvatar).toBe(true);
  });

  it('a shell opened with the avatar flag starts with the avatar focused', async () => {
    serve();
    const memory = new ShellMemory();
    memory.expectAvatarReturn();
    setup({ memory });
    await screen.findByTestId('row-r1');
    await waitFor(() => expect(avatar()).toHaveFocus());
    expect(tab('Home')).not.toHaveFocus();
    expect(memory.returnToAvatar).toBe(false);
  });

  it('names the profile and the server in its header', async () => {
    serve({ branding: branding({ server_name: 'Movie Barn' }) });
    setup();
    await ready();
    await openMenu();
    const menu = screen.getByTestId('avatar-menu');
    expect(menu).toHaveTextContent('Alex');
    await waitFor(() => expect(menu).toHaveTextContent('Movie Barn'));
  });

  it('Switch profile calls the profile list handler', async () => {
    serve();
    const { onSwitchProfile, onSwitchServer } = setup();
    await ready();
    await openMenu();
    await pressKey(KEY.enter);
    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
    expect(onSwitchServer).not.toHaveBeenCalled();
  });

  it('Switch server calls the server handler and leaves the session alone', async () => {
    const calls = serve();
    const { onSwitchServer, session } = setup();
    await ready();
    await openMenu();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(onSwitchServer).toHaveBeenCalledTimes(1);
    expect(session.get()).not.toBeNull();
    expect(calls.logout).toHaveLength(0);
  });

  async function askSignOut() {
    await ready();
    await openMenu();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await screen.findByTestId('signout-dialog');
  }

  it('Sign out asks first, names the server, and has Cancel focused', async () => {
    const calls = serve({ branding: branding({ server_name: 'Movie Barn' }) });
    const { session } = setup();
    await askSignOut();
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent('Sign out of Movie Barn?'),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(session.get()).not.toBeNull();
    expect(calls.logout).toHaveLength(0);
  });

  it('Cancel keeps the session and sends no logout; the menu stays open', async () => {
    const calls = serve();
    const { session } = setup();
    await askSignOut();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('signout-dialog')).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId('avatar-menu')).toBeInTheDocument();
    expect(session.get()).not.toBeNull();
    expect(calls.logout).toHaveLength(0);
  });

  it('Back closes the dialog first, then the menu, and keeps the session', async () => {
    const calls = serve();
    const { session } = setup();
    await askSignOut();
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('signout-dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('avatar-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('avatar-menu')).not.toBeInTheDocument());
    expect(session.get()).not.toBeNull();
    expect(calls.logout).toHaveLength(0);
  });

  it('confirming calls logout with the token and clears the session', async () => {
    const calls = serve();
    const { session } = setup();
    await askSignOut();
    fireEvent.click(
      within(screen.getByTestId('signout-dialog')).getByRole('button', { name: 'Sign out' }),
    );
    await waitFor(() => expect(session.get()).toBeNull());
    expect(calls.logout).toEqual(['Bearer a']);
  });

  it('a click outside the menu closes it', async () => {
    serve();
    setup();
    await ready();
    await openMenu();
    fireEvent.click(document.querySelector('.menu-backdrop')!);
    expect(screen.queryByTestId('avatar-menu')).not.toBeInTheDocument();
  });
});

describe('ShellScreen kids profile', () => {
  async function openMenu() {
    for (let i = 0; i < 6; i++) await pressKey(KEY.right);
    await pressKey(KEY.enter);
    await screen.findByTestId('avatar-menu');
  }

  it('offers no Switch server and no Sign out in a kids profile, but Switch profile stays', async () => {
    serve({ profiles: [profile({ id: 'p1', name: 'Mia', is_child: true, is_primary: false })] });
    setup();
    await ready();
    await waitFor(() => expect(avatar()).toHaveAccessibleName('Profile menu for Mia'));
    await openMenu();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Switch profile',
      'Profile at launchEvery time',
      'Settings',
    ]);
    expect(screen.queryByRole('menuitem', { name: 'Switch server' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-profile')).toHaveTextContent('Mia');
  });

  it('shows Switch server and Sign out in a profile that is not a kids profile', async () => {
    serve({ profiles: [profile({ id: 'p1', name: 'Alex', is_child: false })] });
    setup();
    await ready();
    await waitFor(() => expect(avatar()).toHaveAccessibleName('Profile menu for Alex'));
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Switch server' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('holds back Switch server and Sign out until the profile is known', async () => {
    serve();
    server.use(
      http.get(`${BASE_URL}/api/v2/profiles`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return HttpResponse.json(
          profileCollection([profile({ id: 'p1', name: 'Mia', is_child: true })]),
        );
      }),
    );
    setup();
    await ready();
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
  });
});

describe('ShellScreen profile at launch', () => {
  async function openMenu() {
    for (let i = 0; i < 6; i++) await pressKey(KEY.right);
    await pressKey(KEY.enter);
    await screen.findByTestId('avatar-menu');
  }
  const optionNames = () => screen.getAllByRole('menuitemradio').map((i) => i.textContent);

  it('shows the current mode in the menu entry', async () => {
    serve();
    setup({ launchMode: 'hour' });
    await ready();
    await openMenu();
    expect(screen.getByTestId('launch-value')).toHaveTextContent('After 1 hour');
  });

  it('opens a chooser with the four options and marks the current one', async () => {
    serve();
    setup({ launchMode: 'halfday' });
    await ready();
    await openMenu();
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(optionNames()).toEqual(['Automatic', 'Every time', 'After 1 hour', 'After 12 hours✓']);
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
      'true',
    ]);
    // The focus starts on the current option.
    await waitFor(() => expect(radios[3]).toHaveFocus());
  });

  it('Back in the chooser returns to the menu on its entry; Back again closes the menu', async () => {
    serve();
    setup();
    await ready();
    await openMenu();
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await screen.findAllByRole('menuitemradio');
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0));
    expect(screen.getByTestId('avatar-menu')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /Profile at launch/ })).toHaveFocus(),
    );
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('avatar-menu')).not.toBeInTheDocument());
  });

  it('choosing an option reports it and returns to the menu', async () => {
    serve();
    const { onLaunchMode } = setup();
    await ready();
    await openMenu();
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await screen.findAllByRole('menuitemradio');
    await waitFor(() =>
      expect(screen.getByRole('menuitemradio', { name: /Every time/ })).toHaveFocus(),
    );
    await pressKey(KEY.up);
    expect(screen.getByRole('menuitemradio', { name: /Automatic/ })).toHaveFocus();
    await pressKey(KEY.enter);
    expect(onLaunchMode).toHaveBeenCalledWith('automatic');
    await waitFor(() => expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0));
    expect(screen.getByTestId('avatar-menu')).toBeInTheDocument();
  });

  it('a kids profile can still reach the chooser', async () => {
    serve({ profiles: [profile({ id: 'p1', name: 'Mia', is_child: true })] });
    setup();
    await ready();
    await waitFor(() => expect(avatar()).toHaveAccessibleName('Profile menu for Mia'));
    await openMenu();
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(optionNames()).toHaveLength(4);
  });
});

describe('ShellScreen automatic-profile offer', () => {
  it('asks "Open {name} automatically next time?" with Yes focused', async () => {
    serve();
    const onAnswer = vi.fn();
    setup({ offer: { name: 'Alex', onAnswer } });
    const dialog = await screen.findByTestId('launch-offer');
    expect(dialog).toHaveTextContent('Open Alex automatically next time?');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes' })).toHaveFocus());
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('Yes answers true and No answers false', async () => {
    serve();
    const yes = vi.fn();
    const first = setup({ offer: { name: 'Alex', onAnswer: yes } });
    await screen.findByTestId('launch-offer');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(yes).toHaveBeenCalledWith(true);
    first.unmount();

    const no = vi.fn();
    setup({ offer: { name: 'Alex', onAnswer: no } });
    await screen.findByTestId('launch-offer');
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(no).toHaveBeenCalledWith(false);
  });

  it('Back answers No, and the arrow keys cannot leave the dialog', async () => {
    serve();
    const onAnswer = vi.fn();
    setup({ offer: { name: 'Alex', onAnswer } });
    await screen.findByTestId('launch-offer');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes' })).toHaveFocus());
    await pressKey(KEY.up);
    await pressKey(KEY.left);
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveFocus();
    await pressKey(KEY.back);
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
  });

  it('shows no dialog without an offer', async () => {
    serve();
    setup();
    await ready();
    expect(screen.queryByTestId('launch-offer')).not.toBeInTheDocument();
  });
});

describe('ShellScreen branding', () => {
  it('shows the server mark and name from the branding', async () => {
    serve({
      branding: branding({
        server_name: 'Movie Barn',
        mark_url: '/api/v2/branding/assets/mark?v=1',
      }),
    });
    setup();
    await ready();
    await waitFor(() => expect(screen.getByTestId('server-name')).toHaveTextContent('Movie Barn'));
    expect(screen.getByTestId('server-mark')).toHaveAttribute(
      'src',
      `${BASE_URL}/api/v2/branding/assets/mark?v=1`,
    );
  });

  it('falls back to the host and a neutral initial badge without branding', async () => {
    serve({ branding: 'fail' });
    setup();
    await ready();
    expect(screen.getByTestId('server-name')).toHaveTextContent('silo.example.test');
    expect(screen.getByTestId('server-badge')).toHaveTextContent('S');
    expect(screen.queryByTestId('server-mark')).not.toBeInTheDocument();
  });

  it('falls back to the badge when the mark cannot be loaded', async () => {
    serve({ branding: branding({ server_name: 'Movie Barn', mark_url: '/broken.png' }) });
    setup();
    await ready();
    const mark = await screen.findByTestId('server-mark');
    fireEvent.error(mark);
    expect(screen.queryByTestId('server-mark')).not.toBeInTheDocument();
    expect(screen.getByTestId('server-badge')).toHaveTextContent('M');
  });
});

describe('ShellScreen search tab', () => {
  async function openSearch() {
    await ready();
    await goToTab(KEY.right, 5, 'search');
  }

  it('shows the keyboard and the hint instead of the placeholder', async () => {
    serve();
    serveSearch(server, { capabilities: {} });
    setup();
    await openSearch();
    expect(screen.queryByTestId('coming-soon')).toBeNull();
    expect(screen.getByTestId('search-keyboard')).toBeInTheDocument();
    expect(await screen.findByText('Search Test Server')).toBeInTheDocument();
  });

  it('Down from the tab lands on "a" the first time and on the last key used later', async () => {
    serve();
    serveSearch(server, { capabilities: {} });
    setup();
    await openSearch();
    await pressKey(KEY.down);
    await waitFor(() => expect(getCurrentFocusKey()).toBe('osk:a'));
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await waitFor(() => expect(getCurrentFocusKey()).toBe('osk:i'));
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    await waitFor(() => expect(tab('Search')).toHaveFocus());
    await pressKey(KEY.down);
    // The last key used: the second Up started on "b".
    await waitFor(() => expect(getCurrentFocusKey()).toBe('osk:b'));
  });

  it('opens on the last key of the memory when the tab is shown again', async () => {
    serve();
    serveSearch(server, { capabilities: {} });
    const memory = new ShellMemory();
    memory.search.rememberKey('x');
    setup({ memory });
    await openSearch();
    await pressKey(KEY.down);
    await waitFor(() => expect(getCurrentFocusKey()).toBe('osk:x'));
  });

  it('Down lands on the keyboard even when the focus was last in the results', async () => {
    serve();
    serveSearch(server, { capabilities: {}, titles: () => matches('Title', 3) });
    setup();
    await openSearch();
    await pressKey(KEY.down);
    fireEvent.click(screen.getByTestId('osk-s'));
    await screen.findAllByText('Title 1');
    await act(async () => void (await setFocus('gcard:search:title-1')));
    await pressKey(KEY.back);
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^osk:/));
    await act(async () => void (await setFocus('shell-tab-search')));
    await pressKey(KEY.down);
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^osk:/));
  });

  it('Back from the results goes to the keyboard, from the keyboard to the tab bar', async () => {
    serve();
    serveSearch(server, { capabilities: {}, titles: () => matches('Title', 3) });
    setup();
    await openSearch();
    await pressKey(KEY.down);
    fireEvent.click(screen.getByTestId('osk-s'));
    await screen.findAllByText('Title 1');
    await act(async () => void (await setFocus('gcard:search:title-2')));
    await pressKey(KEY.back);
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^osk:/));
    await pressKey(KEY.back);
    await waitFor(() => expect(tab('Search')).toHaveFocus());
  });

  it('keeps the text in the memory while the shell is away', async () => {
    serve();
    serveSearch(server, { capabilities: {} });
    const memory = new ShellMemory();
    const first = setup({ memory });
    await openSearch();
    await pressKey(KEY.down);
    fireEvent.click(screen.getByTestId('osk-s'));
    fireEvent.click(screen.getByTestId('osk-a'));
    first.unmount();
    expect(memory.search.query).toBe('sa');
    setup({ memory });
    expect(await screen.findByTestId('search-text')).toHaveTextContent('sa');
  });
});

describe('ShellScreen floating top bar', () => {
  const bar = () => screen.getByTestId('topbar');
  const inRowsMode = () => document.querySelector('[data-rows="true"]') !== null;

  it('stays while the content is at its top and leaves with the rows, which move the page up', async () => {
    serve();
    setup();
    await ready();
    expect(bar()).toHaveAttribute('data-hidden', 'false');
    await move(KEY.down);
    await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'true'));
    await move(KEY.up);
    expect(tab('Home')).toHaveFocus();
    await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'false'));
  });

  it('comes back when a key moves the focus onto it, wherever the content is', async () => {
    serve();
    setup();
    await ready();
    await move(KEY.down);
    await move(KEY.down);
    await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'true'));
    await move(KEY.back);
    expect(tab('Home')).toHaveFocus();
    expect(bar()).toHaveAttribute('data-hidden', 'false');
  });

  it('leaves a natively scrolled page once it has scrolled, and returns when it is back at the top', async () => {
    serve();
    setup();
    await ready();
    await goToTab(KEY.right, 3, 'forYou');
    await move(KEY.down);
    expect(getCurrentFocusKey()).toBe('shell-placeholder');
    const scrollTo = (y: number) => {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
    };
    try {
      scrollTo(300);
      expect(bar()).toHaveAttribute('data-hidden', 'true');
      scrollTo(0);
      expect(bar()).toHaveAttribute('data-hidden', 'false');
    } finally {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    }
  });

  it('shows the bar while a key has the focus on it, though the content is still away, and hides it when a key leaves for the content', async () => {
    serve();
    setup();
    await ready();
    await goToTab(KEY.right, 3, 'forYou');
    await move(KEY.down);
    expect(getCurrentFocusKey()).toBe('shell-placeholder');
    try {
      Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      expect(bar()).toHaveAttribute('data-hidden', 'true');
      await move(KEY.up);
      expect(tab('For You')).toHaveFocus();
      expect(bar()).toHaveAttribute('data-hidden', 'false');
      await move(KEY.down);
      expect(getCurrentFocusKey()).toBe('shell-placeholder');
      expect(bar()).toHaveAttribute('data-hidden', 'true');
    } finally {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    }
  });

  it('is brought back by a pointer in the top edge, and hover on a tab leaves the content where it is', async () => {
    serve();
    setup();
    await ready();
    await move(KEY.down);
    await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'true'));
    expect(inRowsMode()).toBe(true);

    await act(async () => {
      fireEvent.mouseMove(screen.getByTestId('topbar-reveal'));
    });
    expect(bar()).toHaveAttribute('data-hidden', 'false');
    expect(screen.queryByTestId('topbar-reveal')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.mouseEnter(tab('Movies'));
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    // The hovered tab has the focus, and the content is still in its rows mode.
    expect(tab('Movies')).toHaveFocus();
    expect(inRowsMode()).toBe(true);

    // The pointer leaves: the focus stays on the tab, but it was the pointer's, so the bar goes.
    await act(async () => {
      fireEvent.mouseLeave(bar());
    });
    expect(bar()).toHaveAttribute('data-hidden', 'true');
    expect(inRowsMode()).toBe(true);
  });

  it('is not kept by a pointer that only rests on it: mouseenter alone does not count, and a key that moves the focus into the rows hides the bar', async () => {
    serve();
    setup();
    await ready();
    await act(async () => {
      fireEvent.mouseEnter(bar());
    });
    expect(bar()).toHaveAttribute('data-hidden', 'false');
    await move(KEY.down);
    await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'true'));
  });

  it('is shown by a pointer moving over the reveal strip, and the next arrow key hides it again once the focus is in the content', async () => {
    serve();
    setup();
    await ready();
    await move(KEY.down);
    await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'true'));
    await act(async () => {
      fireEvent.mouseEnter(screen.getByTestId('topbar-reveal'));
    });
    expect(bar()).toHaveAttribute('data-hidden', 'true');
    await act(async () => {
      fireEvent.mouseMove(screen.getByTestId('topbar-reveal'));
    });
    expect(bar()).toHaveAttribute('data-hidden', 'false');
    await move(KEY.down);
    expect(bar()).toHaveAttribute('data-hidden', 'true');
  });
});

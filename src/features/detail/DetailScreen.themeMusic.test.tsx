import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { components } from '../../api/generated/schema';
import { Session } from '../../api/session';
import { Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import { itemDetail, serveDetail } from '../../test/detailFixtures';
import { FakeAudio } from '../../test/fakeAudio';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';
import { setThemeMusicForTests, ThemeMusicController } from './themeMusic';

type S = components['schemas'];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));

let audios: FakeAudio[] = [];
const audio = (index: number): FakeAudio => {
  const found = audios[index];
  if (!found) throw new Error(`no audio element ${index}`);
  return found;
};
let visibility: 'visible' | 'hidden' = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const setVisibility = (state: 'visible' | 'hidden') => {
  visibility = state;
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
};

function installController(playable = true) {
  audios = [];
  setThemeMusicForTests({
    controller: new ThemeMusicController({
      createAudio: () => {
        const audio = new FakeAudio();
        audios.push(audio);
        return audio;
      },
      setTimer: (callback, ms) => setInterval(callback, ms),
      clearTimer: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    }),
    canPlayType: (mime) => (playable && mime === 'audio/mpeg' ? 'probably' : ''),
  });
}

afterEach(() => {
  server.resetHandlers();
  setThemeMusicForTests(null);
  visibility = 'visible';
});
afterAll(() => server.close());

const THEMES: S['ThemeSongSet'] = {
  owner_id: '77',
  items: [
    { id: 'x9', title: 'Not numeric', duration_seconds: 5, container: 'mp3' },
    { id: '12', title: 'Main Theme', duration_seconds: 90, container: 'mp3' },
    { id: '13', title: 'Second', duration_seconds: 90, container: 'mp3' },
  ],
};

interface ThemeServe {
  capability?: Partial<S['ThemeSongsCapability']> | 'fail';
  grant?: Partial<S['ThemePlayback']> | 'fail';
}
interface ThemeCalls {
  capability: number;
  grants: { path: string; profileId: string | null; body: unknown; query: string }[];
}

function serveThemes(options: ThemeServe = {}): ThemeCalls {
  const calls: ThemeCalls = { capability: 0, grants: [] };
  server.use(
    http.get(`${BASE_URL}/api/v2/catalog/themes/capabilities`, () => {
      calls.capability += 1;
      if (options.capability === 'fail') return new HttpResponse(null, { status: 500 });
      const body: S['ThemeSongsCapability'] = {
        allowed: true,
        cluster_routing: false,
        delivery: 'local_direct_play',
        grant_lifetime_seconds: 60,
        revision: 'r1',
        state: 'available',
        transcode: true,
        ...options.capability,
      };
      return HttpResponse.json(body);
    }),
    http.post(
      `${BASE_URL}/api/v2/catalog/items/:id/themes/:themeId/playback`,
      async ({ request }) => {
        const text = await request.text();
        calls.grants.push({
          path: new URL(request.url).pathname,
          profileId: request.headers.get('X-Profile-Id'),
          body: text === '' ? null : JSON.parse(text),
          query: new URL(request.url).search,
        });
        if (options.grant === 'fail') return new HttpResponse(null, { status: 403 });
        const body: S['ThemePlayback'] = {
          url: '/api/v2/media/theme/grant-1',
          expires_at: '2030-01-01T00:00:00Z',
          delivery: 'original',
          content_type: 'audio/mpeg',
          ...options.grant,
        };
        return HttpResponse.json(body);
      },
    ),
  );
  return calls;
}

type Screen = { name: 'detail'; target: DetailTarget } | { name: 'player'; request: PlayRequest };

function setup(target: DetailTarget = { itemId: 'm1' }) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const memory = new DetailMemory();
  const queryClient: QueryClient = newQueryClient();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => nav.push({ name: 'player', request })}
        onOpenDetail={() => undefined}
        onOpenPerson={() => undefined}
        onOpenBoxSet={() => undefined}
        onBack={() => nav.pop()}
      />
    ) : (
      <div data-testid="player-stub">{current.request.contentId}</div>
    );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

const on = { 'ui.theme_music_enabled': true };
const withTheme = (themes: S['ThemeSongSet'] | undefined = THEMES) => ({
  item: () => itemDetail({ themes }),
});
const quiet = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('DetailScreen: theme music', () => {
  it('asks for nothing while the setting is off (capability and grant)', async () => {
    installController();
    const calls = serveThemes();
    serveDetail(server, {
      ...withTheme(),
      settings: { values: { 'ui.theme_music_enabled': false } },
    });
    setup();
    await screen.findByTestId('detail-hero');
    await quiet();
    expect(calls.capability).toBe(0);
    expect(calls.grants).toHaveLength(0);
    expect(audios).toHaveLength(0);
  });

  it('asks for nothing while the setting is not yet known, then plays once it is', async () => {
    installController();
    const calls = serveThemes();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    serveDetail(server, { ...withTheme(), settings: { values: on, gate } });
    setup();
    await screen.findByTestId('detail-hero');
    await quiet();
    expect(calls.capability).toBe(0);
    expect(calls.grants).toHaveLength(0);
    open();
    await waitFor(() => expect(audios).toHaveLength(1));
    expect(calls.grants).toHaveLength(1);
  });

  it('requests the grant for the first numeric song under the owner, with the playable formats', async () => {
    installController();
    const calls = serveThemes();
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    expect(calls.grants).toEqual([
      {
        path: '/api/v2/catalog/items/77/themes/12/playback',
        profileId: 'p1',
        body: { accepted_formats: [{ container: 'mp3', audio_codec: 'mp3' }] },
        query: '',
      },
    ]);
    // A relative grant is resolved against the server, and nothing is appended to it.
    expect(audio(0).src).toBe(`${BASE_URL}/api/v2/media/theme/grant-1`);
    expect(audio(0).played).toBe(1);
    expect(audio(0).volume).toBe(0);
  });

  it('sends no body when the device plays none of the candidates', async () => {
    installController(false);
    const calls = serveThemes();
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    expect(calls.grants[0]?.body).toBeNull();
  });

  it('uses an absolute proxy URL unchanged', async () => {
    installController();
    serveThemes({ grant: { url: 'https://node.example.test/t/abc?sig=1' } });
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    expect(audio(0).src).toBe('https://node.example.test/t/abc?sig=1');
  });

  it('loops an original in place when the loop setting is on', async () => {
    installController();
    serveThemes();
    serveDetail(server, {
      ...withTheme(),
      settings: { values: { ...on, 'ui.theme_music_loop': true } },
    });
    setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    expect(audio(0).loop).toBe(true);
  });

  it.each(['disabled', 'not_configured', 'unsupported'] as const)(
    'requests no grant when the capability is %s',
    async (state) => {
      installController();
      const calls = serveThemes({ capability: { state } });
      serveDetail(server, { ...withTheme(), settings: { values: on } });
      setup();
      await waitFor(() => expect(calls.capability).toBe(1));
      await quiet();
      expect(calls.grants).toHaveLength(0);
    },
  );

  it('requests no grant when the capability is not allowed', async () => {
    installController();
    const calls = serveThemes({ capability: { allowed: false } });
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await waitFor(() => expect(calls.capability).toBe(1));
    await quiet();
    expect(calls.grants).toHaveLength(0);
  });

  it('counts a failed capability read as off, without an error on the page', async () => {
    installController();
    const calls = serveThemes({ capability: 'fail' });
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await waitFor(() => expect(calls.capability).toBe(1));
    await screen.findByTestId('detail-hero');
    await quiet();
    expect(calls.grants).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each<[string, S['ThemeSongSet'] | undefined]>([
    ['no themes', undefined],
    ['an empty set', { owner_id: '77', items: [] }],
    [
      'only non-numeric ids',
      { owner_id: '77', items: [{ id: 'a1', title: 'x', duration_seconds: 1, container: 'mp3' }] },
    ],
  ])('requests no grant for %s', async (_name, themes) => {
    installController();
    const calls = serveThemes();
    serveDetail(server, {
      item: () => itemDetail(themes ? { themes } : {}),
      settings: { values: on },
    });
    setup();
    await screen.findByTestId('detail-hero');
    await quiet();
    expect(calls.grants).toHaveLength(0);
    expect(audios).toHaveLength(0);
  });

  it('stays silent, without an error, when the grant is refused', async () => {
    installController();
    const calls = serveThemes({ grant: 'fail' });
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await waitFor(() => expect(calls.grants).toHaveLength(1));
    await screen.findByTestId('detail-hero');
    await quiet();
    expect(audios).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops when a screen is pushed over the page and starts again from a new grant on Back', async () => {
    installController();
    const calls = serveThemes();
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    await screen.findByRole('button', { name: /Start|Play/ });
    await pressKey(KEY.enter);
    await screen.findByTestId('player-stub');
    expect(audio(0).paused).toBe(true);
    expect(audio(0).src).toBe('');
    expect(audio(0).loads).toBe(1);
    await pressKey(KEY.back);
    await screen.findByTestId('detail-hero');
    await waitFor(() => expect(audios).toHaveLength(2));
    expect(calls.grants).toHaveLength(2);
  });

  it('stops when the page unmounts', async () => {
    installController();
    serveThemes();
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    const { unmount } = setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    unmount();
    expect(audio(0).paused).toBe(true);
    expect(audio(0).src).toBe('');
  });

  it('stops when the app goes to the background and asks for a new grant when it returns', async () => {
    installController();
    const calls = serveThemes();
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    setVisibility('hidden');
    expect(audio(0).paused).toBe(true);
    expect(audio(0).src).toBe('');
    expect(calls.grants).toHaveLength(1);
    setVisibility('visible');
    await waitFor(() => expect(calls.grants).toHaveLength(2));
    await waitFor(() => expect(audios).toHaveLength(2));
    expect(audio(1).src).not.toBe('');
  });

  it('does not start while the document is hidden', async () => {
    visibility = 'hidden';
    installController();
    const calls = serveThemes();
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    setup();
    await screen.findByTestId('detail-hero');
    await quiet();
    expect(calls.grants).toHaveLength(0);
  });

  it('stops when the setting turns off while the page shows', async () => {
    installController();
    const values: Record<string, unknown> = { ...on };
    serveThemes();
    serveDetail(server, { ...withTheme(), settings: { values } });
    const { queryClient } = setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    values['ui.theme_music_enabled'] = false;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings', 'effective'] });
    });
    await waitFor(() => expect(audio(0).paused).toBe(true));
    expect(audio(0).src).toBe('');
  });

  it('stops when the capability turns unavailable while the page shows', async () => {
    installController();
    const capability: Partial<S['ThemeSongsCapability']> = {};
    serveThemes({ capability });
    serveDetail(server, { ...withTheme(), settings: { values: on } });
    const { queryClient } = setup();
    await waitFor(() => expect(audios).toHaveLength(1));
    capability.state = 'disabled';
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['themes', 'capability'] });
    });
    await waitFor(() => expect(audio(0).paused).toBe(true));
    expect(audio(0).src).toBe('');
  });
});

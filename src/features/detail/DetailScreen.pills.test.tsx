import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider, type Language } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import {
  audioTrack,
  fileVersion,
  itemDetail,
  rollup,
  seasonOf,
  serveDetail,
  serveSubtitles,
  serveTrackPrefs,
  storedSubtitle,
  subtitleTrack,
  type DetailServe,
} from '../../test/detailFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, testDevice } from '../../test/renderFlow';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';
import { CardPrefsProvider } from '../../ui/media';

// The version, audio and subtitle pills of a movie and an episode page.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

type S = components['schemas'];
type Screen = { name: 'detail'; target: DetailTarget } | { name: 'player'; request: PlayRequest };

function setup(target: DetailTarget = { itemId: 'm1' }, lang: Language = 'en') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const memory = new DetailMemory();
  const onPlay = vi.fn<(request: PlayRequest) => void>();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => {
          onPlay(request);
        }}
        onOpenDetail={() => undefined}
        onOpenPerson={() => undefined}
        onOpenBoxSet={() => undefined}
        onBack={() => nav.pop()}
      />
    ) : (
      <div data-testid="player-stub">{current.request.contentId}</div>
    );
  const view = render(
    <QueryClientProvider client={client}>
      <I18nProvider lang={lang}>
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <CardPrefsProvider>
            <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
          </CardPrefsProvider>
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onPlay, queryClient: client, ...view };
}

const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));
const ready = () => screen.findByTestId('detail-hero');
const pill = (kind: string) => screen.getByTestId(`pill-${kind}`);
const rowNamed = (dialog: HTMLElement, name: string | RegExp) =>
  within(dialog).getByRole('radio', { name });
/** Time for the screen's debounced focus restore, which a dialog must not trigger. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

const german = audioTrack({ language: 'de', codec: 'eac3', channels: 6, default: true });
const english = audioTrack({
  language: 'en',
  codec: 'truehd',
  channels: 8,
  title: 'English TrueHD Atmos',
  layout: '7.1',
  bitrate: 4000,
  sample_rate: 48000,
  bit_depth: 24,
});
const subs = [
  subtitleTrack({ language: 'en', codec: 'subrip', title: 'English' }),
  subtitleTrack({ language: 'de', codec: 'subrip', forced: true }),
  subtitleTrack({ language: 'fr', codec: 'ass', external: true, file_name: 'film.fr.ass' }),
];
/** A movie file with two audio tracks and three subtitle tracks. */
const rich = (overrides: Partial<S['FileVersion']> = {}) =>
  fileVersion({
    audio_tracks: [german, english],
    subtitle_tracks: subs,
    resolution: '1080p',
    codec_video: 'h264',
    codec_audio: 'eac3',
    ...overrides,
  });
const serveMovie = (
  overrides: Partial<S['CatalogItemDetail']> = {},
  extra: Partial<DetailServe> = {},
) =>
  serveDetail(server, { item: () => itemDetail({ versions: [rich()], ...overrides }), ...extra });
const episodePage = (overrides: Partial<S['CatalogItemDetail']> = {}) =>
  itemDetail({
    content_id: 'e1',
    type: 'episode',
    series_id: 's1',
    series_title: 'A Show',
    season_number: 1,
    episode_number: 1,
    versions: [rich()],
    ...overrides,
  });
const serveEpisode = (overrides: Partial<S['CatalogItemDetail']> = {}) =>
  serveDetail(server, {
    item: (id) =>
      id === 'e1'
        ? episodePage(overrides)
        : itemDetail({ content_id: id, type: 'series', title: 'A Show', versions: [] }),
    seasons: [seasonOf(1)],
  });

type PillKind = 'edition' | 'version' | 'audio' | 'subtitles';

/** Down from the buttons lands on the first pill; Right walks on to the named one. */
async function focusPill(kind: PillKind, order: PillKind[] = ['audio', 'subtitles']) {
  await focusKeyIs('detail-play');
  await pressKey(KEY.down);
  await focusKeyIs(`detail-pill-${order[0]}`);
  for (let i = 0; i < order.indexOf(kind); i += 1) await pressKey(KEY.right);
  await focusKeyIs(`detail-pill-${kind}`);
}

describe('which pills a page shows', () => {
  it('shows Audio and Subtitles under the buttons of a movie, with what each says', async () => {
    serveMovie();
    setup();
    await ready();
    expect(pill('audio')).toHaveTextContent('AudioAuto: German · EAC3 · 5.1');
    expect(pill('subtitles')).toHaveTextContent('SubsAuto: German (Forced) · SRT');
    // Each is a button that opens a list.
    expect(pill('audio')).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByTestId('pill-version')).toBeNull();
    expect(screen.queryByTestId('pill-edition')).toBeNull();
    // They sit under the action row, in a row of their own.
    const row = screen.getByTestId('detail-pills');
    expect(screen.getByTestId('detail-actions').contains(row)).toBe(false);
    expect(row.compareDocumentPosition(screen.getByTestId('detail-actions'))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });

  it('words them in German', async () => {
    serveMovie();
    setup({ itemId: 'm1' }, 'de');
    await ready();
    expect(pill('audio')).toHaveTextContent('AudioAutomatisch: Deutsch · EAC3 · 5.1');
    expect(pill('subtitles')).toHaveTextContent('UntertitelAutomatisch: Deutsch (Erzwungen) · SRT');
  });

  it('shows them on an episode page too', async () => {
    serveEpisode();
    setup({ itemId: 'e1' });
    await ready();
    expect(pill('audio')).toBeInTheDocument();
    expect(pill('subtitles')).toBeInTheDocument();
  });

  it('shows none on a series page and none on a season page', async () => {
    serveDetail(server, {
      item: (id) =>
        itemDetail({
          content_id: id,
          type: id === 's1' ? 'series' : 'season',
          versions: [rich()],
          series_id: 's1',
          season_number: 1,
        }),
      seasons: [seasonOf(1), seasonOf(2)],
      episodes: () => [],
    });
    const series = setup({ itemId: 's1' });
    await ready();
    expect(screen.queryByTestId('detail-pills')).toBeNull();
    // A series has no quality badges either, whatever files its item carries.
    expect(screen.queryByTestId('detail-badges')).toBeNull();
    series.unmount();
    setup({ itemId: 'season-1' });
    await ready();
    expect(screen.queryByTestId('detail-pills')).toBeNull();
  });

  it('shows none for a title without a file', async () => {
    serveMovie({ versions: [] });
    setup();
    await ready();
    expect(screen.queryByTestId('detail-pills')).toBeNull();
  });

  it('hides Audio for a file without audio tracks, and keeps Subtitles', async () => {
    serveMovie({ versions: [rich({ audio_tracks: [] })] });
    setup();
    await ready();
    expect(screen.queryByTestId('pill-audio')).toBeNull();
    expect(pill('subtitles')).toBeInTheDocument();
  });

  it('shows the Version pill, with the file selected, only for a title with several files', async () => {
    serveMovie({
      versions: [
        rich({ file_id: 'hd', resolution: '1080p' }),
        rich({ file_id: 'uhd', resolution: '2160p', codec_video: 'hevc', container: 'mkv' }),
      ],
    });
    setup();
    await ready();
    expect(pill('version')).toHaveTextContent('Version2160p · HEVC · EAC3');
    expect(screen.queryByTestId('pill-edition')).toBeNull();
  });

  it('shows the Edition pill, with the current edition, for a title with named editions', async () => {
    const standard = rich({ file_id: 'std', resolution: '1080p' });
    const cut = rich({ file_id: 'cut', resolution: '2160p', edition_key: 'directors_cut' });
    serveMovie({
      versions: [standard, cut],
      playback_variants: [
        { variant_id: 'v1', part_count: 1, parts: [{ part_index: 0, versions: [standard] }] },
        {
          variant_id: 'v2',
          part_count: 1,
          edition_key: 'directors_cut',
          parts: [{ part_index: 0, versions: [cut] }],
        },
      ],
    });
    setup();
    await ready();
    expect(pill('edition')).toHaveTextContent('EditionStandard');
    // Each edition has one file: no version pill.
    expect(screen.queryByTestId('pill-version')).toBeNull();
  });
});

describe('the page and the pills row', () => {
  it('scrolls just far enough to show the whole row while it has the focus, and returns', async () => {
    // jsdom has no layout: the row ends 74 px below a 1080 px screen's bottom safe line.
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const bottom = this.classList.contains('detail-pills') ? 1100 : 0;
        return { top: 0, bottom, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect;
      });
    try {
      serveMovie();
      setup();
      await ready();
      const page = () => document.querySelector<HTMLElement>('.detail-page')!;
      await focusKeyIs('detail-play');
      expect(page().style.transform).toBe('translateY(0px)');
      await pressKey(KEY.down);
      await focusKeyIs('detail-pill-audio');
      await waitFor(() => expect(page().style.transform).toBe('translateY(-74px)'));
      await pressKey(KEY.right);
      expect(page().style.transform).toBe('translateY(-74px)');
      await pressKey(KEY.up);
      await focusKeyIs('detail-play');
      await waitFor(() => expect(page().style.transform).toBe('translateY(0px)'));
    } finally {
      rect.mockRestore();
    }
  });

  it('does not scroll for a row that ends inside the safe area', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
    serveMovie();
    setup();
    await ready();
    await focusPill('audio');
    expect(document.querySelector<HTMLElement>('.detail-page')!.style.transform).toBe(
      'translateY(0px)',
    );
  });
});

describe('the focus on the pills', () => {
  it('goes Down from the buttons onto the pills, and Down again to the first section', async () => {
    serveMovie({ cast: [{ name: 'First Actor', character: 'Fay', order: 0 }] });
    setup();
    await ready();
    await focusPill('subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:0-First Actor');
    await pressKey(KEY.up);
    await focusKeyIs('detail-pill-audio');
    await pressKey(KEY.up);
    await focusKeyIs('detail-play');
  });

  it('goes Down onto the pills from the heart and from the stars, and Up from a pill to Play', async () => {
    serveMovie();
    setup();
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusKeyIs('detail-favorite');
    await pressKey(KEY.down);
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^detail-pill-/));
    await pressKey(KEY.up);
    await focusKeyIs('detail-play');
    // The stars: OK starts picking, Down ends it and goes to the pills.
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusKeyIs('detail-rating');
    await pressKey(KEY.enter);
    await pressKey(KEY.down);
    await waitFor(() => expect(getCurrentFocusKey()).toMatch(/^detail-pill-/));
  });

  it('walks the pills with Left and Right and holds at both ends', async () => {
    serveMovie({
      versions: [rich({ file_id: 'hd' }), rich({ file_id: 'uhd', resolution: '2160p' })],
    });
    setup();
    await ready();
    await focusPill('version', ['version', 'audio', 'subtitles']);
    await pressKey(KEY.left);
    await focusKeyIs('detail-pill-version');
    await pressKey(KEY.right);
    await focusKeyIs('detail-pill-audio');
    await pressKey(KEY.right);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.right);
    await focusKeyIs('detail-pill-subtitles');
  });

  it('opens the list of a pill on OK, and Back closes it onto the same pill', async () => {
    serveMovie();
    setup();
    await ready();
    await focusPill('audio');
    await pressKey(KEY.enter);
    const dialog = await screen.findByTestId('pill-audio-dialog');
    // The list starts on the checked row: Auto.
    await focusKeyIs('detail-audio-auto');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Audio');
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('pill-audio-dialog')).toBeNull());
    await settle();
    await focusKeyIs('detail-pill-audio');
  });

  it('keeps the focus inside the list: Up, Down, Left and Right stop at its ends', async () => {
    serveMovie();
    setup();
    await ready();
    await focusPill('audio');
    await pressKey(KEY.enter);
    await focusKeyIs('detail-audio-auto');
    await pressKey(KEY.up);
    await pressKey(KEY.left);
    await focusKeyIs('detail-audio-auto');
    await pressKey(KEY.down);
    await focusKeyIs('detail-audio-0');
    await pressKey(KEY.down);
    await focusKeyIs('detail-audio-1');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('detail-audio-1');
  });
});

describe('the Audio list', () => {
  const open = async () => {
    await ready();
    fireEvent.click(pill('audio'));
    return screen.findByTestId('pill-audio-dialog');
  };

  it('lists Auto with the track it plays, then every track with its badges and details', async () => {
    serveMovie();
    setup();
    const dialog = await open();
    const rows = within(dialog).getAllByRole('radio');
    expect(rows.map((row) => row.textContent)).toEqual([
      'AutoGerman · EAC3 · 5.1',
      'GermanEAC35.1Default',
      'EnglishTrueHD Atmos7.1English TrueHD Atmos · 7.1 · 4,000 kbps · 48,000 Hz · 24-bit',
    ]);
    // The current choice (Auto) is the one that shows a check.
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('plays the track the server resolved for the profile under Auto', async () => {
    serveMovie({ versions: [rich({ effective_audio_track_index: 1 })] });
    setup();
    await ready();
    expect(pill('audio')).toHaveTextContent('Auto: English · TrueHD Atmos · 7.1');
  });

  it("saves a pick at once as the movie's own preference, shows it without the prefix and closes", async () => {
    serveMovie();
    const writes = serveTrackPrefs(server);
    setup();
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^EnglishTrueHD/));
    expect(pill('audio')).toHaveTextContent('AudioEnglish · TrueHD Atmos · 7.1');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'PUT', group: 'audio-prefs', id: 'm1' });
    expect(writes[0]!.body).toMatchObject({ audio_track_index: 1, audio_language: 'en' });
    await waitFor(() => expect(screen.queryByTestId('pill-audio-dialog')).toBeNull());
    // Open again: the pick is the checked row, and Auto describes what Auto would play.
    fireEvent.click(pill('audio'));
    const again = await screen.findByTestId('pill-audio-dialog');
    expect(
      within(again)
        .getAllByRole('radio')
        .map((row) => row.getAttribute('aria-checked')),
    ).toEqual(['false', 'false', 'true']);
  });

  it("saves an episode's pick under its series", async () => {
    serveEpisode();
    const writes = serveTrackPrefs(server);
    setup({ itemId: 'e1' });
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^EnglishTrueHD/));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'PUT', group: 'audio-prefs', id: 's1' });
  });

  it('forgets the saved track on Auto', async () => {
    serveMovie({ versions: [rich({ effective_audio_track_index: 1 })] });
    const writes = serveTrackPrefs(server);
    setup();
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^German/));
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^Auto/));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ method: 'DELETE', group: 'audio-prefs', id: 'm1' });
    expect(pill('audio')).toHaveTextContent('AudioAuto: English · TrueHD Atmos · 7.1');
  });

  it('takes a pick back when the server did not keep it', async () => {
    serveMovie();
    const writes = serveTrackPrefs(server, { fail: () => true });
    setup();
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^EnglishTrueHD/));
    expect(pill('audio')).toHaveTextContent('AudioEnglish · TrueHD Atmos · 7.1');
    // The save is tried once more after two seconds, then given up.
    await waitFor(() => expect(pill('audio')).toHaveTextContent('AudioAuto: German · EAC3 · 5.1'), {
      timeout: 5000,
    });
    expect(writes).toHaveLength(2);
  });

  it('goes back to the last pick the server kept, not to Auto', async () => {
    serveMovie();
    const writes = serveTrackPrefs(server, {
      fail: (call) => (call.body as { audio_track_index?: number }).audio_track_index === 0,
    });
    setup();
    const first = await open();
    fireEvent.click(rowNamed(first, /^EnglishTrueHD/));
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^German/));
    await waitFor(
      () => expect(pill('audio')).toHaveTextContent('AudioEnglish · TrueHD Atmos · 7.1'),
      {
        timeout: 5000,
      },
    );
  });
});

describe('the Subtitles list', () => {
  const open = async () => {
    await ready();
    fireEvent.click(pill('subtitles'));
    return screen.findByTestId('pill-subtitles-dialog');
  };

  it('lists Auto, Off, then Embedded and External tracks with their badges', async () => {
    serveMovie();
    serveSubtitles(server);
    setup();
    const dialog = await open();
    await waitFor(() => expect(within(dialog).queryByText(/loading/i)).toBeNull());
    expect(
      within(dialog)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['Subs', 'Embedded', 'External']);
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((row) => row.textContent),
    ).toEqual([
      'AutoGerman (Forced) · SRT',
      'Off',
      'EnglishSRTEnglish',
      'GermanSRTForced',
      'FrenchASSfilm.fr.ass',
    ]);
  });

  it('reads the downloaded subtitles when it opens, with a loading line, and lists them last', async () => {
    serveMovie();
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const asked = serveSubtitles(server, {
      gate,
      byFile: {
        'file-1': [
          storedSubtitle({ id: '7', language: 'es', release_name: 'Film.2019.WEB', score: 90 }),
        ],
      },
    });
    setup();
    await ready();
    // Not read before the list opens.
    expect(asked).toEqual([]);
    fireEvent.click(pill('subtitles'));
    const dialog = await screen.findByTestId('pill-subtitles-dialog');
    expect(await within(dialog).findByText('Loading downloaded...')).toBeInTheDocument();
    expect(asked).toEqual(['file-1']);
    release();
    await waitFor(() => expect(within(dialog).queryByText('Loading downloaded...')).toBeNull());
    expect(within(dialog).getByRole('heading', { name: 'Downloaded' })).toBeInTheDocument();
    const last = within(dialog).getAllByRole('radio').at(-1)!;
    expect(last).toHaveTextContent('SpanishSRTFilm.2019.WEB');
  });

  it('says so when there are no subtitles at all', async () => {
    serveMovie({ versions: [rich({ subtitle_tracks: [] })] });
    serveSubtitles(server);
    setup();
    const dialog = await open();
    expect(await within(dialog).findByText('No subtitles available.')).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((row) => row.textContent),
    ).toEqual(['AutoOff', 'Off']);
  });

  it('does not say it while the downloaded ones are still loading', async () => {
    serveMovie({ versions: [rich({ subtitle_tracks: [] })] });
    serveSubtitles(server, { gate: new Promise<void>(() => {}) });
    setup();
    const dialog = await open();
    expect(await within(dialog).findByText('Loading downloaded...')).toBeInTheDocument();
    expect(within(dialog).queryByText('No subtitles available.')).toBeNull();
  });

  it('leaves the downloaded section out when reading them fails', async () => {
    serveMovie();
    serveSubtitles(server, { byFile: 'fail' });
    setup();
    const dialog = await open();
    await waitFor(() => expect(within(dialog).queryByText('Loading downloaded...')).toBeNull());
    expect(within(dialog).queryByRole('heading', { name: 'Downloaded' })).toBeNull();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
  });

  const settingsWrites = (writes: ReturnType<typeof serveTrackPrefs>) =>
    writes.filter((call) => call.group === 'settings');

  it("saves a track as the preference of the movie, with the plan's ordinal and its signature", async () => {
    serveMovie();
    serveSubtitles(server);
    const writes = serveTrackPrefs(server);
    setup();
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^GermanSRT/));
    expect(pill('subtitles')).toHaveTextContent('SubsGerman (Forced) · SRT');
    await waitFor(() => expect(writes).toHaveLength(3));
    const prefs = writes.find((call) => call.group === 'subtitle-prefs')!;
    expect(prefs).toMatchObject({ method: 'PUT', id: 'm1' });
    // The external file counts first (0), then the embedded ones in their order: English 1, German 2.
    expect(prefs.body).toMatchObject({
      subtitle_track_index: 2,
      subtitle_mode: 'always',
      subtitle_language: 'de',
      track_signature: { source: 'embedded', language: 'de', codec: 'subrip', forced: true },
    });
    expect(
      settingsWrites(writes).map((call) => [call.id, (call.body as { value: unknown }).value]),
    ).toEqual([
      ['playback.subtitle_language', 'de'],
      ['playback.subtitle_mode', 'always'],
    ]);
  });

  it("saves an episode's pick under its series", async () => {
    serveEpisode();
    serveSubtitles(server);
    const writes = serveTrackPrefs(server);
    setup({ itemId: 'e1' });
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^EnglishSRT/));
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes.every((call) => call.id === 's1' || call.group === 'settings')).toBe(true);
    expect(writes.find((call) => call.group === 'subtitle-prefs')).toMatchObject({ id: 's1' });
    expect(settingsWrites(writes)[0]!.query.get('series_id')).toBe('s1');
  });

  it('saves Off with mode off and no track', async () => {
    serveMovie();
    serveSubtitles(server);
    const writes = serveTrackPrefs(server);
    setup();
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^Off$/));
    expect(pill('subtitles')).toHaveTextContent('SubsOff');
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes.find((call) => call.group === 'subtitle-prefs')!.body).toMatchObject({
      subtitle_track_index: -1,
      subtitle_mode: 'off',
    });
  });

  it('forgets the saved subtitle on Auto: the preference and the settings rows go', async () => {
    serveMovie();
    serveSubtitles(server);
    const writes = serveTrackPrefs(server, { missingSettings: true });
    setup();
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^Off$/));
    await waitFor(() => expect(writes).toHaveLength(3));
    fireEvent.click(pill('subtitles'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-subtitles-dialog'), /^Auto/));
    await waitFor(() => expect(writes).toHaveLength(6));
    const deletes = writes.slice(3);
    expect(deletes.every((call) => call.method === 'DELETE')).toBe(true);
    expect(deletes.map((call) => call.group).sort()).toEqual([
      'settings',
      'settings',
      'subtitle-prefs',
    ]);
    expect(deletes.find((call) => call.group === 'subtitle-prefs')).toMatchObject({ id: 'm1' });
    expect(pill('subtitles')).toHaveTextContent('SubsAuto: German (Forced) · SRT');
  });

  it('takes a pick back when the server did not keep it', async () => {
    serveMovie();
    serveSubtitles(server);
    serveTrackPrefs(server, { fail: () => true });
    setup();
    const dialog = await open();
    fireEvent.click(rowNamed(dialog, /^GermanSRT/));
    expect(pill('subtitles')).toHaveTextContent('SubsGerman (Forced) · SRT');
    await waitFor(
      () => expect(pill('subtitles')).toHaveTextContent('SubsAuto: German (Forced) · SRT'),
      {
        timeout: 5000,
      },
    );
  });

  it('plays the subtitle the settings pick under Auto: the forced track of the audio language', async () => {
    serveMovie({
      effective_subtitle_language: 'de',
      versions: [rich({ effective_audio_track_index: 0, effective_audio_language: 'de' })],
    });
    setup();
    await ready();
    expect(pill('subtitles')).toHaveTextContent('SubsAuto: German (Forced) · SRT');
  });

  it('shows the saved track instead of Auto, and offers to reset to the profile defaults', async () => {
    serveMovie({
      effective_subtitle_mode: 'always',
      effective_subtitle_language: 'en',
      effective_subtitle_track_signature: {
        source: 'embedded',
        language: 'en',
        codec: 'subrip',
        label: 'English',
        forced: false,
        hearing_impaired: false,
      },
    });
    serveSubtitles(server);
    setup();
    await ready();
    expect(pill('subtitles')).toHaveTextContent('SubsEnglish · SRT');
    fireEvent.click(pill('subtitles'));
    const dialog = await screen.findByTestId('pill-subtitles-dialog');
    const rows = within(dialog).getAllByRole('radio');
    expect(rows[0]).toHaveTextContent('AutoReset to profile defaults');
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
      'false',
    ]);
    // The list starts on the checked row.
    await focusKeyIs('detail-subtitle-embedded:1');
  });

  it('reads the downloaded subtitles before the list opens when the saved track is one of them', async () => {
    serveMovie({
      effective_subtitle_mode: 'always',
      effective_subtitle_language: 'es',
      effective_subtitle_track_signature: {
        source: 'downloaded',
        language: 'es',
        codec: 'srt',
        label: 'Film.2019.WEB (opensubtitles)',
        forced: false,
        hearing_impaired: false,
      },
    });
    const asked = serveSubtitles(server, {
      byFile: {
        'file-1': [storedSubtitle({ id: '7', language: 'es', release_name: 'Film.2019.WEB' })],
      },
    });
    setup();
    await ready();
    await waitFor(() => expect(pill('subtitles')).toHaveTextContent('SubsSpanish · SRT'));
    expect(asked).toEqual(['file-1']);
  });
});

describe('the Version and Edition lists', () => {
  const hd = rich({ file_id: 'hd', resolution: '1080p', duration: 3600, codec_audio: 'aac' });
  const uhd = rich({
    file_id: 'uhd',
    resolution: '2160p',
    codec_video: 'hevc',
    codec_audio: 'truehd',
    duration: 7200,
    hdr: true,
    file_size: 4.5 * 1024 ** 3,
    bitrate: 12300,
    audio_tracks: [
      audioTrack({ language: 'fr', codec: 'truehd', channels: 8, default: true }),
      german,
    ],
    subtitle_tracks: [],
  });

  it('lists the files, the sharpest first, with a range badge and a detail line, and a check on the selected one', async () => {
    serveMovie({ versions: [hd, uhd] });
    setup();
    await ready();
    fireEvent.click(pill('version'));
    const dialog = await screen.findByTestId('pill-version-dialog');
    const rows = within(dialog).getAllByRole('radio');
    expect(rows.map((row) => row.textContent)).toEqual([
      '2160p · HEVC · HDR · TrueHDHDRMKV · 4.5 GB · 12.3 Mbit/s',
      '1080p · H264 · AACMKV · 1 MB · 8 Mbit/s',
    ]);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });

  it('follows a pick: the chips and badges describe the other file, Play starts it, and nothing is saved', async () => {
    serveMovie({ versions: [hd, uhd] });
    const writes = serveTrackPrefs(server);
    const { onPlay } = setup();
    await ready();
    // The sharpest file is the starting one.
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2h 0m');
    expect(screen.getByTestId('detail-badges')).toHaveTextContent('2160PHDRTrueHD');
    fireEvent.click(pill('version'));
    const dialog = await screen.findByTestId('pill-version-dialog');
    fireEvent.click(rowNamed(dialog, /^1080p/));
    await waitFor(() => expect(screen.getByTestId('detail-chips')).toHaveTextContent('1h 0m'));
    expect(screen.getByTestId('detail-badges')).toHaveTextContent('1080PTrueHD Atmos');
    expect(pill('version')).toHaveTextContent('Version1080p · H264 · AAC');
    expect(screen.queryByTestId('pill-version-dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('detail-primary'));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'm1',
      title: 'First Title',
      intent: { kind: 'beginning', fileId: 'hd' },
    });
    await settle();
    expect(writes).toEqual([]);
  });

  it('resets the audio and the subtitle to Auto when another file is picked, and saves nothing', async () => {
    serveMovie({ versions: [hd, uhd] });
    serveSubtitles(server);
    const writes = serveTrackPrefs(server);
    setup();
    await ready();
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^German/));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(pill('audio')).toHaveTextContent('AudioGerman · EAC3 · 5.1');
    fireEvent.click(pill('version'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-version-dialog'), /^1080p/));
    await waitFor(() => expect(pill('audio')).toHaveTextContent('AudioAuto: German · EAC3 · 5.1'));
    expect(pill('subtitles')).toHaveTextContent('SubsAuto: German (Forced) · SRT');
    await settle();
    expect(writes).toHaveLength(1);
  });

  it('reads the downloaded subtitles of the picked file only when the list is opened again', async () => {
    serveMovie({ versions: [hd, uhd] });
    const asked = serveSubtitles(server);
    setup();
    await ready();
    fireEvent.click(pill('subtitles'));
    await screen.findByTestId('pill-subtitles-dialog');
    await waitFor(() => expect(asked).toEqual(['uhd']));
    fireEvent.keyDown(window, { keyCode: KEY.back });
    await waitFor(() => expect(screen.queryByTestId('pill-subtitles-dialog')).toBeNull());
    fireEvent.click(pill('version'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-version-dialog'), /^1080p/));
    await waitFor(() => expect(pill('version')).toHaveTextContent('1080p'));
    await settle();
    expect(asked).toEqual(['uhd']);
    fireEvent.click(pill('subtitles'));
    await screen.findByTestId('pill-subtitles-dialog');
    await waitFor(() => expect(asked).toEqual(['uhd', 'hd']));
  });

  it('lists the editions with their files, picks one by its default file, and follows it', async () => {
    const theatrical = rich({ file_id: 'th', resolution: '1080p', duration: 3000 });
    const extended = rich({
      file_id: 'ext',
      resolution: '2160p',
      duration: 9000,
      edition_key: 'extended',
    });
    serveMovie({
      versions: [theatrical, extended],
      playback_variants: [
        { variant_id: 'v1', part_count: 1, parts: [{ part_index: 0, versions: [theatrical] }] },
        {
          variant_id: 'v2',
          part_count: 1,
          edition_key: 'extended',
          parts: [{ part_index: 0, versions: [extended] }],
        },
      ],
    });
    const { onPlay } = setup();
    await ready();
    expect(pill('edition')).toHaveTextContent('EditionStandard');
    fireEvent.click(pill('edition'));
    const dialog = await screen.findByTestId('pill-edition-dialog');
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((row) => row.textContent),
    ).toEqual(['Standard1080p · H264 · EAC3', 'Extended2160p · H264 · EAC3']);
    fireEvent.click(rowNamed(dialog, /^Extended/));
    await waitFor(() => expect(pill('edition')).toHaveTextContent('EditionExtended'));
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2h 30m');
    fireEvent.click(screen.getByTestId('detail-primary'));
    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({ intent: { kind: 'beginning', fileId: 'ext' } }),
    );
  });
});

describe('what Play starts with', () => {
  const resuming = { user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }) };

  it('names nothing for a page where nothing was picked', async () => {
    serveMovie();
    const { onPlay } = setup();
    await ready();
    fireEvent.click(screen.getByTestId('detail-primary'));
    await waitFor(() =>
      expect(onPlay).toHaveBeenCalledWith({
        contentId: 'm1',
        title: 'First Title',
        intent: { kind: 'beginning' },
      }),
    );
  });

  it('names the audio track with the file whose list it belongs to', async () => {
    serveMovie();
    serveTrackPrefs(server);
    const { onPlay } = setup();
    await ready();
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^EnglishTrueHD/));
    fireEvent.click(screen.getByTestId('detail-primary'));
    await waitFor(() =>
      expect(onPlay).toHaveBeenCalledWith({
        contentId: 'm1',
        title: 'First Title',
        intent: { kind: 'beginning', fileId: 'file-1', audio: { index: 1 } },
      }),
    );
  });

  it('names a subtitle track by its ordinal in the plan, and Off as an empty choice', async () => {
    serveMovie();
    serveSubtitles(server);
    serveTrackPrefs(server);
    const { onPlay } = setup();
    await ready();
    fireEvent.click(pill('subtitles'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-subtitles-dialog'), /^FrenchASS/));
    fireEvent.click(screen.getByTestId('detail-primary'));
    await waitFor(() =>
      expect(onPlay).toHaveBeenLastCalledWith({
        contentId: 'm1',
        title: 'First Title',
        intent: { kind: 'beginning', fileId: 'file-1', subtitle: { index: 0 } },
      }),
    );
    fireEvent.click(pill('subtitles'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-subtitles-dialog'), /^Off$/));
    fireEvent.click(screen.getByTestId('detail-primary'));
    await waitFor(() =>
      expect(onPlay).toHaveBeenLastCalledWith({
        contentId: 'm1',
        title: 'First Title',
        intent: { kind: 'beginning', subtitle: {} },
      }),
    );
  });

  it("names an episode's picks too", async () => {
    serveEpisode();
    serveTrackPrefs(server);
    const { onPlay } = setup({ itemId: 'e1' });
    await ready();
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^EnglishTrueHD/));
    fireEvent.click(screen.getByTestId('detail-primary'));
    await waitFor(() =>
      expect(onPlay).toHaveBeenCalledWith({
        contentId: 'e1',
        title: 'A Show',
        intent: { kind: 'beginning', fileId: 'file-1', audio: { index: 1 } },
      }),
    );
  });

  it('waits for a pick that is still being saved before it starts, then starts with it', async () => {
    serveMovie();
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    serveTrackPrefs(server, { gate });
    const { onPlay } = setup();
    await ready();
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^EnglishTrueHD/));
    fireEvent.click(screen.getByTestId('detail-primary'));
    await settle();
    expect(onPlay).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onPlay).toHaveBeenCalledWith({
        contentId: 'm1',
        title: 'First Title',
        intent: { kind: 'beginning', fileId: 'file-1', audio: { index: 1 } },
      }),
    );
  });

  it('starts anyway after three seconds when a save hangs', async () => {
    serveMovie();
    serveTrackPrefs(server, { gate: new Promise<void>(() => {}) });
    const { onPlay } = setup();
    await ready();
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^EnglishTrueHD/));
    fireEvent.click(screen.getByTestId('detail-primary'));
    await settle();
    expect(onPlay).not.toHaveBeenCalled();
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(1), { timeout: 4000 });
  });

  it('carries the picks into Resume, the resume question and Play from Beginning', async () => {
    serveMovie(resuming);
    serveTrackPrefs(server);
    const { onPlay } = setup();
    await ready();
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^EnglishTrueHD/));
    const picked = { fileId: 'file-1', audio: { index: 1 } };
    // The primary button asks (the title has a resume point and one file): the dialog's choices.
    fireEvent.click(screen.getByTestId('detail-primary'));
    const ask = await screen.findByTestId('resume-dialog');
    fireEvent.click(within(ask).getByRole('button', { name: /^Resume at/ }));
    await waitFor(() =>
      expect(onPlay).toHaveBeenLastCalledWith(
        expect.objectContaining({ intent: { kind: 'resume', ...picked } }),
      ),
    );
    fireEvent.click(screen.getByTestId('detail-primary'));
    fireEvent.click(
      within(await screen.findByTestId('resume-dialog')).getByRole('button', {
        name: 'Play from Beginning',
      }),
    );
    await waitFor(() =>
      expect(onPlay).toHaveBeenLastCalledWith(
        expect.objectContaining({ intent: { kind: 'beginning', ...picked } }),
      ),
    );
  });

  it('carries the picks into "Play from Beginning" of the More menu', async () => {
    serveMovie({
      ...resuming,
      versions: [rich(), rich({ file_id: 'file-2', resolution: '720p' })],
    });
    serveTrackPrefs(server);
    const { onPlay } = setup();
    await ready();
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), /^EnglishTrueHD/));
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(
      within(await screen.findByTestId('more-menu')).getByRole('button', {
        name: 'Play from Beginning',
      }),
    );
    await waitFor(() =>
      expect(onPlay).toHaveBeenLastCalledWith({
        contentId: 'm1',
        title: 'First Title',
        intent: { kind: 'beginning', fileId: 'file-1', audio: { index: 1 } },
      }),
    );
  });
});

describe('the picks and the server', () => {
  const twoFiles = [
    rich({ file_id: 'hd', resolution: '1080p' }),
    rich({ file_id: 'uhd', resolution: '2160p' }),
  ];
  const audioIs = (text: string) => expect(pill('audio')).toHaveTextContent(text);
  const pickAudio = async (name: RegExp) => {
    fireEvent.click(pill('audio'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-audio-dialog'), name));
  };
  const pickVersion = async (name: RegExp) => {
    fireEvent.click(pill('version'));
    fireEvent.click(rowNamed(await screen.findByTestId('pill-version-dialog'), name));
  };
  const index = (call: { body: unknown }) =>
    (call.body as { audio_track_index?: number }).audio_track_index;

  it('reads the item again once a pick is kept', async () => {
    const calls = serveMovie();
    serveTrackPrefs(server);
    setup();
    await ready();
    expect(calls.items).toEqual(['m1']);
    await pickAudio(/^EnglishTrueHD/);
    await waitFor(() => expect(calls.items).toEqual(['m1', 'm1']));
  });

  it('holds the pick of an episode that names no series, and sends nothing', async () => {
    serveEpisode({ series_id: undefined });
    const writes = serveTrackPrefs(server);
    setup({ itemId: 'e1' });
    await ready();
    await pickAudio(/^EnglishTrueHD/);
    await settle();
    audioIs('AudioEnglish · TrueHD Atmos · 7.1');
    expect(writes).toEqual([]);
  });

  it('keeps a newer pick when an older one fails after it was made', async () => {
    serveMovie();
    const writes = serveTrackPrefs(server, { fail: (call) => index(call) === 1 });
    setup();
    await ready();
    await pickAudio(/^EnglishTrueHD/);
    await pickAudio(/^German/);
    // The first save is tried again after two seconds, fails, and the second one then goes out.
    await waitFor(() => expect(writes.map(index)).toEqual([1, 1, 0]), { timeout: 5000 });
    audioIs('AudioGerman · EAC3 · 5.1');
  });

  it('forgets the kept pick with the file: a failed pick on the other file goes back to Auto', async () => {
    serveMovie({ versions: twoFiles });
    serveTrackPrefs(server, { fail: (call) => index(call) === 0 });
    setup();
    await ready();
    await pickAudio(/^EnglishTrueHD/);
    await pickVersion(/^1080p/);
    await waitFor(() => audioIs('AudioAuto: German'));
    await pickAudio(/^German/);
    await waitFor(() => audioIs('AudioAuto: German'), { timeout: 5000 });
    audioIs('Auto:');
  });

  it('does not let a save that lands after a file switch say what the server keeps', async () => {
    serveMovie({ versions: twoFiles });
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const writes = serveTrackPrefs(server, {
      hold: (call) => (index(call) === 1 ? held : undefined),
      fail: (call) => index(call) === 0,
    });
    setup();
    await ready();
    await pickAudio(/^EnglishTrueHD/);
    await pickVersion(/^1080p/);
    release();
    await waitFor(() => expect(writes).toHaveLength(1));
    await pickAudio(/^German/);
    await waitFor(() => audioIs('AudioAuto: German'), { timeout: 5000 });
    audioIs('Auto:');
  });

  it('takes the Auto choice back when forgetting it failed', async () => {
    serveMovie();
    serveTrackPrefs(server, { fail: (call) => call.method === 'DELETE' });
    setup();
    await ready();
    await pickAudio(/^EnglishTrueHD/);
    await pickAudio(/^Auto/);
    audioIs('AudioAuto: German');
    await waitFor(() => audioIs('AudioEnglish · TrueHD Atmos · 7.1'), { timeout: 5000 });
  });

  it('shows the check mark on the checked row only, and outlines only the quiet badges', async () => {
    serveMovie();
    setup();
    await ready();
    fireEvent.click(pill('audio'));
    const dialog = await screen.findByTestId('pill-audio-dialog');
    const rows = within(dialog).getAllByRole('radio');
    expect(rows.map((row) => row.querySelectorAll('.detail-choice-check').length)).toEqual([
      1, 0, 0,
    ]);
    const outlined = (row: HTMLElement) =>
      Array.from(row.querySelectorAll('.detail-choice-badge')).map((badge) =>
        badge.getAttribute('data-outlined'),
      );
    // German: the codec, the channels and the outlined Default badge.
    expect(outlined(rows[1]!)).toEqual(['false', 'false', 'true']);
    expect(outlined(rows[2]!)).toEqual(['false', 'false']);
  });

  it('says how many files an edition has, and picking it names its default file for Play', async () => {
    const sd = rich({ file_id: 'sd', resolution: '720p' });
    const hd = rich({ file_id: 'hd', resolution: '1080p' });
    const uhd = rich({ file_id: 'uhd', resolution: '2160p' });
    serveMovie({
      versions: [sd, hd, uhd],
      playback_variants: [
        { variant_id: 'v1', part_count: 1, parts: [{ part_index: 0, versions: [sd] }] },
        {
          variant_id: 'v2',
          part_count: 1,
          edition_key: 'extended',
          parts: [{ part_index: 0, default_file_id: 'hd', versions: [uhd, hd] }],
        },
      ],
    });
    const { onPlay } = setup();
    await ready();
    fireEvent.click(pill('edition'));
    const dialog = await screen.findByTestId('pill-edition-dialog');
    const rows = within(dialog).getAllByRole('radio');
    expect(rows[1]).toHaveTextContent('Extended2 versions · 1080p');
    expect(rows[0]).not.toHaveTextContent('versions');
    fireEvent.click(rows[1]!);
    await waitFor(() => expect(pill('version')).toHaveTextContent('1080p'));
    fireEvent.click(screen.getByTestId('detail-primary'));
    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({ intent: { kind: 'beginning', fileId: 'hd' } }),
    );
  });
});

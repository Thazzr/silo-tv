import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider, type Language } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import {
  episodeOf,
  fileVersion,
  itemDetail,
  rollup,
  seasonOf,
  serveDetail,
  serveUserActions,
  type DetailServe,
} from '../../test/detailFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import { spoilerValues } from '../../test/spoilerFixtures';
import { PORTRAIT_HASH, stubCanvas } from '../../test/thumbhashFixtures';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';
import { CardPrefsProvider } from '../../ui/media';

// The page of an episode (the web's episode page): hero without a poster, the actions of an
// episode and the "More Episodes" row of its season.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  stubCanvas();
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));

type Screen = { name: 'detail'; target: DetailTarget } | { name: 'player'; request: PlayRequest };

function setup(target: DetailTarget, options: { lang?: Language; queryClient?: QueryClient } = {}) {
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
  const onOpenDetail = vi.fn<(target: DetailTarget) => void>();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => {
          onPlay(request);
          nav.push({ name: 'player', request });
        }}
        onOpenDetail={(next) => {
          onOpenDetail(next);
          nav.push({ name: 'detail', target: next });
        }}
        onOpenPerson={() => undefined}
        onOpenBoxSet={() => undefined}
        onBack={nav.pop}
      />
    ) : (
      <div data-testid="player-stub">{current.request.contentId}</div>
    );
  const view = render(
    <QueryClientProvider client={options.queryClient ?? newQueryClient()}>
      <I18nProvider lang={options.lang ?? 'en'}>
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <CardPrefsProvider>
            <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
          </CardPrefsProvider>
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onPlay, onOpenDetail, ...view };
}

const ready = () => screen.findByTestId('detail-hero');

/**
 * Resolves shortly after the server answers the settings read. Register it before rendering: a
 * check that something is NOT covered by spoiler protection means nothing before that answer.
 */
function settingsAnswered(): Promise<void> {
  return new Promise((resolve) => {
    const onAnswer = ({ request }: { request: Request }) => {
      if (!request.url.includes('/settings/values/effective')) return;
      server.events.removeListener('response:mocked', onAnswer);
      setTimeout(resolve, 80);
    };
    server.events.on('response:mocked', onAnswer);
  });
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const primary = () => screen.getByTestId('detail-primary');
const ROW_KEY = (id: string) => `card:more-episodes:${id}`;
const GRID_KEY = (season: string, id: string) => `gcard:episodes:${season}:${id}`;
const row = () => screen.findByTestId('row-more-episodes');

/** The episode of the page: the second of season 1 of "A Show", watched by nobody. */
const episodePage = (overrides: Partial<Parameters<typeof itemDetail>[0]> = {}) =>
  itemDetail({
    content_id: 'e2',
    type: 'episode',
    title: 'The Second One',
    series_id: 's1',
    series_title: 'A Show',
    season_number: 1,
    episode_number: 2,
    air_date: '2008-01-20',
    runtime: 45,
    overview: 'What happens in this episode.',
    backdrop_url: '/img/e2-still.webp',
    backdrop_thumbhash: PORTRAIT_HASH,
    backdrop_is_episode_still: true,
    versions: [fileVersion({ resolution: '1080p', codec_audio: 'eac3', duration: 3480 })],
    genres: ['Drama'],
    ...overrides,
  });

const siblings: DetailServe['episodes'] = (number) =>
  [1, 2, 3].map((n) =>
    episodeOf(number, n, {
      content_id: `e${n}`,
      title: `Title ${n}`,
      air_date: '2008-01-20',
      overview: `Synopsis ${n}.`,
    }),
  );

const SERIES_OVERVIEW = 'The whole show in a few words.';

function serveEpisode(
  overrides: Partial<Parameters<typeof itemDetail>[0]> = {},
  serve: Partial<DetailServe> = {},
) {
  return serveDetail(server, {
    item: (id) => {
      if (id === 's1') {
        return itemDetail({
          content_id: 's1',
          type: 'series',
          title: 'A Show',
          versions: [],
          overview: SERIES_OVERVIEW,
        });
      }
      return id === 'e2'
        ? episodePage(overrides)
        : itemDetail({ content_id: id, type: 'episode', title: `Page of ${id}`, versions: [] });
    },
    seasons: [seasonOf(1)],
    episodes: siblings,
    ...serve,
  });
}

describe('DetailScreen: the hero of an episode page', () => {
  it('has no poster, shows the still as the large backdrop and no kicker, tagline or subtitle', async () => {
    serveEpisode({ tagline: 'Not shown' });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.queryByTestId('detail-poster')).toBeNull();
    expect(await screen.findByTestId('detail-backdrop')).toHaveAttribute(
      'src',
      `${BASE_URL}/img/e2-still.webp`,
    );
    expect(screen.getByTestId('detail-title')).toHaveTextContent('The Second One');
    expect(screen.queryByTestId('detail-kicker')).toBeNull();
    expect(screen.queryByTestId('detail-tagline')).toBeNull();
    expect(screen.queryByTestId('detail-subtitle')).toBeNull();
  });

  it('shows the path series, season and episode, with the episode as the current page', async () => {
    serveEpisode();
    setup({ itemId: 'e2' });
    await ready();
    const path = screen.getByTestId('detail-breadcrumb');
    expect(path).toHaveTextContent('A ShowSeason 1Episode 2');
    expect(within(path).getByText('Episode 2')).toHaveAttribute('aria-current', 'page');
    expect(within(path).getByText('Season 1')).not.toHaveAttribute('aria-current');
    expect(path.querySelectorAll('button, a, [data-focus-key]')).toHaveLength(0);
  });

  it('writes the path in German', async () => {
    serveEpisode();
    setup({ itemId: 'e2' }, { lang: 'de' });
    await ready();
    expect(screen.getByTestId('detail-breadcrumb')).toHaveTextContent('A ShowStaffel 1Folge 2');
  });

  it("names the season by its own title from the series' season list, else by its number", async () => {
    const calls = serveEpisode({}, { seasons: [seasonOf(1, { title: 'The Beginning' })] });
    setup({ itemId: 'e2' });
    await ready();
    await waitFor(() =>
      expect(screen.getByTestId('detail-breadcrumb')).toHaveTextContent(
        'A ShowThe BeginningEpisode 2',
      ),
    );
    expect(calls.seasons).toEqual(['s1']);
  });

  it('calls the specials Specials in the path', async () => {
    serveEpisode({ season_number: 0 }, { seasons: [seasonOf(0), seasonOf(1)] });
    setup({ itemId: 'e2' });
    await ready();
    await waitFor(() =>
      expect(screen.getByTestId('detail-breadcrumb')).toHaveTextContent('A ShowSpecialsEpisode 2'),
    );
  });

  it('shows the runtime of the selected version and the air date, as chips', async () => {
    serveEpisode();
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('58mJan 20, 2008');
  });

  it('writes the chips the German way', async () => {
    serveEpisode({ versions: [fileVersion({ duration: 3780 })] });
    setup({ itemId: 'e2' }, { lang: 'de' });
    await ready();
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('1 Std. 3 Min.20. Jan. 2008');
  });

  it('leaves out the chip that is missing', async () => {
    serveEpisode({ air_date: undefined });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.getByTestId('detail-chips')).toHaveTextContent(/^58m$/);
  });

  it('leaves out the runtime when there is none', async () => {
    serveEpisode({ versions: [fileVersion({ duration: 0 })], runtime: undefined });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.getByTestId('detail-chips')).toHaveTextContent(/^Jan 20, 2008$/);
  });

  it('shows the quality badges of the selected version and every rating', async () => {
    serveEpisode({
      ratings: [
        { source: 'tmdb', name: 'TMDB', score: 8.5, display: '8.5' },
        { source: 'imdb', name: 'IMDb', score: 9, display: '9.0' },
      ],
    });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.getByTestId('detail-badges')).toHaveTextContent('1080PEAC3');
    expect(screen.getByTestId('detail-ratings')).toHaveTextContent('TMDB 8.5IMDb 9.0');
  });

  it("names the episode's director and writers and no genres", async () => {
    serveEpisode({
      crew: [
        { name: 'Dana Director', job: 'Director' },
        { name: 'Wes Writer', job: 'Writer' },
      ],
    });
    setup({ itemId: 'e2' });
    await ready();
    const credits = screen.getByTestId('detail-credits');
    expect(credits).toHaveTextContent('Directed by Dana Director · Written by Wes Writer');
    expect(credits).not.toHaveTextContent('Drama');
  });

  it('draws no credit line without a director or writer, and no genres in its place', async () => {
    serveEpisode({ crew: [] });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.queryByTestId('detail-credits')).toBeNull();
  });

  it('clamps the synopsis at three lines and opens it in full from More', async () => {
    const long = 'A very long synopsis that goes on. '.repeat(20);
    serveEpisode({ overview: long });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.getByTestId('detail-synopsis')).toHaveStyle({ WebkitLineClamp: '3' });
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The Second One');
    expect(dialog).toHaveTextContent('A very long synopsis that goes on.');
  });

  it("shows the episode's own synopsis and reads the series for nothing", async () => {
    const calls = serveEpisode();
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.getByTestId('detail-synopsis')).toHaveTextContent(
      'What happens in this episode.',
    );
    expect(calls.items).not.toContain('s1');
  });

  it('shows the series description when the episode has none', async () => {
    const calls = serveEpisode({ overview: undefined });
    setup({ itemId: 'e2' });
    await ready();
    expect(await screen.findByTestId('detail-synopsis')).toHaveTextContent(SERIES_OVERVIEW);
    expect(calls.items).toContain('s1');
  });

  it('opens the series description in full from More when it stands in', async () => {
    serveEpisode(
      { overview: undefined },
      {
        item: (id) =>
          id === 's1'
            ? itemDetail({
                content_id: 's1',
                type: 'series',
                title: 'A Show',
                versions: [],
                overview: 'The whole show goes on and on. '.repeat(20),
              })
            : episodePage({ overview: undefined }),
      },
    );
    setup({ itemId: 'e2' });
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('The whole show goes on and on.');
  });

  it('shows no synopsis when neither the episode nor the series has one', async () => {
    serveDetail(server, {
      item: (id) =>
        id === 's1'
          ? itemDetail({ content_id: 's1', type: 'series', versions: [], overview: undefined })
          : episodePage({ overview: undefined }),
      seasons: [seasonOf(1)],
      episodes: siblings,
    });
    setup({ itemId: 'e2' });
    await ready();
    await waitFor(() => expect(screen.getByTestId('detail-actions')).toBeInTheDocument());
    expect(screen.queryByTestId('detail-synopsis')).toBeNull();
    expect(screen.queryByTestId('detail-synopsis-hidden')).toBeNull();
  });

  it('shows no AI mark for the series description that stands in', async () => {
    serveEpisode({ overview: undefined, machine_translated_fields: ['overview'] });
    setup({ itemId: 'e2' });
    await ready();
    await screen.findByTestId('detail-synopsis');
    expect(screen.queryByTestId('detail-translation')).toBeNull();
  });

  it("marks the episode's own AI-translated description", async () => {
    serveEpisode({ machine_translated_fields: ['overview'] });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.getByTestId('detail-translation')).toHaveTextContent('Translated by AI');
  });
});

describe('DetailScreen: the path of an episode page, round 2', () => {
  it("names the season by the episode's own number while the season list lacks it", async () => {
    serveEpisode({ season_number: 2 }, { seasons: [seasonOf(1)] });
    setup({ itemId: 'e2' });
    await ready();
    await waitFor(() => expect(screen.getByTestId('detail-actions')).toBeInTheDocument());
    expect(screen.getByTestId('detail-breadcrumb')).toHaveTextContent('A ShowSeason 2Episode 2');
  });

  it("uses the label of the episode's own season, not the first one in the list", async () => {
    serveEpisode(
      { season_number: 2 },
      { seasons: [seasonOf(1, { title: 'The Beginning' }), seasonOf(2, { title: 'The Middle' })] },
    );
    setup({ itemId: 'e2' });
    await ready();
    await waitFor(() =>
      expect(screen.getByTestId('detail-breadcrumb')).toHaveTextContent(
        'A ShowThe MiddleEpisode 2',
      ),
    );
  });

  it('has one chevron before each crumb after the first', async () => {
    serveEpisode();
    setup({ itemId: 'e2' });
    await ready();
    const path = screen.getByTestId('detail-breadcrumb');
    expect(path.querySelectorAll('svg')).toHaveLength(2);
    expect(path.querySelectorAll('span')).toHaveLength(3);
  });

  it('leaves out the episode crumb for an episode without a number', async () => {
    serveEpisode({ episode_number: undefined });
    setup({ itemId: 'e2' });
    await ready();
    const path = screen.getByTestId('detail-breadcrumb');
    expect(path).toHaveTextContent(/^A ShowSeason 1$/);
    expect(path.querySelectorAll('svg')).toHaveLength(1);
    expect(within(path).getByText('Season 1')).toHaveAttribute('aria-current', 'page');
  });
});

describe('DetailScreen: what an episode page reads', () => {
  it('sends no season or sibling request for an episode without a series', async () => {
    const calls = serveEpisode({ series_id: undefined });
    setup({ itemId: 'e2' });
    await ready();
    await waitFor(() => expect(screen.getByTestId('detail-actions')).toBeInTheDocument());
    expect(calls.seasons).toEqual([]);
    expect(calls.episodes).toEqual([]);
    expect(screen.queryByTestId('row-more-episodes')).toBeNull();
  });

  it('reads no series item for an episode without a series and without a description', async () => {
    const urls: string[] = [];
    server.events.on('request:start', ({ request }) => urls.push(new URL(request.url).pathname));
    const calls = serveEpisode({ series_id: undefined, overview: undefined });
    setup({ itemId: 'e2' });
    await ready();
    await waitFor(() => expect(screen.getByTestId('detail-actions')).toBeInTheDocument());
    server.events.removeAllListeners('request:start');
    expect(calls.items).toEqual(['e2']);
    // Not even a read of an empty id.
    expect(urls.filter((path) => path.startsWith('/api/v2/catalog/items'))).toEqual([
      '/api/v2/catalog/items/e2',
    ]);
    expect(screen.queryByTestId('detail-synopsis')).toBeNull();
  });

  it('reads no series item for a season page without a description', async () => {
    const calls = serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 'season-1',
          type: 'season',
          series_id: 's1',
          series_title: 'A Show',
          season_number: 1,
          overview: undefined,
          versions: [],
        }),
      episodes: siblings,
    });
    setup({ itemId: 'season-1' });
    await screen.findByTestId('episode-grid');
    expect(calls.items).toEqual(['season-1']);
  });

  it('reads no series item for a movie without a description', async () => {
    const calls = serveDetail(server, { item: () => itemDetail({ overview: undefined }) });
    setup({ itemId: 'm1' });
    await ready();
    await waitFor(() => expect(screen.getByTestId('detail-actions')).toBeInTheDocument());
    expect(calls.items).toEqual(['m1']);
  });
});

describe('DetailScreen: spoiler protection on an episode page', () => {
  const protectedSettings = (images: boolean, overviews: boolean) => ({
    values: spoilerValues(images, overviews),
  });

  it('hides the description of an unwatched episode and says so, with no More', async () => {
    serveEpisode({}, { settings: protectedSettings(false, true) });
    setup({ itemId: 'e2' });
    expect(await screen.findByTestId('detail-synopsis-hidden')).toHaveTextContent(
      'Description hidden',
    );
    expect(screen.queryByTestId('detail-synopsis')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('shows the description of a watched episode', async () => {
    serveEpisode(
      { user_data: rollup({ played: true }) },
      { settings: protectedSettings(false, true) },
    );
    setup({ itemId: 'e2' });
    expect(await screen.findByTestId('detail-synopsis')).toHaveTextContent(
      'What happens in this episode.',
    );
    expect(screen.queryByTestId('detail-synopsis-hidden')).toBeNull();
  });

  it('does not hide the series description that stands in for a missing one', async () => {
    serveEpisode({ overview: undefined }, { settings: protectedSettings(false, true) });
    setup({ itemId: 'e2' });
    expect(await screen.findByTestId('detail-synopsis')).toHaveTextContent(SERIES_OVERVIEW);
    expect(screen.queryByTestId('detail-synopsis-hidden')).toBeNull();
  });

  it('shows the decoded preview of the backdrop hash in place of the still and never requests the still', async () => {
    serveEpisode({}, { settings: protectedSettings(true, false) });
    setup({ itemId: 'e2' });
    const covered = await screen.findByTestId('detail-backdrop-protected');
    // The stubbed canvas encodes the decoded hash as `data:image/png;base64,<width>x<height>`.
    expect(covered).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/png;base64,\d+x\d+$/),
    );
    expect(screen.queryByTestId('detail-backdrop')).toBeNull();
    expect(document.querySelector('img[src$="/img/e2-still.webp"]')).toBeNull();
  });

  it('shows a flat colour when the backdrop has no hash', async () => {
    serveEpisode({ backdrop_thumbhash: undefined }, { settings: protectedSettings(true, false) });
    setup({ itemId: 'e2' });
    const covered = await screen.findByTestId('detail-backdrop-protected');
    expect(covered.tagName).toBe('DIV');
    expect(document.querySelector('img[src$="/img/e2-still.webp"]')).toBeNull();
  });

  it('shows the still of a watched episode', async () => {
    const answered = settingsAnswered();
    serveEpisode(
      { user_data: rollup({ played: true }) },
      { settings: protectedSettings(true, false) },
    );
    setup({ itemId: 'e2' });
    await ready();
    await act(async () => {
      await answered;
    });
    expect(screen.getByTestId('detail-backdrop')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-backdrop-protected')).toBeNull();
  });

  it('shows a backdrop that is series artwork, not a still, whatever is unwatched', async () => {
    const answered = settingsAnswered();
    serveEpisode(
      { backdrop_is_episode_still: false },
      { settings: protectedSettings(true, false) },
    );
    setup({ itemId: 'e2' });
    await ready();
    await act(async () => {
      await answered;
    });
    expect(screen.getByTestId('detail-backdrop')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-backdrop-protected')).toBeNull();
  });

  it('draws nothing in place of a still that the episode does not have', async () => {
    const answered = settingsAnswered();
    serveEpisode({ backdrop_url: undefined }, { settings: protectedSettings(true, false) });
    setup({ itemId: 'e2' });
    await ready();
    await act(async () => {
      await answered;
    });
    expect(screen.queryByTestId('detail-backdrop-protected')).toBeNull();
    expect(screen.queryByTestId('detail-backdrop')).toBeNull();
  });

  it('covers no movie backdrop and hides no movie description, though a movie counts as unwatched', async () => {
    const answered = settingsAnswered();
    serveDetail(server, {
      item: () => itemDetail({ backdrop_url: '/img/m1.webp', backdrop_thumbhash: PORTRAIT_HASH }),
      settings: protectedSettings(true, true),
    });
    setup({ itemId: 'm1' });
    await ready();
    await act(async () => {
      await answered;
    });
    expect(screen.getByTestId('detail-backdrop')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-backdrop-protected')).toBeNull();
    expect(screen.getByTestId('detail-synopsis')).toHaveTextContent('A short synopsis.');
    expect(screen.queryByTestId('detail-synopsis-hidden')).toBeNull();
  });

  it('shows the still while protection is off', async () => {
    const answered = settingsAnswered();
    serveEpisode({}, { settings: protectedSettings(false, false) });
    setup({ itemId: 'e2' });
    await ready();
    await act(async () => {
      await answered;
    });
    expect(screen.getByTestId('detail-backdrop')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-backdrop-protected')).toBeNull();
  });
});

describe('DetailScreen: the actions of an episode page', () => {
  it('says Play Episode without progress and plays it from the start, under the series title', async () => {
    serveEpisode();
    const { onPlay } = setup({ itemId: 'e2' });
    await ready();
    expect(primary()).toHaveTextContent('Play Episode');
    expect(screen.queryByTestId('detail-play-fill')).toBeNull();
    fireEvent.click(primary());
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e2',
      title: 'A Show',
      intent: { kind: 'beginning' },
    });
  });

  it('has the German label', async () => {
    serveEpisode();
    setup({ itemId: 'e2' }, { lang: 'de' });
    await ready();
    expect(primary()).toHaveTextContent('Folge abspielen');
  });

  it('says Play with the played share inside, and asks what to do, with progress and one version', async () => {
    serveEpisode({ user_data: rollup({ position_seconds: 870, duration_seconds: 3480 }) });
    const { onPlay } = setup({ itemId: 'e2' });
    await ready();
    expect(primary()).toHaveTextContent(/^Play$/);
    expect(screen.getByTestId('detail-play-fill')).toHaveStyle({ transform: 'scaleX(0.25)' });
    fireEvent.click(primary());
    const dialog = await screen.findByTestId('resume-dialog');
    expect(dialog).toHaveTextContent("You're 14:30 in, about 25% through.");
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume at 14:30' }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e2',
      title: 'A Show',
      intent: { kind: 'resume' },
    });
  });

  it('says Resume and resumes at once with several versions, Play from Beginning in More', async () => {
    serveEpisode({
      versions: [fileVersion(), fileVersion({ file_id: 'file-2', edition_key: 'extended' })],
      user_data: rollup({ position_seconds: 870, duration_seconds: 3480 }),
    });
    const { onPlay } = setup({ itemId: 'e2' });
    await ready();
    expect(primary()).toHaveTextContent('Resume');
    fireEvent.click(primary());
    expect(screen.queryByTestId('resume-dialog')).toBeNull();
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e2',
      title: 'A Show',
      intent: { kind: 'resume' },
    });
  });

  it('offers Play from Beginning in More with several versions', async () => {
    serveEpisode({
      versions: [fileVersion(), fileVersion({ file_id: 'file-2', edition_key: 'extended' })],
      user_data: rollup({ position_seconds: 870, duration_seconds: 3480 }),
    });
    const { onPlay } = setup({ itemId: 'e2' });
    await ready();
    fireEvent.click(button('More actions'));
    const menu = await screen.findByTestId('more-menu');
    fireEvent.click(within(menu).getByRole('button', { name: 'Play from Beginning' }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e2',
      title: 'A Show',
      intent: { kind: 'beginning' },
    });
  });

  it('is disabled for an episode without a file, and the watched toggle takes the focus', async () => {
    serveEpisode({ versions: [] });
    setup({ itemId: 'e2' });
    await ready();
    expect(primary()).toBeDisabled();
    expect(primary()).toHaveTextContent('Play Episode');
    await focusKeyIs('detail-watched');
  });

  it('marks the episode watched, then reads the item, its series, the season and Home again', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    queryClient.setQueryData(['home', 'sections', BASE_URL, 'p1'], []);
    let played = false;
    const calls = serveEpisode(
      {},
      {
        item: (id) =>
          id === 's1'
            ? itemDetail({ content_id: 's1', type: 'series', versions: [], overview: 'x' })
            : episodePage({ user_data: rollup({ played }) }),
      },
    );
    const writes = serveUserActions(server);
    setup({ itemId: 'e2' }, { queryClient });
    await ready();
    await row();
    const before = {
      items: calls.items.length,
      seasons: calls.seasons.length,
      episodes: calls.episodes.length,
    };
    expect(button('Mark Watched')).toBeInTheDocument();
    played = true;
    fireEvent.click(button('Mark Watched'));
    expect(await screen.findByRole('button', { name: 'Mark Unwatched' })).toBeEnabled();
    expect(writes).toEqual([{ method: 'POST', group: 'watched', id: 'e2', body: undefined }]);
    expect(calls.items.length).toBeGreaterThan(before.items);
    expect(calls.seasons.length).toBeGreaterThan(before.seasons);
    expect(calls.episodes.length).toBeGreaterThan(before.episodes);
    expect(queryClient.getQueryState(['home', 'sections', BASE_URL, 'p1'])?.isInvalidated).toBe(
      true,
    );
    expect(screen.getByTestId('detail-notice')).toHaveTextContent('Marked as watched');
  });

  it('marks a watched episode unwatched with a DELETE', async () => {
    serveEpisode({ user_data: rollup({ played: true }) });
    const writes = serveUserActions(server);
    setup({ itemId: 'e2' });
    await ready();
    fireEvent.click(button('Mark Unwatched'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'DELETE', group: 'watched', id: 'e2' });
  });

  it('counts an episode with progress as not watched, and clears the progress from More', async () => {
    serveEpisode({
      user_data: rollup({ played: true, position_seconds: 600, duration_seconds: 3480 }),
    });
    const writes = serveUserActions(server);
    setup({ itemId: 'e2' });
    await ready();
    expect(button('Mark Watched')).toBeInTheDocument();
    fireEvent.click(button('More actions'));
    const menu = await screen.findByTestId('more-menu');
    fireEvent.click(within(menu).getByRole('button', { name: 'Mark Unwatched' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'DELETE', group: 'watched', id: 'e2' });
  });

  it('has no favourite, stars or watchlist, and More only holds what an episode may do', async () => {
    serveEpisode({
      user_state: { in_watchlist: false, is_favorite: false, not_interested: false, played: false },
      user_data: rollup({ position_seconds: 600, duration_seconds: 3480 }),
    });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.queryByRole('button', { name: /^(Favorite|Unfavorite)$/ })).toBeNull();
    expect(screen.queryByTestId('detail-stars')).toBeNull();
    fireEvent.click(button('More actions'));
    const menu = await screen.findByTestId('more-menu');
    expect(
      within(menu)
        .getAllByRole('button')
        .map((el) => el.textContent),
    ).toEqual(['Mark Unwatched']);
  });

  it('has no More button for an episode without progress, even when it carries user state', async () => {
    serveEpisode({
      user_state: { in_watchlist: true, is_favorite: true, not_interested: true, played: false },
    });
    setup({ itemId: 'e2' });
    await ready();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    await focusKeyIs('detail-play');
    await pressKey(KEY.right);
    await focusKeyIs('detail-watched');
    await pressKey(KEY.right);
    await focusKeyIs('detail-watched');
  });

  it('asks for no similar titles and no box set', async () => {
    const calls = serveEpisode();
    setup({ itemId: 'e2' });
    await ready();
    await row();
    expect(calls.similar).toEqual([]);
    expect(calls.boxSets).toEqual([]);
  });
});

describe('DetailScreen: More Episodes on an episode page', () => {
  it('lists every episode of the season under "More Episodes" and reads that season', async () => {
    const calls = serveEpisode();
    setup({ itemId: 'e2' });
    expect(await screen.findByRole('heading', { name: 'More Episodes' })).toBeInTheDocument();
    await row();
    expect(calls.episodes).toContain('s1/1');
    for (const id of ['e1', 'e2', 'e3']) {
      expect(document.querySelector(`[data-focus-key="${ROW_KEY(id)}"]`)).not.toBeNull();
    }
    expect(screen.queryByTestId('episode-grid')).toBeNull();
  });

  it('has the German heading', async () => {
    serveEpisode();
    setup({ itemId: 'e2' }, { lang: 'de' });
    expect(await screen.findByRole('heading', { name: 'Weitere Folgen' })).toBeInTheDocument();
  });

  it('shows no row when the season has only this episode', async () => {
    const calls = serveEpisode({}, { episodes: (n) => [episodeOf(n, 2, { content_id: 'e2' })] });
    setup({ itemId: 'e2' });
    await ready();
    await waitFor(() => expect(calls.episodes).toContain('s1/1'));
    await waitFor(() => expect(screen.getByTestId('detail-actions')).toBeInTheDocument());
    expect(screen.queryByTestId('row-more-episodes')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'More Episodes' })).toBeNull();
  });

  it('shows the row for two episodes', async () => {
    serveEpisode(
      {},
      {
        episodes: (n) => [
          episodeOf(n, 1, { content_id: 'e1' }),
          episodeOf(n, 2, { content_id: 'e2' }),
        ],
      },
    );
    setup({ itemId: 'e2' });
    expect(await row()).toBeInTheDocument();
  });

  it('marks the current episode with a ring, its title in the text colour and a "Now Viewing" badge, and no other', async () => {
    serveEpisode();
    setup({ itemId: 'e2' });
    await row();
    const current = document.querySelector(`[data-focus-key="${ROW_KEY('e2')}"]`)!;
    expect(current).toHaveClass('card-episode-current');
    expect(current.querySelector('.episode-current-ring')).not.toBeNull();
    expect(within(current as HTMLElement).getByTestId('episode-now')).toHaveTextContent(
      'Now Viewing',
    );
    for (const id of ['e1', 'e3']) {
      const other = document.querySelector(`[data-focus-key="${ROW_KEY(id)}"]`)!;
      expect(other).not.toHaveClass('card-episode-current');
      expect(other.querySelector('.episode-current-ring')).toBeNull();
      expect(other.querySelector('[data-testid="episode-now"]')).toBeNull();
    }
    expect(screen.getAllByTestId('episode-now')).toHaveLength(1);
  });

  it('says Aktuell in German', async () => {
    serveEpisode();
    setup({ itemId: 'e2' }, { lang: 'de' });
    await row();
    expect(screen.getByTestId('episode-now')).toHaveTextContent('Aktuell');
  });

  it('draws the caption of the episode grid on each card: code and title, date and runtime, synopsis', async () => {
    serveEpisode(
      {},
      {
        episodes: (n) => [
          episodeOf(n, 1, {
            content_id: 'e1',
            title: 'Title 1',
            air_date: '2008-01-20',
            runtime: 58,
            overview: 'Synopsis 1.',
            user_data: rollup({ played: true }),
          }),
          episodeOf(n, 2, { content_id: 'e2' }),
        ],
      },
    );
    setup({ itemId: 'e2' });
    await row();
    const card = document.querySelector<HTMLElement>(`[data-focus-key="${ROW_KEY('e1')}"]`)!;
    expect(within(card).getByTestId('episode-title')).toHaveTextContent('S01E01 · Title 1');
    expect(within(card).getByTestId('episode-meta')).toHaveTextContent('Jan 20, 2008 · 58m');
    expect(within(card).getByTestId('episode-synopsis')).toHaveTextContent('Synopsis 1.');
    expect(within(card).getByTestId('episode-watched')).toBeInTheDocument();
  });

  it('starts scrolled so that the current episode is in view', async () => {
    serveEpisode(
      { content_id: 'e9', episode_number: 9 },
      {
        item: (id) =>
          id === 's1'
            ? itemDetail({ content_id: 's1', type: 'series', versions: [] })
            : episodePage({ content_id: 'e9', episode_number: 9 }),
        episodes: (n) =>
          Array.from({ length: 12 }, (_, i) => episodeOf(n, i + 1, { content_id: `e${i + 1}` })),
      },
    );
    setup({ itemId: 'e9' });
    const section = await row();
    // Four cards of 370 px fit across; the ninth is the last of them: the first shown is the sixth.
    expect(within(section).getByTestId('row-track').style.transform).toBe('translateX(-1850px)');
    expect(document.querySelector(`[data-focus-key="${ROW_KEY('e9')}"]`)).not.toBeNull();
  });

  it('starts the row on its first card when the current episode is not in the list', async () => {
    serveEpisode(
      {},
      {
        episodes: (n) => [
          episodeOf(n, 1, { content_id: 'e1' }),
          episodeOf(n, 3, { content_id: 'e3' }),
        ],
      },
    );
    setup({ itemId: 'e2' });
    const section = await row();
    expect(within(section).getByTestId('row-track').style.transform).toBe('translateX(0px)');
    expect(screen.queryByTestId('episode-now')).toBeNull();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs(ROW_KEY('e1'));
  });

  it('keeps the focus on the primary button when the page opens', async () => {
    serveEpisode();
    setup({ itemId: 'e2' });
    await row();
    await focusKeyIs('detail-play');
  });

  it('goes Down from the actions onto the current episode, then walks Left and Right', async () => {
    serveEpisode(
      {},
      {
        episodes: (n) =>
          Array.from({ length: 6 }, (_, i) => episodeOf(n, i + 1, { content_id: `e${i + 1}` })),
      },
    );
    setup({ itemId: 'e2' });
    await row();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs(ROW_KEY('e2'));
    await pressKey(KEY.right);
    await focusKeyIs(ROW_KEY('e3'));
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    await focusKeyIs(ROW_KEY('e1'));
    // Up comes back to the pills, and once more to the actions.
    await pressKey(KEY.up);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.up);
    await waitFor(() =>
      expect(screen.getByTestId('detail-actions').contains(document.activeElement)).toBe(true),
    );
  });

  it('enters the row on a later episode when that is the current one', async () => {
    serveEpisode(
      { content_id: 'e5', episode_number: 5 },
      {
        item: (id) =>
          id === 's1'
            ? itemDetail({ content_id: 's1', type: 'series', versions: [] })
            : episodePage({ content_id: 'e5', episode_number: 5 }),
        episodes: (n) =>
          Array.from({ length: 6 }, (_, i) => episodeOf(n, i + 1, { content_id: `e${i + 1}` })),
      },
    );
    setup({ itemId: 'e5' });
    await row();
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs(ROW_KEY('e5'));
  });

  it('opens the page of a sibling on OK and Back returns onto its card', async () => {
    const calls = serveEpisode();
    setup({ itemId: 'e2' });
    await row();
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs(ROW_KEY('e2'));
    await pressKey(KEY.right);
    await focusKeyIs(ROW_KEY('e3'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Page of e3');
    expect(calls.items).toContain('e3');
    await pressKey(KEY.back);
    await row();
    await focusKeyIs(ROW_KEY('e3'));
  });

  it('tells where the sibling sits in the season, so its page replaces this one and the page below can land on it', async () => {
    serveEpisode();
    const { onOpenDetail } = setup({ itemId: 'e2' });
    await row();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs(ROW_KEY('e2'));
    await pressKey(KEY.right);
    await focusKeyIs(ROW_KEY('e3'));
    await pressKey(KEY.enter);
    expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith({
      itemId: 'e3',
      fromSibling: { index: 2 },
    });
    // The new page starts on its own card in the row, not on Play.
    await focusKeyIs(ROW_KEY('e3'));
  });

  it('remembers a card far along a long row when the page comes back from its page', async () => {
    serveEpisode(
      { content_id: 'e1', episode_number: 1 },
      {
        item: (id) =>
          id === 's1'
            ? itemDetail({ content_id: 's1', type: 'series', versions: [] })
            : episodePage({ content_id: id, title: `Page of ${id}`, episode_number: 1 }),
        episodes: (n) =>
          Array.from({ length: 16 }, (_, i) => episodeOf(n, i + 1, { content_id: `e${i + 1}` })),
      },
    );
    setup({ itemId: 'e1' });
    await row();
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs(ROW_KEY('e1'));
    // Eleven cards along: far outside the window the row mounts when it is shown afresh.
    for (let i = 0; i < 11; i += 1) await pressKey(KEY.right);
    await focusKeyIs(ROW_KEY('e12'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Page of e12');
    await pressKey(KEY.back);
    await row();
    await focusKeyIs(ROW_KEY('e12'));
  });

  it('starts the page of a sibling with the focus on its own card in the row, not on Play', async () => {
    serveDetail(server, {
      item: (id) =>
        id === 's1'
          ? itemDetail({ content_id: 's1', type: 'series', versions: [], overview: 'x' })
          : episodePage({
              content_id: id,
              title: `Page of ${id}`,
              episode_number: Number(id.slice(1)),
            }),
      seasons: [seasonOf(1)],
      episodes: siblings,
    });
    setup({ itemId: 'e2' });
    await row();
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs(ROW_KEY('e3'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-breadcrumb')).toHaveTextContent('Episode 3');
    await focusKeyIs(ROW_KEY('e3'));
    // The viewer walks on through the season from there.
    await pressKey(KEY.left);
    await focusKeyIs(ROW_KEY('e2'));
    await pressKey(KEY.up);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.up);
    await focusKeyIs('detail-play');
  });

  it('starts a page that is opened from the season grid on its primary button', async () => {
    serveDetail(server, {
      item: (id) =>
        id === 'season-1'
          ? itemDetail({
              content_id: 'season-1',
              type: 'season',
              title: 'Season 1',
              series_id: 's1',
              series_title: 'A Show',
              season_number: 1,
              versions: [],
            })
          : id === 's1'
            ? itemDetail({ content_id: 's1', type: 'series', versions: [], overview: 'x' })
            : episodePage({ content_id: id, episode_number: Number(id.slice(1)) }),
      seasons: [seasonOf(1)],
      episodes: siblings,
    });
    setup({ itemId: 'season-1' });
    await screen.findByTestId('episode-grid');
    await pressKey(KEY.down);
    await focusKeyIs(GRID_KEY('season-1', 'e1'));
    await pressKey(KEY.enter);
    await row();
    await focusKeyIs('detail-play');
    // Nothing moves the focus afterwards.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(getCurrentFocusKey()).toBe('detail-play');
  });

  it('does nothing on OK for the episode that is on screen', async () => {
    const calls = serveEpisode();
    setup({ itemId: 'e2' });
    await row();
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs(ROW_KEY('e2'));
    await pressKey(KEY.enter);
    expect(calls.items.filter((id) => id === 'e2').length).toBeLessThanOrEqual(1);
    expect(screen.getByTestId('detail-title')).toHaveTextContent('The Second One');
    expect(getCurrentFocusKey()).toBe(ROW_KEY('e2'));
  });

  it('plays a sibling on the Play key, under the series title', async () => {
    serveEpisode();
    const { onPlay } = setup({ itemId: 'e2' });
    await row();
    const card = document.querySelector(`[data-focus-key="${ROW_KEY('e3')}"]`)!;
    fireEvent.keyDown(card, { keyCode: 415 });
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e3',
      title: 'A Show',
      intent: { kind: 'ask' },
    });
  });

  it('goes season page, episode page, sibling page and back, each Back landing on its card', async () => {
    serveDetail(server, {
      item: (id) =>
        id === 'season-1'
          ? itemDetail({
              content_id: 'season-1',
              type: 'season',
              title: 'Season 1',
              series_id: 's1',
              series_title: 'A Show',
              season_number: 1,
              versions: [],
            })
          : id === 's1'
            ? itemDetail({ content_id: 's1', type: 'series', versions: [], overview: 'x' })
            : episodePage({
                content_id: id,
                title: `Page of ${id}`,
                episode_number: Number(id.slice(1)),
              }),
      seasons: [seasonOf(1)],
      episodes: siblings,
    });
    // The cache keeps what the pages read (the default lifetime, unlike newQueryClient's).
    setup(
      { itemId: 'season-1' },
      {
        queryClient: new QueryClient({
          defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
        }),
      },
    );
    await screen.findByTestId('episode-grid');
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs(GRID_KEY('season-1', 'e2'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-breadcrumb')).toHaveTextContent(
      'A ShowSeason 1Episode 2',
    );
    expect(primary()).toHaveTextContent('Play Episode');
    await row();
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs(ROW_KEY('e2'));
    await pressKey(KEY.right);
    await focusKeyIs(ROW_KEY('e3'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-breadcrumb')).toHaveTextContent('Episode 3');
    await pressKey(KEY.back);
    await row();
    await focusKeyIs(ROW_KEY('e3'));
    await pressKey(KEY.back);
    await screen.findByTestId('episode-grid');
    await focusKeyIs(GRID_KEY('season-1', 'e2'));
  });
});

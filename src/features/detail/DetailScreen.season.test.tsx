import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider, type Language } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import {
  episodeOf,
  itemDetail,
  rollup,
  seasonOf,
  serveDetail,
  serveUserActions,
  type DetailServe,
} from '../../test/detailFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';

// The page of a season (the web's season page) and the grid of its episodes.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));

type Screen = { name: 'detail'; target: DetailTarget } | { name: 'player'; request: PlayRequest };

/** The detail page on a screen stack with a stub player; OK on a card opens the next page. */
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
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => {
          onPlay(request);
          nav.push({ name: 'player', request });
        }}
        onOpenDetail={(next) => nav.push({ name: 'detail', target: next })}
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
          <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onPlay, ...view };
}

const ready = () => screen.findByTestId('detail-hero');
const grid = () => screen.findByTestId('episode-grid');
const cardOf = (name: string | RegExp) => screen.getByRole('button', { name });
const GRID_KEY = (id: string) => `gcard:episodes:season-1:${id}`;

const season = (overrides: Partial<Parameters<typeof itemDetail>[0]> = {}) =>
  itemDetail({
    content_id: 'season-1',
    type: 'season',
    title: 'Season 1',
    series_id: 's1',
    series_title: 'A Show',
    season_number: 1,
    air_date: '2008-01-20',
    episode_count: 3,
    overview: 'What happens in the first season.',
    versions: [],
    cast: [],
    ...overrides,
  });
const episodes: DetailServe['episodes'] = (number) =>
  [1, 2, 3].map((n) =>
    episodeOf(number, n, { content_id: `e${n}`, title: `Title ${n}`, air_date: '2008-01-20' }),
  );
const serveSeason = (
  overrides: Partial<Parameters<typeof itemDetail>[0]> = {},
  serve: Partial<DetailServe> = {},
) =>
  serveDetail(server, {
    item: (id) =>
      id === 'season-1'
        ? season(overrides)
        : itemDetail({ content_id: id, type: 'episode', title: `Page of ${id}`, versions: [] }),
    episodes,
    ...serve,
  });

describe('DetailScreen: the hero of a season page', () => {
  it('shows the path, the series title, the chips and the season overview, with the season poster', async () => {
    serveSeason({ poster_url: '/img/season-1.webp' });
    setup({ itemId: 'season-1' });
    await ready();
    const path = screen.getByTestId('detail-breadcrumb');
    expect(path).toHaveTextContent('A ShowSeason 1');
    expect(within(path).getByText('Season 1')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('detail-title')).toHaveTextContent('A Show');
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2008Season 13 episodes');
    expect(screen.getByTestId('detail-synopsis')).toHaveTextContent(
      'What happens in the first season.',
    );
    expect(screen.getByTestId('detail-poster').querySelector('img')).toHaveAttribute(
      'src',
      `${BASE_URL}/img/season-1.webp`,
    );
    // A season has no kicker, tagline, subtitle, quality badges, ratings or credit line.
    expect(screen.queryByTestId('detail-kicker')).toBeNull();
    expect(screen.queryByTestId('detail-tagline')).toBeNull();
    expect(screen.queryByTestId('detail-subtitle')).toBeNull();
    expect(screen.queryByTestId('detail-badges')).toBeNull();
  });

  it('draws no ratings and no credits even when the item carries them', async () => {
    serveSeason({
      ratings: [{ source: 'tmdb', name: 'TMDB', score: 9, display: '9.0' }],
      crew: [{ name: 'Dana Director', job: 'Director' }],
      tagline: 'A tagline',
    });
    setup({ itemId: 'season-1' });
    await ready();
    expect(screen.queryByTestId('detail-ratings')).toBeNull();
    expect(screen.queryByTestId('detail-credits')).toBeNull();
    expect(screen.queryByTestId('detail-tagline')).toBeNull();
  });

  it('has a path that cannot take the focus: Back is the way up', async () => {
    serveSeason();
    setup({ itemId: 'season-1' });
    await ready();
    const path = screen.getByTestId('detail-breadcrumb');
    expect(path.querySelectorAll('button, a, [data-focus-key]')).toHaveLength(0);
  });

  it('puts the season title under the series title only when it is a name, and keeps the numbered chip', async () => {
    serveSeason({ title: 'The Beginning' });
    setup({ itemId: 'season-1' });
    await ready();
    expect(screen.getByTestId('detail-subtitle')).toHaveTextContent('The Beginning');
    expect(screen.getByTestId('detail-subtitle')).not.toHaveClass('detail-tagline');
    expect(screen.getByTestId('detail-breadcrumb')).toHaveTextContent('A ShowThe Beginning');
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2008Season 13 episodes');
  });

  it('calls the specials Specials in the path and the chips, with no subtitle', async () => {
    serveSeason({ title: 'Specials', season_number: 0, is_specials: true });
    setup({ itemId: 'season-1' });
    await ready();
    expect(screen.getByTestId('detail-breadcrumb')).toHaveTextContent('A ShowSpecials');
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2008Specials3 episodes');
    expect(screen.queryByTestId('detail-subtitle')).toBeNull();
  });

  it('writes the season in German', async () => {
    serveSeason({ episode_count: 1 });
    setup({ itemId: 'season-1' }, { lang: 'de' });
    await ready();
    expect(screen.getByTestId('detail-breadcrumb')).toHaveTextContent('A ShowStaffel 1');
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2008Staffel 11 Folge');
  });

  it('counts the loaded episodes when the season carries no count, and leaves out a missing year', async () => {
    serveSeason({ episode_count: undefined, air_date: undefined });
    setup({ itemId: 'season-1' });
    await ready();
    await waitFor(() =>
      expect(screen.getByTestId('detail-chips')).toHaveTextContent('Season 13 episodes'),
    );
    expect(screen.getByTestId('detail-chips').textContent).not.toMatch(/\d{4}/);
  });

  it('shows the logo of the season when the profile wants title art, else the text title', async () => {
    const LOGO = `${BASE_URL}/img/logo.webp`;
    serveSeason({ logo_url: '/img/logo.webp' }, { settings: { values: { 'ui.title_art': true } } });
    const first = setup({ itemId: 'season-1' });
    await ready();
    expect(await screen.findByTestId('detail-logo')).toHaveAttribute('src', LOGO);
    expect(screen.getByTestId('detail-logo')).toHaveAttribute('alt', 'A Show');
    first.unmount();
    serveSeason(
      { logo_url: '/img/logo.webp' },
      { settings: { values: { 'ui.title_art': false } } },
    );
    setup({ itemId: 'season-1' });
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('A Show');
    expect(screen.queryByTestId('detail-logo')).toBeNull();
  });

  it('clamps the season overview at three lines and opens it in full from More', async () => {
    serveSeason({ overview: 'A long season overview. '.repeat(30).trim() });
    setup({ itemId: 'season-1' });
    await ready();
    expect(screen.getByTestId('detail-synopsis')).toHaveStyle({ WebkitLineClamp: '3' });
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    expect(await screen.findByTestId('synopsis-dialog')).toHaveTextContent('A long season');
    expect(screen.getByTestId('synopsis-dialog')).toHaveTextContent('Season 1');
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('synopsis-dialog')).toBeNull());
  });

  it('shows no synopsis for a season without an overview', async () => {
    serveSeason({ overview: undefined });
    setup({ itemId: 'season-1' });
    await ready();
    expect(screen.queryByTestId('detail-synopsis')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('asks for neither similar titles, nor a box set, nor shows a cast row', async () => {
    const calls = serveSeason({ cast: [{ name: 'An Actor', character: 'X', order: 0 }] });
    setup({ itemId: 'season-1' });
    await grid();
    expect(calls.similar).toEqual([]);
    expect(calls.boxSets).toEqual([]);
    expect(screen.queryByRole('heading', { name: 'Cast' })).toBeNull();
  });
});

describe('DetailScreen: the actions of a season page', () => {
  const primary = () => screen.getByTestId('detail-primary');

  it('says Play First Episode (Erste Folge abspielen) and plays the first listed episode from the start', async () => {
    const calls = serveSeason(
      {},
      {
        episodes: (number) => [
          // A resume point of the first episode is ignored, as on the web.
          episodeOf(number, 1, {
            content_id: 'first',
            user_data: rollup({ position_seconds: 900, duration_seconds: 2700 }),
          }),
          episodeOf(number, 2, { content_id: 'second' }),
        ],
      },
    );
    const { onPlay } = setup({ itemId: 'season-1' });
    await waitFor(() => expect(primary()).toHaveTextContent('Play First Episode'));
    expect(primary()).toBeEnabled();
    fireEvent.click(primary());
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'first',
      title: 'A Show',
      intent: { kind: 'beginning' },
    });
    // The season's own page lists the episodes of its season of its series.
    expect(calls.episodes).toEqual(['s1/1']);
  });

  it('has the German label', async () => {
    serveSeason();
    setup({ itemId: 'season-1' }, { lang: 'de' });
    expect(await screen.findByRole('button', { name: 'Erste Folge abspielen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Staffel als gesehen markieren' })).toBeEnabled();
  });

  it('holds the action row back until the first episode is known', async () => {
    serveSeason({}, { episodes: () => new Promise(() => undefined) });
    setup({ itemId: 'season-1' });
    await ready();
    expect(screen.queryByTestId('detail-actions')).toBeNull();
  });

  it('is disabled for a season without episodes, and the watched toggle takes the focus', async () => {
    serveSeason({}, { episodes: () => [] });
    const { onPlay } = setup({ itemId: 'season-1' });
    await waitFor(() => expect(primary()).toBeDisabled());
    await focusKeyIs('detail-watched');
    fireEvent.click(primary());
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('is disabled when the episodes cannot be read', async () => {
    serveSeason({}, { episodes: () => 'fail' });
    setup({ itemId: 'season-1' });
    await screen.findByTestId('episodes-error');
    expect(primary()).toBeDisabled();
  });

  it('has no favourite, rating or watchlist, and no More menu when it has nothing to offer', async () => {
    serveSeason({ user_state: undefined });
    setup({ itemId: 'season-1' });
    await ready();
    await screen.findByTestId('detail-actions');
    expect(screen.queryByRole('button', { name: 'Favorite' })).toBeNull();
    expect(screen.queryByTestId('detail-stars')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    // The row is the primary button and the watched toggle, and Right ends on the toggle.
    await focusKeyIs('detail-play');
    await pressKey(KEY.right);
    await focusKeyIs('detail-watched');
    await pressKey(KEY.right);
    await focusKeyIs('detail-watched');
  });

  it('offers Mark Season Unwatched in More once the season was started, not before', async () => {
    serveSeason({ user_data: rollup({ watched_count: 1, unplayed_count: 2 }) });
    setup({ itemId: 'season-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    const menu = await screen.findByTestId('more-menu');
    const names = within(menu)
      .getAllByRole('button')
      .map((el) => el.textContent);
    expect(names).toEqual(['Mark Season Unwatched']);
    // The toggle itself still marks the rest of the season watched.
    await pressKey(KEY.back);
    expect(await screen.findByRole('button', { name: 'Mark Season Watched' })).toBeInTheDocument();
  });

  it('marks the season watched, then reads the season, its episodes and Home again', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    queryClient.setQueryData(['home', 'sections', BASE_URL, 'p1'], []);
    let played = false;
    const calls = serveSeason({}, {});
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog/items/season-1`, () =>
        HttpResponse.json(season({ user_data: rollup({ played }) })),
      ),
    );
    const writes = serveUserActions(server);
    setup({ itemId: 'season-1' }, { queryClient });
    await grid();
    const before = { items: calls.episodes.length };
    played = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mark Season Watched' }));
    expect(await screen.findByRole('button', { name: 'Mark Season Unwatched' })).toBeEnabled();
    expect(writes).toEqual([{ method: 'POST', group: 'watched', id: 'season-1', body: undefined }]);
    expect(calls.episodes.length).toBeGreaterThan(before.items);
    expect(queryClient.getQueryState(['home', 'sections', BASE_URL, 'p1'])?.isInvalidated).toBe(
      true,
    );
    expect(screen.getByTestId('detail-notice')).toHaveTextContent('Marked as watched');
  });

  it('marks a watched season unwatched with a DELETE', async () => {
    serveSeason({ user_data: rollup({ played: true, watched_count: 3, unplayed_count: 0 }) });
    const writes = serveUserActions(server);
    setup({ itemId: 'season-1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Season Unwatched' }));
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'DELETE', group: 'watched', id: 'season-1', body: undefined },
      ]),
    );
  });
});

describe('DetailScreen: the episode grid of a season page', () => {
  const titles = () => screen.getAllByTestId('episode-title').map((el) => el.textContent);

  it('lists the episodes in the web order with their code, title, date, runtime and synopsis', async () => {
    serveSeason();
    setup({ itemId: 'season-1' });
    await grid();
    expect(screen.getByRole('heading', { name: 'Episodes' })).toBeInTheDocument();
    expect(screen.getByTestId('episodes-head-total')).toHaveTextContent('3 total');
    expect(titles()).toEqual(['S01E01 · Title 1', 'S01E02 · Title 2', 'S01E03 · Title 3']);
    expect(screen.getAllByTestId('episode-meta')[0]?.textContent).toBe('Jan 20, 2008  ·  45m');
    expect(screen.getAllByTestId('episode-synopsis')[1]).toHaveTextContent('Synopsis of 1.2.');
  });

  it('writes the code and the date in German', async () => {
    serveSeason();
    setup({ itemId: 'season-1' }, { lang: 'de' });
    await grid();
    expect(titles()[0]).toBe('S01F01 · Title 1');
    expect(screen.getAllByTestId('episode-meta')[0]?.textContent).toBe('20. Jan. 2008  ·  45 Min.');
  });

  it('pads both numbers and shows a title-less episode by its code alone', async () => {
    serveSeason(
      {},
      {
        episodes: () => [
          episodeOf(2, 7, { title: '', content_id: 'a' }),
          episodeOf(10, 12, { title: 'Long Title', content_id: 'b' }),
        ],
      },
    );
    setup({ itemId: 'season-1' });
    await grid();
    expect(titles()).toEqual(['S02E07', 'S10E12 · Long Title']);
  });

  it('shows the meta line with either part missing', async () => {
    serveSeason(
      {},
      {
        episodes: () => [
          episodeOf(1, 1, { content_id: 'a', air_date: undefined, runtime: 58 }),
          episodeOf(1, 2, { content_id: 'b', air_date: '2008-01-27', runtime: 0 }),
          episodeOf(1, 3, { content_id: 'c', air_date: undefined, runtime: 0 }),
        ],
      },
    );
    setup({ itemId: 'season-1' });
    await grid();
    expect(screen.getAllByTestId('episode-meta').map((el) => el.textContent)).toEqual([
      '58m',
      'Jan 27, 2008',
      '',
    ]);
  });

  it('marks a watched episode with a check beside its title and a started one with a bar', async () => {
    serveSeason(
      {},
      {
        episodes: (n) => [
          episodeOf(n, 1, { content_id: 'a', user_data: rollup({ played: true }) }),
          episodeOf(n, 2, {
            content_id: 'b',
            runtime: 50,
            user_data: rollup({ position_seconds: 750, duration_seconds: 3000 }),
          }),
          episodeOf(n, 3, { content_id: 'c' }),
        ],
      },
    );
    setup({ itemId: 'season-1' });
    await grid();
    expect(screen.getAllByTestId('episode-watched')).toHaveLength(1);
    const first = within(cardOf(/Episode 1.1/));
    expect(first.getByTestId('episode-watched')).toHaveAccessibleName('Watched');
    // The check sits in the caption, on the title line, not over the picture.
    expect(first.getByTestId('episode-watched').closest('.card-caption')).not.toBeNull();
    expect(first.queryByTestId('card-progress')).toBeNull();
    const second = within(cardOf(/Episode 1.2/));
    expect(second.getByTestId('card-progress')).toHaveAttribute(
      'style',
      expect.stringContaining('width: 25%'),
    );
    expect(within(cardOf(/Episode 1.3/)).queryByTestId('card-progress')).toBeNull();
  });

  it('asks for the stills at the size of the card', async () => {
    serveSeason();
    const queries: string[] = [];
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog/series/:id/seasons/:num/episodes`, ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items: [] });
      }),
    );
    setup({ itemId: 'season-1' });
    await screen.findByTestId('episodes-empty');
    expect(queries[0]).toContain('still_width=720');
  });

  it('shows a grid of stills while the episodes load', async () => {
    serveSeason(
      {},
      {
        episodes: async () => {
          await delay(80);
          return [episodeOf(1, 1)];
        },
      },
    );
    setup({ itemId: 'season-1' });
    await ready();
    const skeleton = await screen.findByTestId('episode-skeleton');
    expect(within(skeleton).getAllByTestId('card-skeleton')).toHaveLength(10);
    await grid();
    expect(screen.queryByTestId('episode-skeleton')).toBeNull();
  });

  it('says that the season has no episodes yet, in both languages', async () => {
    serveSeason({}, { episodes: () => [] });
    const view = setup({ itemId: 'season-1' });
    expect(await screen.findByTestId('episodes-empty')).toHaveTextContent(
      'No episodes are available for this season yet.',
    );
    expect(screen.queryByTestId('episode-grid')).toBeNull();
    view.unmount();
    serveSeason({}, { episodes: () => [] });
    setup({ itemId: 'season-1' }, { lang: 'de' });
    expect(await screen.findByTestId('episodes-empty')).toHaveTextContent(
      'Für diese Staffel sind noch keine Folgen verfügbar.',
    );
  });

  it('says so and offers Try again when the episodes cannot be read', async () => {
    let fail = true;
    serveSeason({}, { episodes: (n) => (fail ? 'fail' : [episodeOf(n, 1)]) });
    setup({ itemId: 'season-1' });
    const message = await screen.findByTestId('episodes-error');
    expect(message).toHaveTextContent('The episodes could not be loaded.');
    fail = false;
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await grid();
  });

  it('goes from the actions down into the grid, by rows and columns, and back up', async () => {
    serveSeason(
      {},
      {
        episodes: (n) =>
          Array.from({ length: 12 }, (_, i) => episodeOf(n, i + 1, { content_id: `e${i + 1}` })),
      },
    );
    setup({ itemId: 'season-1' });
    await grid();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs(GRID_KEY('e1'));
    await pressKey(KEY.right);
    await focusKeyIs(GRID_KEY('e2'));
    // Five across: Down lands one row lower, in the same column.
    await pressKey(KEY.down);
    await focusKeyIs(GRID_KEY('e7'));
    await pressKey(KEY.left);
    await focusKeyIs(GRID_KEY('e6'));
    await pressKey(KEY.down);
    await focusKeyIs(GRID_KEY('e11'));
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    await focusKeyIs(GRID_KEY('e1'));
    await pressKey(KEY.up);
    await waitFor(() =>
      expect(screen.getByTestId('detail-actions').contains(document.activeElement)).toBe(true),
    );
  });

  it('opens the page of an episode on OK and Back returns onto its card', async () => {
    const calls = serveSeason();
    setup({ itemId: 'season-1' });
    await grid();
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs(GRID_KEY('e2'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Page of e2');
    expect(calls.items).toContain('e2');
    await pressKey(KEY.back);
    await grid();
    await focusKeyIs(GRID_KEY('e2'));
  });

  it('remembers a card far down a long grid when the page comes back from an episode page', async () => {
    serveSeason(
      {},
      {
        episodes: (n) =>
          Array.from({ length: 40 }, (_, i) => episodeOf(n, i + 1, { content_id: `e${i + 1}` })),
      },
    );
    setup({ itemId: 'season-1' });
    await grid();
    await pressKey(KEY.down);
    await focusKeyIs(GRID_KEY('e1'));
    // Five rows down: that row is far outside the window the grid shows when it is mounted afresh.
    for (let row = 1; row <= 5; row += 1) await pressKey(KEY.down);
    await focusKeyIs(GRID_KEY('e26'));
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Page of e26');
    await pressKey(KEY.back);
    await grid();
    await focusKeyIs(GRID_KEY('e26'));
  });

  it('plays an episode on the Play key, under the series title', async () => {
    serveSeason();
    const { onPlay } = setup({ itemId: 'season-1' });
    await grid();
    fireEvent.keyDown(cardOf(/Title 3/), { keyCode: 415 });
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e3',
      title: 'A Show',
      intent: { kind: 'ask' },
    });
  });

  it('walks series, season and episode and back, each Back landing on the card it came from', async () => {
    serveDetail(server, {
      item: (id) =>
        id === 's1'
          ? itemDetail({ content_id: 's1', type: 'series', title: 'A Show', versions: [] })
          : id === 'season-2'
            ? season({ content_id: 'season-2', season_number: 2, title: 'Season 2' })
            : itemDetail({ content_id: id, type: 'episode', title: `Page of ${id}`, versions: [] }),
      seasons: [seasonOf(1), seasonOf(2), seasonOf(3)],
      episodes: (n) =>
        [1, 2, 3].map((i) => episodeOf(n, i, { content_id: `e${i}`, title: `Title ${i}` })),
    });
    // The cache keeps what the series page read (the default lifetime, unlike newQueryClient's).
    setup(
      { itemId: 's1' },
      {
        queryClient: new QueryClient({
          defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
        }),
      },
    );
    await screen.findByTestId('season-rail');
    await pressKey(KEY.down);
    await focusKeyIs('season:1');
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-breadcrumb')).toHaveTextContent('A ShowSeason 2');
    await grid();
    // The seasons the series page read are still cached, but a season page shows no row of them.
    expect(screen.queryByTestId('season-rail')).toBeNull();
    expect(screen.queryByTestId('detail-seasons')).toBeNull();
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    await focusKeyIs('gcard:episodes:season-2:e2');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Page of e2');
    await pressKey(KEY.back);
    await focusKeyIs('gcard:episodes:season-2:e2');
    await pressKey(KEY.back);
    await screen.findByTestId('season-rail');
    await focusKeyIs('season:2');
  });
});

describe('DetailScreen: a season page, round 2', () => {
  const primary = () => screen.getByTestId('detail-primary');

  it('plays the first listed episode even when the season names a later play target', async () => {
    serveSeason({ play_content_id: 'e3' });
    const { onPlay } = setup({ itemId: 'season-1' });
    await waitFor(() => expect(primary()).toBeEnabled());
    fireEvent.click(primary());
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'e1' }));
  });

  it('sends no seasons request from a season page or from a movie page', async () => {
    const calls = serveSeason();
    const first = setup({ itemId: 'season-1' });
    await grid();
    expect(calls.seasons).toEqual([]);
    first.unmount();
    const movie = serveDetail(server, { item: () => itemDetail({ content_id: 'm1' }) });
    setup({ itemId: 'm1' });
    await ready();
    expect(movie.seasons).toEqual([]);
  });

  it('shows no total in the heading while the episodes load', async () => {
    serveSeason(
      {},
      {
        episodes: async () => {
          await delay(80);
          return [episodeOf(1, 1)];
        },
      },
    );
    setup({ itemId: 'season-1' });
    await screen.findByTestId('episode-skeleton');
    expect(screen.getByTestId('episodes-head')).toBeInTheDocument();
    expect(screen.queryByTestId('episodes-head-total')).toBeNull();
    await grid();
    expect(screen.getByTestId('episodes-head-total')).toHaveTextContent('1 total');
  });

  it('keeps the grid when a later read of the episodes fails', async () => {
    let fail = false;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    serveSeason({}, { episodes: (n) => (fail ? 'fail' : [episodeOf(n, 1)]) });
    setup({ itemId: 'season-1' }, { queryClient });
    await grid();
    fail = true;
    await queryClient.refetchQueries({ queryKey: ['detail', 'episodes'] });
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['detail', 'episodes', BASE_URL, 'p1', 's1', 1])?.status,
      ).toBe('error'),
    );
    expect(screen.getByTestId('episode-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('episodes-error')).toBeNull();
  });

  it('labels the season cards of a German UI Staffel N and Specials, whatever the server titles them', async () => {
    serveDetail(server, {
      item: () => itemDetail({ content_id: 's1', type: 'series', versions: [] }),
      seasons: [
        seasonOf(0, { title: 'Season 0' }),
        seasonOf(1, { title: 'Season 1' }),
        seasonOf(2, { title: '' }),
      ],
      episodes,
    });
    setup({ itemId: 's1' }, { lang: 'de' });
    await screen.findByTestId('season-rail');
    expect(screen.getAllByTestId('season-label').map((el) => el.textContent)).toEqual([
      'Specials',
      'Staffel 1',
      'Staffel 2',
    ]);
  });

  it('has no More button for a season that carries user state but no progress', async () => {
    serveSeason({
      user_state: { in_watchlist: false, is_favorite: false, not_interested: false, played: false },
    });
    setup({ itemId: 'season-1' });
    await screen.findByTestId('detail-actions');
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('walks Right from Watched onto More when there is one, and holds when there is none', async () => {
    serveSeason({ user_data: rollup({ watched_count: 1, unplayed_count: 2 }) });
    const first = setup({ itemId: 'season-1' });
    await focusKeyIs('detail-play');
    await pressKey(KEY.right);
    await focusKeyIs('detail-watched');
    await pressKey(KEY.right);
    await focusKeyIs('detail-menu');
    first.unmount();
    serveSeason();
    setup({ itemId: 'season-1' });
    await focusKeyIs('detail-play');
    await pressKey(KEY.right);
    await focusKeyIs('detail-watched');
    await pressKey(KEY.right);
    await focusKeyIs('detail-watched');
  });

  it('puts the season label on the placeholder of a missing poster', async () => {
    serveSeason({ poster_url: undefined });
    setup({ itemId: 'season-1' }, { lang: 'de' });
    await ready();
    expect(within(screen.getByTestId('detail-poster')).getByTestId('art-tile')).toHaveTextContent(
      'Staffel 1',
    );
  });

  it('titles the synopsis dialog with the season label, not the raw title', async () => {
    serveSeason({ overview: 'A long season overview. '.repeat(30).trim() });
    setup({ itemId: 'season-1' }, { lang: 'de' });
    fireEvent.click(await screen.findByRole('button', { name: 'Mehr' }));
    expect(await screen.findByRole('heading', { name: 'Staffel 1' })).toBeInTheDocument();
  });

  it('adds no subtitle for a title in the viewer language, but one for a real name', async () => {
    serveSeason({ title: 'Staffel 1' });
    const first = setup({ itemId: 'season-1' }, { lang: 'de' });
    await ready();
    expect(screen.queryByTestId('detail-subtitle')).toBeNull();
    first.unmount();
    serveSeason({ title: 'Der Anfang' });
    setup({ itemId: 'season-1' }, { lang: 'de' });
    expect(await screen.findByTestId('detail-subtitle')).toHaveTextContent('Der Anfang');
  });

  it('asks for the box set of a movie only: an episode page sends no box-set request', async () => {
    const calls = serveDetail(server, {
      item: (id) => itemDetail({ content_id: id, type: 'episode', title: 'An episode' }),
      capabilities: { box_sets: true },
      boxSet: 'none',
    });
    setup({ itemId: 'e1' });
    await ready();
    await waitFor(() => expect(calls.capabilities).toBeGreaterThan(0));
    expect(calls.boxSets).toEqual([]);
  });
});

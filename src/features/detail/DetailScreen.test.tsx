import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { getCurrentFocusKey, Navigator, type NavApi } from '../../app/nav';
import { SiloProvider } from '../../app/SiloContext';
import { I18nProvider } from '../../i18n';
import { BASE_URL, account } from '../../test/apiFixtures';
import {
  episodeOf,
  fileVersion,
  itemDetail,
  rollup,
  seasonOf,
  serveDetail,
  type DetailServe,
} from '../../test/detailFixtures';
import { boxSetDetail } from '../../test/boxSetFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, newQueryClient, testDevice } from '../../test/renderFlow';
import type { BoxSetTarget } from '../boxset/boxSetMemory';
import type { PersonTarget } from '../person/personMemory';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));

type Screen =
  | { name: 'detail'; target: DetailTarget }
  | { name: 'player'; request: PlayRequest }
  | { name: 'person'; target: PersonTarget }
  | { name: 'boxSet'; target: BoxSetTarget };

/**
 * The detail page on a screen stack with a stub player: Play and OK on an episode push the stub,
 * "More like this" pushes another detail page, a cast card pushes a stub person page, and Back
 * pops, like the flow does.
 */
function setup(
  target: DetailTarget,
  options: { queryClient?: QueryClient; onBack?: () => void } = {},
) {
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
  const onBack = options.onBack ?? vi.fn();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'boxSet' ? (
      <div data-testid="boxset-stub">
        {current.target.boxSetId}|{current.target.libraryId}|{current.target.boxSetTitle}
      </div>
    ) : current.name === 'person' ? (
      <div data-testid="person-stub">
        {current.target.personId}|{current.target.personName}
      </div>
    ) : current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => {
          onPlay(request);
          nav.push({ name: 'player', request });
        }}
        onOpenDetail={(next) => nav.push({ name: 'detail', target: next })}
        onOpenPerson={(next) => nav.push({ name: 'person', target: next })}
        onOpenBoxSet={(next) => nav.push({ name: 'boxSet', target: next })}
        onBack={() => {
          onBack();
          nav.pop();
        }}
      />
    ) : (
      <div data-testid="player-stub">{current.request.contentId}</div>
    );
  const view = render(
    <QueryClientProvider client={options.queryClient ?? newQueryClient()}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onPlay, onBack, ...view };
}

const ready = () => screen.findByTestId('detail-hero');
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const LONG_TEXT = 'The synopsis goes on and on. '.repeat(20).trim();

describe('DetailScreen: a movie', () => {
  it('shows the title, the facts, the synopsis and Play, and focuses Play', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          backdrop_url: '/img/m1-backdrop.webp',
          ratings: [
            { source: 'imdb', name: 'IMDb', score: 85, display: '8.5' },
            { source: 'tmdb', name: 'TMDB', score: 79, display: '7.9' },
          ],
          crew: [{ name: 'Dana Director', job: 'Director' }],
        }),
    });
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.getByTestId('detail-title')).toHaveTextContent('First Title');
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2019PG-131h 30m');
    expect(screen.getByTestId('detail-ratings')).toHaveTextContent('IMDb 8.5');
    expect(screen.getByTestId('detail-ratings')).toHaveTextContent('TMDB 7.9');
    expect(screen.getByTestId('detail-credits')).toHaveTextContent(
      'Directed by Dana Director · Drama · Mystery · Thriller · Comedy',
    );
    expect(screen.getByTestId('detail-synopsis')).toHaveTextContent('A short synopsis.');
    expect(screen.getByTestId('detail-backdrop')).toHaveAttribute(
      'src',
      `${BASE_URL}/img/m1-backdrop.webp`,
    );
    expect(button('Play')).toBeInTheDocument();
    await focusKeyIs('detail-play');
    expect(screen.getByTestId('detail')).toHaveAttribute('data-transform-scrolled', 'page');
  });

  it('asks for the images at the sizes of the page', async () => {
    let query = new URLSearchParams();
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog/items/:id`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(itemDetail());
      }),
      http.get(`${BASE_URL}/api/v2/recommendations/similar/:id`, () =>
        HttpResponse.json({ items: [] }),
      ),
    );
    setup({ itemId: 'm1' });
    await ready();
    expect(query.get('backdrop_width')).toBe('1920');
    expect(query.get('logo_width')).toBe('880');
    expect(query.get('still_width')).toBe('720');
  });

  it('shows badges only for what the item really has', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          versions: [
            fileVersion({
              resolution: '2160p',
              hdr: true,
              video_tracks: [
                { dv_config_present: true, dv_bl_compat_id_present: false, interlaced: false },
              ],
              audio_tracks: [{ default: true, channels: 6 }],
            }),
          ],
        }),
    });
    setup({ itemId: 'm1' });
    await ready();
    const badges = within(screen.getByTestId('detail-badges'))
      .getAllByRole('listitem')
      .map((el) => el.textContent);
    // The resolution, the range the file's flag says and the audio of the file, in that order.
    expect(badges).toEqual(['2160P', 'HDR', 'AAC']);
  });

  it('has no badge list for a file without quality, and no ratings or credit line for a bare item', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          versions: [fileVersion({ resolution: '', codec_audio: '' })],
          genres: [],
        }),
    });
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.queryByTestId('detail-badges')).toBeNull();
    expect(screen.queryByTestId('detail-ratings')).toBeNull();
    expect(screen.queryByTestId('detail-credits')).toBeNull();
  });

  it('plays from the start when nothing was watched, without a dialog', async () => {
    serveDetail(server);
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    expect(screen.queryByTestId('detail-play-fill')).toBeNull();
    fireEvent.click(button('Play'));
    expect(screen.queryByTestId('resume-dialog')).toBeNull();
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'm1',
      title: 'First Title',
      intent: { kind: 'beginning' },
    });
  });

  it.each([
    ['a position of 30 s or less', { position_seconds: 30, duration_seconds: 5400 }],
    ['a position within 5 s of the end', { position_seconds: 5396, duration_seconds: 5400 }],
    ['no position', { played: true }],
  ])('plays instead of resuming for %s', async (_name, state) => {
    serveDetail(server, { item: () => itemDetail({ user_data: rollup(state) }) });
    setup({ itemId: 'm1' });
    await ready();
    expect(button('Play')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-play-fill')).toBeNull();
  });

  it('cuts a long synopsis and opens the full text from More; Back closes it onto More', async () => {
    serveDetail(server, { item: () => itemDetail({ overview: LONG_TEXT }) });
    setup({ itemId: 'm1' });
    await ready();
    // Up from Play reaches More; OK opens the dialog.
    await focusKeyIs('detail-play');
    await pressKey(KEY.up);
    await focusKeyIs('detail-more');
    await pressKey(KEY.enter);
    const dialog = await screen.findByTestId('synopsis-dialog');
    expect(within(dialog).getByTestId('synopsis-full')).toHaveTextContent(LONG_TEXT);
    expect(within(dialog).getByRole('heading')).toHaveTextContent('First Title');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus(),
    );
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('synopsis-dialog')).toBeNull());
    // The page is still there, and the focus is back on the button that opened the dialog.
    expect(screen.getByTestId('detail-hero')).toBeInTheDocument();
    await focusKeyIs('detail-more');
  });

  it('closes the synopsis with its Close button', async () => {
    serveDetail(server, { item: () => itemDetail({ overview: LONG_TEXT }) });
    setup({ itemId: 'm1' });
    await ready();
    fireEvent.click(button('More'));
    const dialog = await screen.findByTestId('synopsis-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('synopsis-dialog')).toBeNull();
  });

  it('has no More for a short synopsis', async () => {
    serveDetail(server);
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('shows the cast in billing order, and OK on a person with an id opens the person page', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          cast: [
            { name: 'Second Actor', character: 'Sam', order: 1 },
            { name: 'First Actor', character: 'Fay', order: 0, person_id: 'p-1' },
          ],
        }),
    });
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    const names = screen.getAllByTestId('card-title').map((el) => el.textContent);
    expect(names).toEqual(['First Actor', 'Second Actor']);
    expect(screen.getByRole('button', { name: 'First Actor, Fay' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'First Actor, Fay' }));
    // The person's id and name go to the person page, which paints the name at once.
    expect(await screen.findByTestId('person-stub')).toHaveTextContent('p-1|First Actor');
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('does nothing on OK on a cast card without a person id, and shows no note either', async () => {
    serveDetail(server, {
      item: () => itemDetail({ cast: [{ name: 'No Id', character: 'Nell', order: 0 }] }),
    });
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    const card = screen.getByRole('button', { name: 'No Id, Nell' });
    fireEvent.click(card);
    await sleep(50);
    expect(screen.queryByTestId('person-stub')).toBeNull();
    expect(screen.getByTestId('detail-hero')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('comes back from the person page onto the same cast card', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          cast: [
            { name: 'First Actor', character: 'Fay', order: 0, person_id: 'p-1' },
            { name: 'Second Actor', character: 'Sam', order: 1, person_id: 'p-2' },
          ],
        }),
    });
    setup({ itemId: 'm1' });
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:p-1');
    await pressKey(KEY.right);
    await focusKeyIs('card:cast:cast:p-2');
    await pressKey(KEY.enter);
    await screen.findByTestId('person-stub');
    await pressKey(KEY.back);
    await ready();
    await focusKeyIs('card:cast:cast:p-2');
  });

  it('puts the initials on a cast card without a photo', async () => {
    serveDetail(server, {
      item: () => itemDetail({ cast: [{ name: 'Alex Black', character: 'Ann', order: 0 }] }),
    });
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.getByText('AB')).toHaveAttribute('data-testid', 'art-tile');
  });

  it('moves between the buttons, the cast and the similar titles with the arrow keys', async () => {
    serveDetail(server, {
      item: () => itemDetail({ cast: [{ name: 'First Actor', character: 'Fay', order: 0 }] }),
      similar: [catalogItem({ content_id: 'x1', title: 'Similar One' })],
    });
    setup({ itemId: 'm1' });
    await ready();
    await screen.findByRole('button', { name: /Similar One/ });
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:0-First Actor');
    await pressKey(KEY.down);
    await focusKeyIs('card:similar:x1');
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:cast:0-First Actor');
    await pressKey(KEY.up);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.up);
    await focusKeyIs('detail-play');
  });
});

describe('DetailScreen: the hero like the web', () => {
  const listItems = (testId: string) =>
    within(screen.getByTestId(testId))
      .getAllByRole('listitem')
      .map((el) => el.textContent);

  it('draws the kicker with the first studio of a movie, and with no second part without one', async () => {
    serveDetail(server, { item: () => itemDetail({ studios: ['Studio Ponoc', 'Other'] }) });
    const first = setup({ itemId: 'm1' });
    await ready();
    const kicker = screen.getByTestId('detail-kicker');
    expect(kicker).toHaveTextContent('Movie');
    expect(within(kicker).getByText('Studio Ponoc')).toBeInTheDocument();
    expect(kicker).not.toHaveTextContent('Other');
    expect(kicker.querySelector('.detail-kicker-dot')).not.toBeNull();
    first.unmount();

    serveDetail(server);
    setup({ itemId: 'm1' });
    await ready();
    const bare = screen.getByTestId('detail-kicker');
    expect(bare.textContent).toBe('Movie');
    expect(bare.querySelector('.detail-kicker-dot')).toBeNull();
    expect(bare.querySelector('.detail-kicker-name')).toBeNull();
  });

  it('draws the kicker of a series with its first network', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          networks: ['AMC', 'Netflix'],
          versions: [],
        }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 's1' });
    await ready();
    const kicker = screen.getByTestId('detail-kicker');
    expect(kicker).toHaveTextContent('Series');
    expect(within(kicker).getByText('AMC')).toBeInTheDocument();
    expect(kicker).not.toHaveTextContent('Netflix');
  });

  it('shows the tagline under the title when the item has one', async () => {
    serveDetail(server, { item: () => itemDetail({ tagline: 'Every story has a home.' }) });
    const first = setup({ itemId: 'm1' });
    await ready();
    expect(screen.getByTestId('detail-tagline')).toHaveTextContent('Every story has a home.');
    first.unmount();

    serveDetail(server);
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.queryByTestId('detail-tagline')).toBeNull();
  });

  it('puts the chips of a movie before its quality badges in one row, genres in neither', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          versions: [
            fileVersion({
              duration: 6180,
              resolution: '2160p',
              hdr: true,
              video_tracks: [
                {
                  video_range_type: 'HDR10',
                  dv_config_present: false,
                  dv_bl_compat_id_present: false,
                  interlaced: false,
                },
              ],
              codec_audio: 'dts',
            }),
          ],
        }),
    });
    setup({ itemId: 'm1' });
    await ready();
    expect(listItems('detail-chips')).toEqual(['2019', 'PG-13', '1h 43m']);
    expect(listItems('detail-badges')).toEqual(['2160P', 'HDR10', 'DTS']);
    const row = screen.getByTestId('detail-chips').parentElement!;
    expect(row).toBe(screen.getByTestId('detail-badges').parentElement);
    expect(row).not.toHaveTextContent('Drama');
  });

  it('still draws the badge row for a movie with no year, rating or runtime', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          year: undefined,
          content_rating: undefined,
          runtime: undefined,
          versions: [fileVersion({ duration: 0, resolution: '2160p', codec_audio: 'dts' })],
        }),
    });
    setup({ itemId: 'm1' });
    await ready();
    expect(listItems('detail-badges')).toEqual(['2160P', 'DTS']);
    expect(screen.getByTestId('detail-chips').children).toHaveLength(0);
  });

  it('counts the seasons and episodes of a series once the season list is there, with no badges', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          year: 2008,
          first_air_date: '2008-01-20',
          last_air_date: '2013-09-29',
          content_rating: '18',
        }),
      seasons: [seasonOf(1, { episode_count: 7 }), seasonOf(2, { episode_count: 13 })],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 's1' });
    await ready();
    await waitFor(() =>
      expect(listItems('detail-chips')).toEqual(['2008–2013', '18', '2 seasons', '20 episodes']),
    );
    expect(screen.queryByTestId('detail-badges')).toBeNull();
  });

  it('shows every rating of the server as text, in its order', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          ratings: [
            { source: 'imdb', name: 'IMDb', score: 85, display: '8.5' },
            { source: 'tmdb', name: 'TMDB', score: 79, display: '7.9' },
            { source: 'rt', name: 'RT', score: 93, display: '93%' },
            { source: 'x', name: 'Extra', score: 10, display: '1.0' },
          ],
        }),
    });
    setup({ itemId: 'm1' });
    await ready();
    expect(listItems('detail-ratings')).toEqual(['IMDb 8.5', 'TMDB 7.9', 'RT 93%', 'Extra 1.0']);
    expect(screen.getByTestId('detail-ratings').querySelector('img, svg')).toBeNull();
  });

  it('draws the credit line with muted labels, brighter names and a dot between the pieces', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          genres: ['Drama', 'Crime'],
          crew: [
            { name: 'Dana Director', job: 'Director' },
            { name: 'Wen Writer', job: 'Writer' },
          ],
        }),
    });
    setup({ itemId: 'm1' });
    await ready();
    const line = screen.getByTestId('detail-credits');
    expect(line.textContent).toBe(
      'Directed by Dana Director · Written by Wen Writer · Drama · Crime',
    );
    expect(line.querySelectorAll('.detail-credit-label')).toHaveLength(2);
    expect(line.querySelectorAll('.detail-credit-sep')).toHaveLength(2);
  });

  it('cuts a movie synopsis at six lines and a series synopsis at three', async () => {
    // Between three and six lines of text: only the series is cut.
    const text = 'Some words of the synopsis. '.repeat(9).trim();
    serveDetail(server, { item: () => itemDetail({ overview: text }) });
    const movie = setup({ itemId: 'm1' });
    await ready();
    expect(screen.getByTestId('detail-synopsis').getAttribute('style')).toContain('line-clamp: 6');
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    movie.unmount();

    serveDetail(server, {
      item: () => itemDetail({ content_id: 's1', type: 'series', versions: [], overview: text }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 's1' });
    await ready();
    expect(screen.getByTestId('detail-synopsis').getAttribute('style')).toContain('line-clamp: 3');
    expect(button('More')).toBeInTheDocument();
  });

  it('shows the poster, asked for at the size of the page', async () => {
    let query = new URLSearchParams();
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog/items/:id`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(itemDetail({ poster_url: '/img/m1-poster.webp' }));
      }),
      http.get(`${BASE_URL}/api/v2/recommendations/similar/:id`, () =>
        HttpResponse.json({ items: [] }),
      ),
    );
    setup({ itemId: 'm1' });
    await ready();
    const poster = screen.getByTestId('detail-poster');
    expect(poster.querySelector('img')).toHaveAttribute('src', `${BASE_URL}/img/m1-poster.webp`);
    expect(query.get('poster_width')).toBe('352');
  });

  it('shows the title on a tile in place of a missing poster', async () => {
    serveDetail(server);
    setup({ itemId: 'm1' });
    await ready();
    const poster = screen.getByTestId('detail-poster');
    expect(poster.querySelector('img')).toBeNull();
    expect(within(poster).getByTestId('art-tile')).toHaveTextContent('First Title');
  });

  it('fades the poster with the text column once the focus has left the hero', async () => {
    serveDetail(server, {
      item: () => itemDetail({ cast: [{ name: 'First Actor', character: 'Fay', order: 0 }] }),
    });
    setup({ itemId: 'm1' });
    await ready();
    const column = screen.getByTestId('detail-hero').querySelector('.detail-text');
    expect(column).toHaveAttribute('data-faded', 'false');
    expect(screen.getByTestId('detail-poster')).toHaveAttribute('data-faded', 'false');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:0-First Actor');
    await waitFor(() =>
      expect(screen.getByTestId('detail-poster')).toHaveAttribute('data-faded', 'true'),
    );
    expect(column).toHaveAttribute('data-faded', 'true');
  });
});

describe('DetailScreen: the pointer', () => {
  it('focuses a hovered element of a lower block without moving the page; the next key does', async () => {
    // jsdom has no layout: give the blocks below the hero a top, so the page has somewhere to go.
    const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-zone') ? 900 : 0;
    });
    try {
      serveDetail(server, {
        item: () => itemDetail({ cast: [{ name: 'First Actor', character: 'Fay', order: 0 }] }),
        similar: [catalogItem({ content_id: 'x1', title: 'Similar One' })],
      });
      setup({ itemId: 'm1' });
      await ready();
      const similar = await screen.findByRole('button', { name: /Similar One/ });
      await focusKeyIs('detail-play');
      const page = () => document.querySelector<HTMLElement>('.detail-page')!;
      expect(page().style.transform).toBe('translateY(0px)');
      fireEvent.mouseEnter(similar);
      await focusKeyIs('card:similar:x1');
      await act(async () => {});
      expect(page().style.transform).toBe('translateY(0px)');
      expect(document.querySelector('[data-zone="cast"]')).toHaveAttribute('data-faded', 'false');
      // Up to the cast row is a key press: the page scrolls to it.
      await pressKey(KEY.up);
      await focusKeyIs('card:cast:cast:0-First Actor');
      expect(page().style.transform).toBe('translateY(-846px)');
    } finally {
      top.mockRestore();
    }
  });
});

describe('DetailScreen: more like this', () => {
  const similar = [
    catalogItem({ content_id: 'x1', title: 'Similar One' }),
    catalogItem({ content_id: 'x2', title: 'Similar Two' }),
  ];

  it('asks for twelve titles after the page and shows them as cards', async () => {
    const calls = serveDetail(server, { similar });
    setup({ itemId: 'm1' });
    await ready();
    expect(await screen.findByRole('button', { name: /Similar One/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'More like this' })).toBeInTheDocument();
    expect(calls.similar[0]?.id).toBe('m1');
    expect(calls.similar[0]?.query.get('limit')).toBe('12');
  });

  it('removes the row when the read fails or has nothing', async () => {
    serveDetail(server, { similar: 'fail' });
    const { unmount } = setup({ itemId: 'm1' });
    await ready();
    await sleep(50);
    expect(screen.queryByRole('heading', { name: 'More like this' })).toBeNull();
    unmount();
    serveDetail(server, { similar: [] });
    setup({ itemId: 'm1' });
    await ready();
    await sleep(50);
    expect(screen.queryByRole('heading', { name: 'More like this' })).toBeNull();
  });

  it('opens the detail page of a similar title over this one, and Back returns onto its card', async () => {
    const calls = serveDetail(server, {
      similar,
      item: (id) =>
        itemDetail({ content_id: id, title: id === 'm1' ? 'First Title' : 'Other Title' }),
    });
    setup({ itemId: 'm1' });
    await ready();
    await screen.findByRole('button', { name: /Similar One/ });
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:similar:x1');
    await pressKey(KEY.right);
    await focusKeyIs('card:similar:x2');
    await pressKey(KEY.enter);
    await waitFor(() =>
      expect(screen.getByTestId('detail-title')).toHaveTextContent('Other Title'),
    );
    expect(calls.items).toEqual(['m1', 'x2']);
    await focusKeyIs('detail-play');

    await pressKey(KEY.back);
    await waitFor(() =>
      expect(screen.getByTestId('detail-title')).toHaveTextContent('First Title'),
    );
    await focusKeyIs('card:similar:x2');
  });
});

describe('DetailScreen: the box set row of a movie', () => {
  const films = [
    catalogItem({ content_id: 'f0', title: 'Prequel', year: 1999 }),
    catalogItem({ content_id: 'm1', title: 'First Title', year: 2001 }),
    catalogItem({ content_id: 'f2', title: 'Sequel', year: 2003 }),
  ];
  const box = boxSetDetail({ items: films, movie_count: 3, backdrop_url: '/img/saga.webp' });
  const withBox = {
    capabilities: { box_sets: true },
    boxSet: box,
    similar: [catalogItem({ content_id: 'x1', title: 'Similar One' })],
  } satisfies DetailServe;

  it('shows the films of the box set under its title, before More like this', async () => {
    const calls = serveDetail(server, withBox);
    setup({ itemId: 'm1' });
    await ready();
    const row = await screen.findByTestId('row-boxset');
    expect(within(row).getByRole('heading', { name: 'Great Saga Box Set' })).toBeInTheDocument();
    expect(
      within(row)
        .getAllByTestId('card-title')
        .map((el) => el.textContent),
    ).toEqual(['Prequel', 'First Title', 'Sequel']);
    // Before "More like this": the box set's zone comes first in the page.
    await screen.findByTestId('row-similar');
    expect(
      row.compareDocumentPosition(screen.getByTestId('row-similar')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The movie's page does not say which library; the server picks it.
    expect(calls.boxSets).toHaveLength(1);
    expect(calls.boxSets[0]!.id).toBe('m1');
    expect(calls.boxSets[0]!.query.has('library_id')).toBe(false);
    expect(calls.boxSets[0]!.query.get('poster_width')).toBe('352');
  });

  it('marks the film on screen with THIS FILM, and only that one', async () => {
    serveDetail(server, withBox);
    setup({ itemId: 'm1' });
    await ready();
    const row = await screen.findByTestId('row-boxset');
    const pills = within(row).getAllByTestId('card-pill-start');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveTextContent('THIS FILM');
    expect(pills[0]!.closest('button')).toHaveAccessibleName(/First Title/);
  });

  it('ends with Explore all, which opens the box set page with its library, title and backdrop', async () => {
    serveDetail(server, withBox);
    setup({ itemId: 'm1' });
    await ready();
    await screen.findByTestId('row-boxset');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:boxset:f0');
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusKeyIs('card:boxset:explore');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('boxset-stub')).toHaveTextContent(
      'bs-1|lib-1|Great Saga Box Set',
    );

    // Back: the movie's page with Explore all focused.
    await pressKey(KEY.back);
    await ready();
    await focusKeyIs('card:boxset:explore');
  });

  it('opens the detail page of another film, and does nothing on OK on the film on screen', async () => {
    const calls = serveDetail(server, {
      ...withBox,
      item: (id) => itemDetail({ content_id: id, title: id === 'm1' ? 'First Title' : id }),
    });
    setup({ itemId: 'm1' });
    await ready();
    await screen.findByTestId('row-boxset');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:boxset:f0');
    await pressKey(KEY.right);
    await focusKeyIs('card:boxset:m1');
    await pressKey(KEY.enter);
    await sleep(50);
    // Still the same page, and no read of another title.
    expect(screen.getByTestId('detail-title')).toHaveTextContent('First Title');
    expect(calls.items).toEqual(['m1']);
    expect(screen.queryByTestId('boxset-stub')).toBeNull();

    await pressKey(KEY.right);
    await focusKeyIs('card:boxset:f2');
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.getByTestId('detail-title')).toHaveTextContent('f2'));
    expect(calls.items).toEqual(['m1', 'f2']);
  });

  it('shows at most 20 films before Explore all', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      catalogItem({ content_id: `g${i}`, title: `Film ${i}` }),
    );
    serveDetail(server, { ...withBox, boxSet: boxSetDetail({ items: many, movie_count: 25 }) });
    setup({ itemId: 'm1' });
    await ready();
    await screen.findByTestId('row-boxset');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:boxset:g0');
    // Right 20 times from the first film is the Explore all card, and there is nothing beyond it.
    for (let i = 0; i < 20; i += 1) await pressKey(KEY.right);
    await focusKeyIs('card:boxset:explore');
    expect(screen.queryByRole('button', { name: /Film 20/ })).toBeNull();
  });

  it('is a zone of the page: the cast above it fades while the focus is in the row', async () => {
    serveDetail(server, {
      ...withBox,
      item: () => itemDetail({ cast: [{ name: 'First Actor', character: 'Fay', order: 0 }] }),
    });
    setup({ itemId: 'm1' });
    await ready();
    await screen.findByTestId('row-boxset');
    const zone = (name: string) => document.querySelector(`[data-zone="${name}"]`)!;
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('detail-pill-subtitles');
    await pressKey(KEY.down);
    await focusKeyIs('card:cast:cast:0-First Actor');
    expect(zone('boxSet')).toHaveAttribute('data-faded', 'false');
    await pressKey(KEY.down);
    await focusKeyIs('card:boxset:f0');
    expect(zone('cast')).toHaveAttribute('data-faded', 'true');
    expect(zone('boxSet')).toHaveAttribute('data-faded', 'false');
    expect(zone('similar')).toHaveAttribute('data-faded', 'false');
    await pressKey(KEY.down);
    await focusKeyIs('card:similar:x1');
    expect(zone('boxSet')).toHaveAttribute('data-faded', 'true');
  });

  it('asks nothing about box sets, and shows no row, when the server has none', async () => {
    const calls = serveDetail(server, {
      capabilities: { box_sets: false },
      boxSet: box,
    });
    setup({ itemId: 'm1' });
    await ready();
    await waitFor(() => expect(calls.capabilities).toBe(1));
    await sleep(50);
    expect(calls.boxSets).toHaveLength(0);
    expect(screen.queryByTestId('row-boxset')).toBeNull();
  });

  it('asks nothing about box sets when the capabilities cannot be read', async () => {
    const calls = serveDetail(server, { capabilities: 'fail', boxSet: box });
    setup({ itemId: 'm1' });
    await ready();
    await waitFor(() => expect(calls.capabilities).toBeGreaterThanOrEqual(1));
    await sleep(50);
    expect(calls.boxSets).toHaveLength(0);
    expect(screen.queryByTestId('row-boxset')).toBeNull();
  });

  it('shows no row for a movie in no box set, or when the read fails', async () => {
    const calls = serveDetail(server, { capabilities: { box_sets: true }, boxSet: 'none' });
    const { unmount } = setup({ itemId: 'm1' });
    await ready();
    await waitFor(() => expect(calls.boxSets).toHaveLength(1));
    await sleep(50);
    expect(screen.queryByTestId('row-boxset')).toBeNull();
    unmount();
    serveDetail(server, { capabilities: { box_sets: true }, boxSet: 'fail' });
    setup({ itemId: 'm1' });
    await ready();
    await sleep(50);
    expect(screen.queryByTestId('row-boxset')).toBeNull();
  });

  it('asks nothing about a box set for a series', async () => {
    const calls = serveDetail(server, {
      capabilities: { box_sets: true },
      boxSet: box,
      item: () => itemDetail({ type: 'series', content_id: 's1' }),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: 's1' });
    await ready();
    await waitFor(() => expect(calls.capabilities).toBe(1));
    await sleep(50);
    expect(calls.boxSets).toHaveLength(0);
    expect(screen.queryByTestId('row-boxset')).toBeNull();
  });
});

describe('DetailScreen: loading and errors', () => {
  it('shows a skeleton of the page while the item loads', async () => {
    serveDetail(server, {
      item: () => itemDetail(),
    });
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog/items/:id`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json(itemDetail());
      }),
    );
    setup({ itemId: 'm1' });
    expect(screen.getByTestId('detail-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('row-skeleton')).toBeInTheDocument();
    // The poster stands where the poster goes, beside the text column.
    const row = screen.getByTestId('detail-skeleton').querySelector('.detail-hero-row');
    expect(row).not.toBeNull();
    expect(row!.querySelector(':scope > .detail-poster')).not.toBeNull();
    expect(row!.querySelector(':scope > .detail-text')).not.toBeNull();
    await ready();
    expect(screen.queryByTestId('detail-skeleton')).toBeNull();
  });

  it('asks for a title that is gone exactly once', async () => {
    const calls = serveDetail(server, { item: () => 'gone' });
    setup({ itemId: 'gone' });
    await screen.findByTestId('detail-gone');
    await sleep(150);
    expect(calls.items).toEqual(['gone']);
  });

  it('says the title is no longer available on a 404 and Back leaves the page', async () => {
    serveDetail(server, { item: () => 'gone' });
    const { onBack } = setup({ itemId: 'gone' });
    const message = await screen.findByTestId('detail-gone');
    expect(message).toHaveTextContent('This title is no longer available');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await focusKeyIs('detail-retry');
    fireEvent.click(within(message).getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('offers Try again on another error, and recovers', async () => {
    let fail = true;
    const calls = serveDetail(server, { item: () => (fail ? 'fail' : itemDetail()) });
    setup({ itemId: 'm1' });
    const message = await screen.findByTestId('detail-error');
    const failedReads = calls.items.length;
    expect(message).toHaveTextContent('This page could not be loaded.');
    await focusKeyIs('detail-retry');
    fail = false;
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await ready();
    expect(calls.items).toHaveLength(failedReads + 1);
  });

  it('reads the item again when the page comes back from the player, and the buttons follow', async () => {
    let position = 754;
    const calls = serveDetail(server, {
      item: () =>
        itemDetail({ user_data: rollup({ position_seconds: position, duration_seconds: 5400 }) }),
    });
    // Cached and never stale: only an explicit read on return can update the page.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
      },
    });
    setup({ itemId: 'm1' }, { queryClient });
    await ready();
    await screen.findByTestId('detail-play-fill');
    fireEvent.click(button('Play'));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume at 12:34' }));
    await screen.findByTestId('player-stub');
    // The viewer watched it to the end meanwhile.
    position = 0;
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('detail-play-fill')).toBeNull());
    expect(button('Play')).toBeInTheDocument();
    expect(calls.items).toHaveLength(2);
    // The button the viewer used has the focus again.
    await focusKeyIs('detail-play');
  });
});

describe('DetailScreen: a series', () => {
  const seasons = [seasonOf(2), seasonOf(0), seasonOf(1)];
  const series = (overrides: Partial<Parameters<typeof itemDetail>[0]> = {}) =>
    itemDetail({
      content_id: 's1',
      type: 'series',
      title: 'A Show',
      season_count: 2,
      versions: [],
      ...overrides,
    });
  const seasonItem = (number: number) =>
    itemDetail({
      content_id: `season-${number}`,
      type: 'season',
      title: `Season ${number}`,
      series_id: 's1',
      series_title: 'A Show',
      season_number: number,
      episode_count: 3,
      versions: [],
    });
  /** The series, or the season page a season card opens. */
  const item = (id: string) => (id === 's1' ? series() : seasonItem(Number(id.split('-')[1])));
  const episodes: DetailServe['episodes'] = (season) =>
    season === 0
      ? [episodeOf(0, 1, { title: 'Special' })]
      : [1, 2, 3].map((number) => episodeOf(season, number));
  const labels = () => screen.getAllByTestId('season-label').map((el) => el.textContent);
  const card = (name: string | RegExp) => screen.getByRole('button', { name });
  const inActions = () =>
    screen.getByTestId('detail-actions').contains(document.activeElement as Node);

  it('shows the seasons as a row of cards, the specials first, and no episode grid', async () => {
    const calls = serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await ready();
    await screen.findByTestId('season-rail');
    expect(labels()).toEqual(['Specials', 'Season 1', 'Season 2']);
    expect(screen.getByRole('heading', { name: 'Seasons' })).toBeInTheDocument();
    expect(screen.getByTestId('seasons-head-total')).toHaveTextContent('3 total');
    expect(screen.queryByTestId('episode-grid')).toBeNull();
    expect(calls.seasons).toEqual(['s1']);
    // Only the episode "Play" needs is read: no season is listed on the series page.
    expect(calls.episodes).toEqual(['s1/1']);
    // The chips count the seasons and the episodes of the season list instead of a runtime.
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2019PG-133 seasons9 episodes');
  });

  it('draws the label, the count, the watched check and the progress bar of each season', async () => {
    serveDetail(server, {
      item: () => series(),
      seasons: [
        seasonOf(1, {
          episode_count: 7,
          user_data: rollup({ played: true, watched_count: 7, unplayed_count: 0 }),
        }),
        seasonOf(2, {
          episode_count: 8,
          title: 'The Rising',
          user_data: rollup({ watched_count: 2 }),
        }),
        seasonOf(3, { episode_count: 4 }),
      ],
      episodes,
    });
    setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    expect(labels()).toEqual(['Season 1', 'The Rising', 'Season 3']);
    expect(screen.getAllByTestId('season-count').map((el) => el.textContent)).toEqual([
      '7 episodes',
      '2 of 8 episodes',
      '4 episodes',
    ]);
    const first = within(card(/Season 1/));
    const second = within(card(/The Rising/));
    const third = within(card(/Season 3/));
    expect(first.getByTestId('season-watched')).toBeInTheDocument();
    expect(second.queryByTestId('season-watched')).toBeNull();
    expect(third.queryByTestId('season-watched')).toBeNull();
    expect(first.getByTestId('season-progress')).toHaveAttribute(
      'style',
      expect.stringContaining('width: 100%'),
    );
    expect(second.getByTestId('season-progress')).toHaveAttribute(
      'style',
      expect.stringContaining('width: 25%'),
    );
    expect(third.queryByTestId('season-progress')).toBeNull();
  });

  it('shows the poster of a season, and its label on a tile when it has none', async () => {
    serveDetail(server, {
      item: () => series(),
      seasons: [seasonOf(1, { poster_url: '/img/season-1.webp' }), seasonOf(2)],
      episodes,
    });
    setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    expect(
      within(card(/Season 1/))
        .getByTestId('art')
        .querySelector('img'),
    ).toHaveAttribute('src', `${BASE_URL}/img/season-1.webp`);
    expect(within(card(/Season 2/)).getByTestId('art-tile')).toHaveTextContent('Season 2');
  });

  it('opens the page of a season on OK, and Back returns onto its card', async () => {
    const calls = serveDetail(server, { item, seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    await pressKey(KEY.down);
    await focusKeyIs('season:0');
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-breadcrumb')).toHaveTextContent('A Show');
    expect(calls.items).toContain('season-2');
    await pressKey(KEY.back);
    await screen.findByTestId('season-rail');
    await focusKeyIs('season:2');
  });

  it('remembers a season far along a long row when the page comes back from its page', async () => {
    const many = Array.from({ length: 14 }, (_, i) => seasonOf(i + 1));
    serveDetail(server, { item, seasons: many, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    await pressKey(KEY.down);
    await focusKeyIs('season:1');
    for (let n = 2; n <= 12; n += 1) await pressKey(KEY.right);
    await focusKeyIs('season:12');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-breadcrumb')).toHaveTextContent('A Show');
    await pressKey(KEY.back);
    await screen.findByTestId('season-rail');
    await focusKeyIs('season:12');
  });

  it('opens a season on a click', async () => {
    serveDetail(server, { item, seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    fireEvent.click(card(/Season 1/));
    expect(await screen.findByTestId('detail-breadcrumb')).toHaveTextContent('Season 1');
  });

  it('plays what the season continues with from the remote Play key, asking about resuming', async () => {
    serveDetail(server, {
      item: () => series(),
      seasons: [seasonOf(1, { play_content_id: 'e13' }), seasonOf(2, { play_content_id: 'e22' })],
      episodes,
    });
    const { onPlay } = setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    fireEvent.keyDown(card(/Season 2/), { keyCode: 415 });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e22',
      title: 'A Show',
      intent: { kind: 'ask' },
    });
  });

  it('does nothing on the Play key for a season without a play target, and OK never plays', async () => {
    serveDetail(server, {
      item,
      seasons: [seasonOf(1), seasonOf(2, { play_content_id: 'e22' })],
      episodes,
    });
    const { onPlay } = setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    fireEvent.keyDown(card(/Season 1/), { keyCode: 415 });
    fireEvent.keyDown(card(/Season 2/), { keyCode: 13 });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('goes from the actions down to the first season, along the row and back up', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    await focusKeyIs('detail-play');
    await pressKey(KEY.down);
    await focusKeyIs('season:0');
    await pressKey(KEY.right);
    await focusKeyIs('season:1');
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    // The end of the row holds the focus.
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    await pressKey(KEY.left);
    await focusKeyIs('season:1');
    await pressKey(KEY.up);
    await waitFor(() => expect(inActions()).toBe(true));
  });

  it('fades the hero and scrolls the page to the row once a season has the focus', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('season-rail');
    expect(screen.getByTestId('detail-seasons')).toHaveAttribute('data-faded', 'false');
    await pressKey(KEY.down);
    await focusKeyIs('season:0');
    expect(screen.getByTestId('detail-hero').querySelector('.detail-text')).toHaveAttribute(
      'data-faded',
      'true',
    );
  });

  it('shows a row of poster cards while the seasons load', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog/series/:id/seasons`, async () => {
        await delay(80);
        return HttpResponse.json({ items: seasons });
      }),
    );
    setup({ itemId: 's1' });
    await ready();
    expect(await screen.findByTestId('seasons-skeleton')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('seasons-skeleton')).getAllByTestId('card-skeleton').length,
    ).toBeGreaterThan(5);
    await screen.findByTestId('season-rail');
    expect(screen.queryByTestId('seasons-skeleton')).toBeNull();
  });

  it("plays the server's target episode from Play", async () => {
    serveDetail(server, {
      item: () => series({ play_content_id: 'e22', play_season_number: 2 }),
      seasons,
      episodes,
    });
    const { onPlay } = setup({ itemId: 's1' });
    await ready();
    expect(await screen.findByRole('button', { name: 'Start From Episode 1' })).toBeInTheDocument();
    await focusKeyIs('detail-play');
    fireEvent.click(button('Start From Episode 1'));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e22',
      title: 'A Show',
      intent: { kind: 'beginning' },
    });
  });

  it('resumes the target episode from its position', async () => {
    const calls = serveDetail(server, {
      item: () =>
        series({
          play_content_id: 'e12',
          play_season_number: 1,
          user_data: rollup({ in_progress_count: 1, watched_count: 1 }),
        }),
      seasons,
      episodes: (season) => [
        episodeOf(season, 1),
        episodeOf(season, 2, {
          user_data: rollup({ position_seconds: 600, duration_seconds: 2700 }),
        }),
      ],
    });
    const { onPlay } = setup({ itemId: 's1' });
    // The episode's watch state is known once its season has loaded.
    await waitFor(() => expect(calls.episodes).toEqual(['s1/1']));
    await sleep(50);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e12',
      title: 'A Show',
      intent: { kind: 'resume' },
    });
  });

  it('plays the first episode of the first numbered season when the server names no target', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    const { onPlay } = setup({ itemId: 's1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Start From Episode 1' }));
    // The specials come first in the row, but the series does not start there.
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'e11' }));
  });

  it('says so when the seasons cannot be read and recovers', async () => {
    serveDetail(server, { item: () => series(), seasons: 'fail' });
    setup({ itemId: 's1' });
    const message = await screen.findByTestId('seasons-error');
    expect(message).toHaveTextContent('The seasons could not be loaded.');
    serveDetail(server, { item: () => series(), seasons, episodes });
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('season-rail');
  });

  it('shows the cast of a series in the Cast & Crew strip, with More like this after it', async () => {
    serveDetail(server, {
      item: () => series({ cast: [{ name: 'An Actor', character: 'X', order: 0 }] }),
      seasons,
      episodes,
      similar: [catalogItem({ content_id: 'x1', title: 'Similar One', type: 'series' })],
    });
    setup({ itemId: 's1' });
    await screen.findByRole('button', { name: /Similar One/ });
    expect(screen.getByRole('heading', { name: 'Cast & Crew' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'An Actor, X' })).toBeInTheDocument();
    // The credit line names no cast; a series without crew shows its genres only.
    expect(screen.getByTestId('detail-credits')).toHaveTextContent(
      'Drama · Mystery · Thriller · Comedy',
    );
    expect(screen.getByTestId('detail-credits')).not.toHaveTextContent('An Actor');
  });
});

describe('DetailScreen: a series with one season', () => {
  const only = [seasonOf(1)];
  const series = () =>
    itemDetail({ content_id: 's1', type: 'series', title: 'A Show', versions: [] });
  const episodes: DetailServe['episodes'] = (season) =>
    [1, 2, 3].map((number) => episodeOf(season, number));
  const cardOf = (name: string | RegExp) => screen.getByRole('button', { name });
  /** The series, or an episode page. */
  const item = (id: string) =>
    id === 's1' ? series() : itemDetail({ content_id: id, type: 'episode', title: 'An Episode' });

  it('has no seasons row: its episodes are the grid under the hero', async () => {
    const calls = serveDetail(server, { item: () => series(), seasons: only, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-grid');
    expect(screen.queryByTestId('season-rail')).toBeNull();
    expect(screen.queryByTestId('seasons-skeleton')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Episodes' })).toBeInTheDocument();
    expect(screen.getByTestId('episodes-head-total')).toHaveTextContent('3 total');
    expect(screen.getAllByTestId('episode-title').map((el) => el.textContent)).toEqual([
      'S01E01 · Episode 1.1',
      'S01E02 · Episode 1.2',
      'S01E03 · Episode 1.3',
    ]);
    // The grid and the episode "Play" plays share one read.
    expect(calls.episodes).toEqual(['s1/1']);
    expect(screen.getByTestId('detail-chips')).toHaveTextContent('2019PG-131 season3 episodes');
  });

  it('shows the grid of the only season even when it is the specials', async () => {
    serveDetail(server, { item: () => series(), seasons: [seasonOf(0)], episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-grid');
    expect(screen.queryByTestId('season-rail')).toBeNull();
  });

  it('shows a skeleton of stills in the grid while the episodes load, then the grid', async () => {
    serveDetail(server, {
      item: () => series(),
      seasons: only,
      episodes: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return [episodeOf(1, 1)];
      },
    });
    setup({ itemId: 's1' });
    await ready();
    expect(await screen.findByTestId('episode-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('card-skeleton').length).toBeGreaterThan(5);
    await screen.findByTestId('episode-grid');
    expect(screen.queryByTestId('episode-skeleton')).toBeNull();
  });

  it('opens the page of an episode on OK, by its content id, and Back returns onto its card', async () => {
    const calls = serveDetail(server, { item, seasons: only, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-grid');
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:s1:e11');
    await pressKey(KEY.right);
    await focusKeyIs('gcard:episodes:s1:e12');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('An Episode');
    expect(calls.items).toContain('e12');
    await pressKey(KEY.back);
    await screen.findByTestId('episode-grid');
    await focusKeyIs('gcard:episodes:s1:e12');
  });

  it('plays an episode from the remote Play key, with the series title and asking about resuming', async () => {
    serveDetail(server, { item: () => series(), seasons: only, episodes });
    const { onPlay } = setup({ itemId: 's1' });
    await screen.findByTestId('episode-grid');
    fireEvent.keyDown(cardOf(/Episode 1.2/), { keyCode: 415 });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e12',
      title: 'A Show',
      intent: { kind: 'ask' },
    });
  });

  it('does not play on OK, and does not open a page on the Play key', async () => {
    serveDetail(server, { item, seasons: only, episodes });
    const { onPlay } = setup({ itemId: 's1' });
    await screen.findByTestId('episode-grid');
    fireEvent.click(cardOf(/Episode 1.1/));
    await screen.findByTestId('detail-title');
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('comes back from the player onto the same episode card', async () => {
    serveDetail(server, { item: () => series(), seasons: only, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-grid');
    await pressKey(KEY.down);
    await focusKeyIs('gcard:episodes:s1:e11');
    await pressKey(KEY.right);
    await focusKeyIs('gcard:episodes:s1:e12');
    fireEvent.keyDown(cardOf(/Episode 1.2/), { keyCode: 415 });
    expect(await screen.findByTestId('player-stub')).toHaveTextContent('e12');
    await pressKey(KEY.back);
    await screen.findByTestId('episode-grid');
    await focusKeyIs('gcard:episodes:s1:e12');
  });

  it('says so and offers Try again when the episodes cannot be read', async () => {
    let fail = true;
    serveDetail(server, {
      item: () => series(),
      seasons: only,
      episodes: (season) => (fail ? 'fail' : [episodeOf(season, 1)]),
    });
    setup({ itemId: 's1' });
    const message = await screen.findByTestId('episodes-error');
    expect(message).toHaveTextContent('The episodes could not be loaded.');
    fail = false;
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('episode-grid');
  });

  it('says that the season has no episodes yet', async () => {
    serveDetail(server, { item: () => series(), seasons: only, episodes: () => [] });
    setup({ itemId: 's1' });
    expect(await screen.findByTestId('episodes-empty')).toHaveTextContent(
      'No episodes are available for this season yet.',
    );
    expect(screen.getByTestId('episodes-head-total')).toHaveTextContent('0 total');
  });
});

describe('DetailScreen: title art', () => {
  const LOGO = `${BASE_URL}/img/m1-logo.webp`;
  const withLogo = () => itemDetail({ logo_url: '/img/m1-logo.webp' });
  const logoImages = () => document.querySelectorAll(`img[src="${LOGO}"]`);
  const holdAnswers = () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const release = () =>
      act(async () => {
        open();
        await Promise.resolve();
      });
    return { gate, release };
  };

  it('shows the logo when the profile wants title art', async () => {
    serveDetail(server, { item: withLogo, settings: { values: { 'ui.title_art': true } } });
    setup({ itemId: 'm1' });
    await ready();
    expect(await screen.findByTestId('detail-logo')).toHaveAttribute('src', LOGO);
    expect(screen.queryByTestId('detail-title')).toBeNull();
  });

  it('shows the text title and never requests the logo when the profile turned it off', async () => {
    serveDetail(server, { item: withLogo, settings: { values: { 'ui.title_art': false } } });
    setup({ itemId: 'm1' });
    await ready();
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('First Title');
    expect(screen.queryByTestId('detail-logo')).toBeNull();
    expect(logoImages()).toHaveLength(0);
  });

  it('reserves the logo box, requests no image and shows no title until the answer is known', async () => {
    const { gate, release } = holdAnswers();
    serveDetail(server, { item: withLogo, settings: { gate, values: { 'ui.title_art': false } } });
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.getByTestId('detail-logo-reserve')).toHaveClass('detail-logo');
    expect(logoImages()).toHaveLength(0);
    expect(screen.queryByTestId('detail-title')).toBeNull();
    await release();
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('First Title');
    expect(screen.queryByTestId('detail-logo-reserve')).toBeNull();
    expect(logoImages()).toHaveLength(0);
  });

  it('swaps the reserved box for the logo once the answer is yes', async () => {
    const { gate, release } = holdAnswers();
    serveDetail(server, { item: withLogo, settings: { gate } });
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.getByTestId('detail-logo-reserve')).toBeInTheDocument();
    await release();
    await waitFor(() => expect(logoImages()).toHaveLength(1));
    expect(screen.queryByTestId('detail-logo-reserve')).toBeNull();
  });
});

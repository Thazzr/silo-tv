import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
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
/**
 * A key press that needs no timer, for tests that fake setTimeout: the navigation decides within
 * a few promise ticks (pressKey itself waits on a timer).
 */
const pressFaked = (keyCode: number) =>
  act(async () => {
    fireEvent.keyDown(window, { keyCode });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));

/** Short enough to keep the tests quick, long enough to tell "rested" from "passed over". */
/** Far longer than the old rest delay: focus alone must not switch a season in this time. */
const LONG_REST = 5000;

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
    expect(screen.getByTestId('detail-meta')).toHaveTextContent(
      '2019 · 1 h 32 min · PG-13 · Drama · Mystery · Thriller',
    );
    expect(screen.getByTestId('detail-ratings')).toHaveTextContent('IMDb 8.5');
    expect(screen.getByTestId('detail-ratings')).toHaveTextContent('TMDB 7.9');
    expect(screen.getByTestId('detail-credits')).toHaveTextContent('Directed by Dana Director');
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
    // Dolby Vision, 4K and 5.1 are there; HDR10 and Dolby Atmos are not.
    expect(badges).toEqual(['4K', 'Dolby Vision', '5.1']);
  });

  it('has no badge row for a plain file', async () => {
    serveDetail(server);
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.queryByTestId('detail-badges')).toBeNull();
    expect(screen.queryByTestId('detail-ratings')).toBeNull();
    expect(screen.queryByTestId('detail-credits')).toBeNull();
  });

  it('plays from the start when nothing was watched, with no Start over', async () => {
    serveDetail(server);
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
    fireEvent.click(button('Play'));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'm1',
      title: 'First Title',
      intent: { kind: 'beginning' },
    });
  });

  it('offers Resume from the saved position and Start over, and each starts where it says', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({ user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }) }),
    });
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    fireEvent.click(button('Resume from 12:34'));
    expect(onPlay).toHaveBeenLastCalledWith({
      contentId: 'm1',
      title: 'First Title',
      intent: { kind: 'resume' },
    });
    await screen.findByTestId('player-stub');
  });

  it('starts over at 0 from Start over', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({ user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }) }),
    });
    const { onPlay } = setup({ itemId: 'm1' });
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.right);
    await focusKeyIs('detail-start-over');
    await pressKey(KEY.enter);
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
    expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
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
    await focusKeyIs('card:cast:p-1');
    await pressKey(KEY.right);
    await focusKeyIs('card:cast:p-2');
    await pressKey(KEY.enter);
    await screen.findByTestId('person-stub');
    await pressKey(KEY.back);
    await ready();
    await focusKeyIs('card:cast:p-2');
  });

  it('puts the initials on a cast card without a photo', async () => {
    serveDetail(server, {
      item: () => itemDetail({ cast: [{ name: 'Alex Black', character: 'Ann', order: 0 }] }),
    });
    setup({ itemId: 'm1' });
    await ready();
    expect(screen.getByTestId('art-tile')).toHaveTextContent('AB');
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
    await focusKeyIs('card:cast:0-First Actor');
    await pressKey(KEY.down);
    await focusKeyIs('card:similar:x1');
    await pressKey(KEY.up);
    await focusKeyIs('card:cast:0-First Actor');
    await pressKey(KEY.up);
    await focusKeyIs('detail-play');
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
      await focusKeyIs('card:cast:0-First Actor');
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
    await focusKeyIs('card:cast:0-First Actor');
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
    fireEvent.click(button('Resume from 12:34'));
    await screen.findByTestId('player-stub');
    // The viewer watched it to the end meanwhile.
    position = 0;
    await pressKey(KEY.back);
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
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
  const episodes: DetailServe['episodes'] = (season) =>
    season === 0
      ? [episodeOf(0, 1, { title: 'Special' })]
      : [1, 2, 3].map((number) => episodeOf(season, number));
  const pills = () =>
    within(screen.getByTestId('season-pills'))
      .getAllByRole('tab')
      .map((el) => el.textContent);
  const titles = () => screen.getAllByTestId('episode-title').map((el) => el.textContent);

  it('shows the seasons in order with the specials last, on the first season by default', async () => {
    const calls = serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await ready();
    await screen.findByTestId('season-pills');
    expect(pills()).toEqual(['Season 1', 'Season 2', 'Specials']);
    expect(screen.getByRole('tab', { name: 'Season 1' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByTestId('episode-strip');
    expect(titles()).toEqual(['E1 · Episode 1.1', 'E2 · Episode 1.2', 'E3 · Episode 1.3']);
    expect(calls.seasons).toEqual(['s1']);
    // The facts say seasons instead of a runtime.
    expect(screen.getByTestId('detail-meta')).toHaveTextContent('2019 · 2 seasons');
  });

  it('shows number, title, runtime, synopsis, progress and the watched mark of each episode', async () => {
    serveDetail(server, {
      item: () => series(),
      seasons,
      episodes: (season) => [
        episodeOf(season, 1, { user_data: rollup({ played: true }) }),
        episodeOf(season, 2, {
          runtime: 50,
          user_data: rollup({ position_seconds: 750, duration_seconds: 3000 }),
        }),
        episodeOf(season, 3, { overview: undefined }),
        // Watched and being watched again: the check and the bar together.
        episodeOf(season, 4, {
          user_data: rollup({ played: true, position_seconds: 360, duration_seconds: 3000 }),
        }),
      ],
    });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    const cards = screen.getAllByTestId('episode-title');
    expect(cards.map((el) => el.textContent)).toEqual([
      'E1 · Episode 1.1',
      'E2 · Episode 1.2',
      'E3 · Episode 1.3',
      'E4 · Episode 1.4',
    ]);
    expect(screen.getAllByTestId('episode-runtime').map((el) => el.textContent)).toEqual([
      '45 min',
      '50 min',
      '45 min',
      '45 min',
    ]);
    expect(screen.getAllByTestId('episode-synopsis')[1]).toHaveTextContent('Synopsis of 1.2.');
    // The first and the fourth are watched; the second is partway (a quarter of 50 minutes) and
    // the fourth is being watched again (360 s of 50 minutes), so it has both.
    expect(screen.getAllByTestId('episode-watched')).toHaveLength(2);
    const first = within(screen.getByRole('button', { name: /Episode 1.1/ }));
    expect(first.getByTestId('episode-watched')).toBeInTheDocument();
    expect(first.queryByTestId('card-progress')).toBeNull();
    const fourth = within(screen.getByRole('button', { name: /Episode 1.4/ }));
    expect(fourth.getByTestId('episode-watched')).toBeInTheDocument();
    expect(fourth.getByTestId('card-progress')).toHaveAttribute(
      'style',
      expect.stringContaining('width: 12%'),
    );
    const bars = screen.getAllByTestId('card-progress');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('style', expect.stringContaining('width: 25%'));
  });

  it('shows a skeleton of cards while the episodes load, then the strip', async () => {
    serveDetail(server, {
      item: () => series(),
      seasons,
      episodes: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return [episodeOf(1, 1)];
      },
    });
    setup({ itemId: 's1' });
    await ready();
    expect(await screen.findByTestId('episode-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('card-skeleton').length).toBeGreaterThan(3);
    await screen.findByTestId('episode-strip');
    expect(screen.queryByTestId('episode-skeleton')).toBeNull();
  });

  it('plays an episode with OK, with the series title and the player asking about resuming', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    const { onPlay } = setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    fireEvent.click(screen.getByRole('button', { name: /Episode 1.2/ }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e12',
      title: 'A Show',
      intent: undefined,
    });
  });

  it('never switches the season when the focus only passes over or rests on a pill', async () => {
    const calls = serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs('episode:e11');
    await pressKey(KEY.up);
    await focusKeyIs('season:1');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await pressFaked(KEY.right);
      expect(getCurrentFocusKey()).toBe('season:2');
      await pressFaked(KEY.right);
      expect(getCurrentFocusKey()).toBe('season:0');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LONG_REST);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(titles()[0]).toBe('E1 · Episode 1.1');
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Season 1');
    expect(calls.episodes).toEqual(['s1/1']);
  });

  it('switches the season on OK on its pill', async () => {
    const calls = serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    await pressKey(KEY.down);
    await focusKeyIs('season:1');
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    expect(titles()[0]).toBe('E1 · Episode 1.1');
    await pressKey(KEY.enter);
    await waitFor(() => expect(titles()[0]).toBe('E1 · Episode 2.1'));
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Season 2');
    expect(calls.episodes).toEqual(['s1/1', 's1/2']);
  });

  it('hovering a season pill with the pointer does not switch; a click does', async () => {
    const calls = serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => {
        fireEvent.mouseEnter(screen.getByRole('tab', { name: 'Season 2' }));
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      });
      expect(getCurrentFocusKey()).toBe('season:2');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LONG_REST);
      });
      expect(titles()[0]).toBe('E1 · Episode 1.1');
      expect(calls.episodes).toEqual(['s1/1']);
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Season 2' }));
    await waitFor(() => expect(titles()[0]).toBe('E1 · Episode 2.1'));
  });

  it('Down from a focused season that is not selected enters the episodes that are shown', async () => {
    const calls = serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    await pressKey(KEY.down);
    await focusKeyIs('season:1');
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('episode:e11');
    expect(titles()[0]).toBe('E1 · Episode 1.1');
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Season 1');
    expect(calls.episodes).toEqual(['s1/1']);
  });

  it('lands on the selected season when Up comes back from the episodes', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    await pressKey(KEY.down);
    await focusKeyIs('season:1');
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    await pressKey(KEY.down);
    await focusKeyIs('episode:e11');
    await pressKey(KEY.up);
    await focusKeyIs('season:1');
  });

  it('marks exactly one season pill as selected, and the mark follows the season', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    const marked = () => screen.getAllByRole('tab', { selected: true }).map((el) => el.textContent);
    expect(marked()).toEqual(['Season 1']);
    expect(document.querySelectorAll('.detail-season.selected')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Season 2' }));
    await waitFor(() => expect(marked()).toEqual(['Season 2']));
    expect(document.querySelectorAll('.detail-season.selected')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveClass('selected');
  });

  it('shows the season at once on OK', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    fireEvent.click(screen.getByRole('tab', { name: 'Season 2' }));
    await waitFor(() => expect(titles()[0]).toBe('E1 · Episode 2.1'));
  });

  it('remembers the focused episode of each season when switching back', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    // Season 1: second episode.
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs('episode:e11');
    await pressKey(KEY.right);
    await focusKeyIs('episode:e12');
    // Season 2: third episode.
    await pressKey(KEY.up);
    await focusKeyIs('season:1');
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    await pressKey(KEY.enter);
    await waitFor(() => expect(titles()[0]).toBe('E1 · Episode 2.1'));
    await pressKey(KEY.down);
    await focusKeyIs('episode:e21');
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await focusKeyIs('episode:e23');
    // Back to season 1: Down from its pill lands on the second episode, not the first.
    await pressKey(KEY.up);
    await focusKeyIs('season:2');
    await pressKey(KEY.left);
    await focusKeyIs('season:1');
    await pressKey(KEY.enter);
    await waitFor(() => expect(titles()[0]).toBe('E1 · Episode 1.1'));
    await pressKey(KEY.down);
    await focusKeyIs('episode:e12');
    // And season 2 still has its own.
    await pressKey(KEY.up);
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    await pressKey(KEY.enter);
    await waitFor(() => expect(titles()[0]).toBe('E1 · Episode 2.1'));
    await pressKey(KEY.down);
    await focusKeyIs('episode:e23');
  });

  it("plays the server's target episode from Play, which opens on that season", async () => {
    const calls = serveDetail(server, {
      item: () => series({ play_content_id: 'e22', play_season_number: 2 }),
      seasons,
      episodes,
    });
    const { onPlay } = setup({ itemId: 's1' });
    await ready();
    expect(await screen.findByRole('button', { name: 'Play S2 · E2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    expect(calls.episodes).toEqual(['s1/2']);
    await focusKeyIs('detail-play');
    fireEvent.click(button('Play S2 · E2'));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e22',
      title: 'A Show',
      intent: { kind: 'beginning' },
    });
  });

  it('resumes the target episode from its position and offers Start over', async () => {
    serveDetail(server, {
      item: () => series({ play_content_id: 'e12', play_season_number: 1 }),
      seasons,
      episodes: (season) => [
        episodeOf(season, 1),
        episodeOf(season, 2, {
          user_data: rollup({ position_seconds: 600, duration_seconds: 2700 }),
        }),
      ],
    });
    const { onPlay } = setup({ itemId: 's1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Resume S1 · E2' }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e12',
      title: 'A Show',
      intent: { kind: 'resume' },
    });
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
  });

  it('still plays the target when another season is shown', async () => {
    serveDetail(server, {
      item: () => series({ play_content_id: 'e22', play_season_number: 2 }),
      seasons,
      episodes,
    });
    const { onPlay } = setup({ itemId: 's1' });
    await screen.findByRole('button', { name: 'Play S2 · E2' });
    fireEvent.click(screen.getByRole('tab', { name: 'Season 1' }));
    await waitFor(() => expect(titles()[0]).toBe('E1 · Episode 1.1'));
    fireEvent.click(button('Play S2 · E2'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'e22' }));
  });

  it('plays the first episode of the first season when the server names no target', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    const { onPlay } = setup({ itemId: 's1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Play S1 · E1' }));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'e11' }));
  });

  it('opens on the season of the episode card it came from and focuses that episode, and Play plays it', async () => {
    serveDetail(server, {
      item: () => series({ play_content_id: 'e11', play_season_number: 1 }),
      seasons,
      episodes,
    });
    const { onPlay } = setup({ itemId: 's1', season: 2, episodeId: 'e23' });
    await screen.findByTestId('episode-strip');
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    expect(titles()[0]).toBe('E1 · Episode 2.1');
    await focusKeyIs('episode:e23');
    // Play names the episode the page was opened on, not the server's target.
    fireEvent.click(await screen.findByRole('button', { name: 'Play S2 · E3' }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'e23',
      title: 'A Show',
      intent: { kind: 'beginning' },
    });
  });

  it('comes back from the player on the same season and episode', async () => {
    serveDetail(server, { item: () => series(), seasons, episodes });
    setup({ itemId: 's1' });
    await screen.findByTestId('episode-strip');
    await pressKey(KEY.down);
    await focusKeyIs('season:1');
    await pressKey(KEY.right);
    await focusKeyIs('season:2');
    await pressKey(KEY.enter);
    await waitFor(() => expect(titles()[0]).toBe('E1 · Episode 2.1'));
    await pressKey(KEY.down);
    await focusKeyIs('episode:e21');
    await pressKey(KEY.right);
    await focusKeyIs('episode:e22');
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('player-stub')).toHaveTextContent('e22');
    await pressKey(KEY.back);
    await screen.findByTestId('episode-strip');
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true');
    await focusKeyIs('episode:e22');
  });

  it('says so and offers Try again when the episodes cannot be read', async () => {
    let fail = true;
    serveDetail(server, {
      item: () => series(),
      seasons,
      episodes: (season) => (fail ? 'fail' : [episodeOf(season, 1)]),
    });
    setup({ itemId: 's1' });
    const message = await screen.findByTestId('episodes-error');
    expect(message).toHaveTextContent('The episodes could not be loaded.');
    fail = false;
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('episode-strip');
  });

  it('says so when the seasons cannot be read and recovers', async () => {
    serveDetail(server, { item: () => series(), seasons: 'fail' });
    setup({ itemId: 's1' });
    const message = await screen.findByTestId('seasons-error');
    expect(message).toHaveTextContent('The seasons could not be loaded.');
    serveDetail(server, { item: () => series(), seasons, episodes });
    fireEvent.click(within(message).getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('season-pills');
  });

  it('shows no cast row for a series, and More like this after the episodes', async () => {
    serveDetail(server, {
      item: () => series({ cast: [{ name: 'An Actor', character: 'X', order: 0 }] }),
      seasons,
      episodes,
      similar: [catalogItem({ content_id: 'x1', title: 'Similar One', type: 'series' })],
    });
    setup({ itemId: 's1' });
    await screen.findByRole('button', { name: /Similar One/ });
    expect(screen.queryByRole('heading', { name: 'Cast' })).toBeNull();
    expect(screen.getByTestId('detail-credits')).toHaveTextContent('Starring An Actor');
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

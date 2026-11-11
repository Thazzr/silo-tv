import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
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
  serveUserActions,
  type DetailServe,
} from '../../test/detailFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, testDevice } from '../../test/renderFlow';
import { DetailMemory, type DetailTarget } from './detailMemory';
import { DetailScreen, type PlayRequest } from './DetailScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type S = components['schemas'];

const userState = (
  overrides: Partial<S['CatalogItemUserState']> = {},
): S['CatalogItemUserState'] => ({
  in_watchlist: false,
  is_favorite: false,
  not_interested: false,
  played: false,
  ...overrides,
});

type Screen = { name: 'detail'; target: DetailTarget } | { name: 'player'; request: PlayRequest };

function setup(
  target: DetailTarget = { itemId: 'm1' },
  queryClient?: QueryClient,
  options: { stay?: boolean } = {},
) {
  const client =
    queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
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
  const onBack = vi.fn();
  const renderScreen = (current: Screen, nav: NavApi<Screen>) =>
    current.name === 'detail' ? (
      <DetailScreen
        target={current.target}
        memory={memory.of(current)}
        onPlay={(request) => {
          onPlay(request);
          // `stay` keeps the page, to look at what it does after the call.
          if (!options.stay) nav.push({ name: 'player', request });
        }}
        onOpenDetail={() => undefined}
        onOpenPerson={() => undefined}
        onOpenBoxSet={() => undefined}
        onBack={() => {
          onBack();
          nav.pop();
        }}
      />
    ) : (
      <div data-testid="player-stub">{current.request.contentId}</div>
    );
  const view = render(
    <QueryClientProvider client={client}>
      <I18nProvider lang="en">
        <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
          <Navigator<Screen> initial={{ name: 'detail', target }} renderScreen={renderScreen} />
        </SiloProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onPlay, onBack, queryClient: client, ...view };
}

const focusKeyIs = (focusKey: string) => waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));
const ready = () => screen.findByTestId('detail-hero');
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const primary = () => screen.getByTestId('detail-primary');

/** A held-back answer: `release` lets the writes behind it complete. */
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const movieServe = (overrides: Partial<S['CatalogItemDetail']> = {}): DetailServe => ({
  item: () => itemDetail({ user_state: userState(), ...overrides }),
});

describe('the primary button of a movie', () => {
  it('says Play without progress, with no fill', async () => {
    serveDetail(server, movieServe());
    setup();
    await ready();
    expect(primary()).toHaveTextContent('Play');
    expect(screen.queryByTestId('detail-play-fill')).toBeNull();
  });

  it('draws the played share inside the button when it has progress', async () => {
    serveDetail(
      server,
      movieServe({ user_data: rollup({ position_seconds: 1350, duration_seconds: 5400 }) }),
    );
    setup();
    await ready();
    expect(primary()).toHaveTextContent('Play');
    expect(screen.getByTestId('detail-play-fill')).toHaveStyle({ transform: 'scaleX(0.25)' });
  });

  it('says Resume with several versions, and resumes at once', async () => {
    serveDetail(
      server,
      movieServe({
        versions: [fileVersion(), fileVersion({ file_id: 'file-2', edition_key: 'extended' })],
        user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }),
      }),
    );
    const { onPlay } = setup();
    await ready();
    expect(primary()).toHaveTextContent('Resume');
    fireEvent.click(primary());
    expect(screen.queryByTestId('resume-dialog')).toBeNull();
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'm1',
      title: 'First Title',
      intent: { kind: 'resume' },
    });
  });

  it('keeps Play from Beginning in the More menu when it resumes with several versions', async () => {
    serveDetail(
      server,
      movieServe({
        versions: [fileVersion(), fileVersion({ file_id: 'file-2', edition_key: 'extended' })],
        user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }),
      }),
    );
    const { onPlay } = setup();
    await ready();
    fireEvent.click(button('More actions'));
    const menu = await screen.findByTestId('more-menu');
    fireEvent.click(within(menu).getByRole('button', { name: 'Play from Beginning' }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'm1',
      title: 'First Title',
      intent: { kind: 'beginning' },
    });
  });
});

describe('the resume dialog', () => {
  const resuming = () =>
    serveDetail(
      server,
      movieServe({ user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }) }),
    );

  it('opens on OK with the time and the percent, and focuses "Resume at"', async () => {
    resuming();
    setup();
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.enter);
    const dialog = await screen.findByTestId('resume-dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Resume Playback?');
    expect(dialog).toHaveTextContent("You're 12:34 in, about 14% through.");
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((el) => el.textContent),
    ).toEqual(['Resume at 12:34', 'Play from Beginning']);
    await focusKeyIs('detail-resume-at');
    // It stays open: the OK that opened it did not press its first choice.
    expect(screen.getByTestId('resume-dialog')).toBeInTheDocument();
  });

  it('resumes from "Resume at"', async () => {
    resuming();
    const { onPlay } = setup();
    await ready();
    fireEvent.click(primary());
    fireEvent.click(await screen.findByRole('button', { name: 'Resume at 12:34' }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'm1',
      title: 'First Title',
      intent: { kind: 'resume' },
    });
    expect(screen.queryByTestId('resume-dialog')).toBeNull();
  });

  it('starts over from "Play from Beginning"', async () => {
    resuming();
    const { onPlay } = setup();
    await ready();
    fireEvent.click(primary());
    const dialog = await screen.findByTestId('resume-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Play from Beginning' }));
    expect(onPlay).toHaveBeenCalledWith({
      contentId: 'm1',
      title: 'First Title',
      intent: { kind: 'beginning' },
    });
  });

  it('closes on Back and returns the focus to Play', async () => {
    resuming();
    const { onPlay } = setup();
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.enter);
    await screen.findByTestId('resume-dialog');
    await pressKey(KEY.down);
    await focusKeyIs('detail-resume-start-over');
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('resume-dialog')).toBeNull());
    await focusKeyIs('detail-play');
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('holds the focus inside: Left, Right and the ends of the list do not leave it', async () => {
    resuming();
    setup();
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.enter);
    await focusKeyIs('detail-resume-at');
    await pressKey(KEY.up);
    await pressKey(KEY.left);
    await pressKey(KEY.right);
    await focusKeyIs('detail-resume-at');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusKeyIs('detail-resume-start-over');
  });

  it('does not open without a resume point', async () => {
    serveDetail(server, movieServe());
    const { onPlay } = setup();
    await ready();
    fireEvent.click(primary());
    expect(screen.queryByTestId('resume-dialog')).toBeNull();
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ intent: { kind: 'beginning' } }));
  });

  it('lands the focus on Play when the player is left', async () => {
    resuming();
    setup();
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.enter);
    await focusKeyIs('detail-resume-at');
    await pressKey(KEY.enter);
    await screen.findByTestId('player-stub');
    await pressKey(KEY.back);
    await ready();
    await focusKeyIs('detail-play');
  });
});

describe('the primary button of a series', () => {
  const seasons = [seasonOf(1)];
  const episodes: DetailServe['episodes'] = (season) =>
    [1, 2, 3].map((number) => episodeOf(season, number));
  const serveSeries = (overrides: Partial<S['CatalogItemDetail']>) =>
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          title: 'A Show',
          versions: [],
          play_content_id: 'e11',
          play_season_number: 1,
          ...overrides,
        }),
      seasons,
      episodes,
    });

  it.each([
    ['an episode is in progress', rollup({ in_progress_count: 1, watched_count: 1 }), 'Resume'],
    ['some are watched', rollup({ watched_count: 2, unplayed_count: 1 }), 'Play Next'],
    ['none is watched', rollup(), 'Start From Episode 1'],
    [
      'all are watched',
      rollup({ played: true, watched_count: 3, unplayed_count: 0 }),
      'Start From Episode 1',
    ],
  ])('says what it plays when %s', async (_name, user, label) => {
    serveSeries({ user_data: user });
    const { onPlay } = setup({ itemId: 's1' });
    await ready();
    await waitFor(() => expect(primary()).toHaveTextContent(label));
    await screen.findByTestId('episode-strip');
    fireEvent.click(primary());
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'e11' }));
  });

  it('is a disabled Browse Series without an episode to play, out of the focus order', async () => {
    serveDetail(server, {
      item: () => itemDetail({ content_id: 's1', type: 'series', title: 'A Show', versions: [] }),
      seasons: [],
    });
    setup({ itemId: 's1' });
    await ready();
    await waitFor(() => expect(primary()).toHaveTextContent('Browse Series'));
    expect(primary()).toBeDisabled();
    // The first button that can be used takes the focus instead.
    await focusKeyIs('detail-watched');
    await pressKey(KEY.left);
    await focusKeyIs('detail-watched');
  });

  it('has no action row while the target episode is still being looked up', async () => {
    serveDetail(server, {
      item: () => itemDetail({ content_id: 's1', type: 'series', title: 'A Show', versions: [] }),
      seasons,
      episodes: () => new Promise(() => undefined),
    });
    setup({ itemId: 's1' });
    await ready();
    expect(screen.queryByTestId('detail-actions')).toBeNull();
  });
});

describe('the watched toggle', () => {
  it.each<[string, Partial<S['CatalogItemDetail']>, string]>([
    ['a movie that is not watched', {}, 'Mark Watched'],
    ['a movie that is watched', { user_data: rollup({ played: true }) }, 'Mark Unwatched'],
    [
      'a watched movie with a saved position',
      { user_data: rollup({ played: true, position_seconds: 600, duration_seconds: 5400 }) },
      'Mark Watched',
    ],
    [
      'a series that is not watched',
      { type: 'series', content_id: 's1', versions: [] },
      'Mark Series Watched',
    ],
    [
      'a series that is watched',
      { type: 'series', content_id: 's1', versions: [], user_data: rollup({ played: true }) },
      'Mark Series Unwatched',
    ],
  ])('says %s', async (_name, overrides, label) => {
    serveDetail(server, {
      ...movieServe(overrides),
      seasons: [seasonOf(1)],
      episodes: () => [episodeOf(1, 1)],
    });
    setup({ itemId: overrides.content_id ?? 'm1' });
    expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
  });

  it('marks a movie watched, then reads the item, the seasons, the episodes and Home again', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    queryClient.setQueryData(['home', 'sections', BASE_URL, 'p1'], []);
    queryClient.setQueryData(['library', 'sections', BASE_URL, 'p1', 'lib'], []);
    let played = false;
    const calls = serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          title: 'A Show',
          versions: [],
          play_content_id: 'e11',
          play_season_number: 1,
          user_state: userState(),
          user_data: rollup({ played }),
        }),
      seasons: [seasonOf(1)],
      episodes: (season) => [episodeOf(season, 1)],
    });
    const writes = serveUserActions(server);
    setup({ itemId: 's1' }, queryClient);
    await screen.findByTestId('episode-strip');
    const before = { items: calls.items.length, episodes: calls.episodes.length };
    expect(button('Mark Series Watched')).toBeInTheDocument();
    played = true;
    fireEvent.click(button('Mark Series Watched'));
    expect(await screen.findByRole('button', { name: 'Mark Series Unwatched' })).toBeEnabled();
    expect(writes).toEqual([{ method: 'POST', group: 'watched', id: 's1', body: undefined }]);
    expect(calls.items.length).toBeGreaterThan(before.items);
    expect(calls.episodes.length).toBeGreaterThan(before.episodes);
    expect(queryClient.getQueryState(['home', 'sections', BASE_URL, 'p1'])?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(['library', 'sections', BASE_URL, 'p1', 'lib'])?.isInvalidated,
    ).toBe(true);
    expect(screen.getByTestId('detail-notice')).toHaveTextContent('Marked as watched');
  });

  it('marks a watched movie unwatched with DELETE', async () => {
    serveDetail(server, movieServe({ user_data: rollup({ played: true }) }));
    const writes = serveUserActions(server);
    setup();
    await ready();
    fireEvent.click(button('Mark Unwatched'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'DELETE', group: 'watched', id: 'm1' });
  });

  it('is disabled while the request runs', async () => {
    serveDetail(server, movieServe());
    const held = gate();
    const writes = serveUserActions(server, { gate: held.promise });
    setup();
    await ready();
    fireEvent.click(button('Mark Watched'));
    await waitFor(() => expect(button('Mark Watched')).toBeDisabled());
    expect(writes).toHaveLength(1);
    await act(async () => held.release());
    await waitFor(() => expect(button('Mark Watched')).toBeEnabled());
  });

  it('leaves the state alone when the request fails', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server, { fail: () => true });
    setup();
    await ready();
    fireEvent.click(button('Mark Watched'));
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => expect(button('Mark Watched')).toBeEnabled());
    expect(screen.queryByTestId('detail-notice')).toBeNull();
  });

  it('offers Mark Unwatched in the More menu for a movie with progress, and it clears the progress', async () => {
    serveDetail(
      server,
      movieServe({ user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }) }),
    );
    const writes = serveUserActions(server);
    setup();
    await ready();
    // The toggle itself still says Mark Watched: the item counts as not watched.
    expect(button('Mark Watched')).toBeInTheDocument();
    fireEvent.click(button('More actions'));
    const menu = await screen.findByTestId('more-menu');
    fireEvent.click(within(menu).getByRole('button', { name: 'Mark Unwatched' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'DELETE', group: 'watched', id: 'm1' });
    expect(screen.queryByTestId('more-menu')).toBeNull();
  });
});

describe('the favourite heart', () => {
  const heart = () => button(/^(Favorite|Unfavorite)$/);

  it('adds a favourite with PUT, shows it at once and says so', async () => {
    serveDetail(server, movieServe());
    const held = gate();
    const writes = serveUserActions(server, { gate: held.promise });
    setup();
    await ready();
    expect(heart()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(heart());
    // Optimistic: filled before the server answered.
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'true'));
    expect(heart().querySelector('.detail-heart')).toHaveAttribute('data-filled', 'true');
    expect(writes).toEqual([{ method: 'PUT', group: 'favorites', id: 'm1', body: undefined }]);
    await act(async () => held.release());
    await waitFor(() =>
      expect(screen.getByTestId('detail-notice')).toHaveTextContent('Added to favorites'),
    );
    expect(heart()).toHaveAttribute('aria-pressed', 'true');
  });

  it('removes a favourite with DELETE', async () => {
    serveDetail(server, movieServe({ user_state: userState({ is_favorite: true }) }));
    const writes = serveUserActions(server);
    setup();
    await ready();
    expect(heart()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(heart());
    await waitFor(() => expect(heart()).toHaveAttribute('aria-pressed', 'false'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'DELETE', group: 'favorites', id: 'm1' });
    await waitFor(() =>
      expect(screen.getByTestId('detail-notice')).toHaveTextContent('Removed from favorites'),
    );
  });

  it('takes the fill back and says so when the request fails', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server, { fail: () => true });
    setup();
    await ready();
    fireEvent.click(heart());
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId('detail-notice')).toHaveTextContent('Failed to update favorites'),
    );
    expect(heart()).toHaveAttribute('aria-pressed', 'false');
    expect(heart().querySelector('.detail-heart')).toHaveAttribute('data-filled', 'false');
  });
});

describe('the star rating', () => {
  const stars = () => screen.getByRole('button', { name: /^(Rating|\d stars?)$/ });
  const lit = () =>
    Array.from(stars().querySelectorAll('.detail-star')).filter(
      (el) => el.getAttribute('data-filled') === 'true',
    ).length;
  const toRating = async () => {
    await focusKeyIs('detail-play');
    // Play, watched, heart, then the stars.
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.right);
    await focusKeyIs('detail-rating');
  };

  it('draws the saved rating', async () => {
    serveDetail(server, movieServe({ user_rating: 4 }));
    setup();
    await ready();
    expect(stars()).toHaveAccessibleName('4 stars');
    expect(lit()).toBe(4);
  });

  it('starts picking on OK, lights the stars as Left and Right pick, and saves on OK', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server);
    setup();
    await ready();
    await toRating();
    expect(lit()).toBe(0);
    await pressKey(KEY.enter);
    expect(stars()).toHaveAttribute('data-picking', 'true');
    expect(lit()).toBe(1);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(lit()).toBe(3);
    // The focus stayed on the stars: Right picked, it did not walk the row.
    expect(getCurrentFocusKey()).toBe('detail-rating');
    await pressKey(KEY.left);
    expect(lit()).toBe(2);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(lit()).toBe(5);
    await pressKey(KEY.left);
    await pressKey(KEY.enter);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ method: 'PUT', group: 'ratings', id: 'm1', body: { rating: 4 } });
    expect(stars()).toHaveAttribute('data-picking', 'false');
    expect(stars()).toHaveAccessibleName('4 stars');
  });

  it('never picks below one star', async () => {
    serveDetail(server, movieServe());
    setup();
    await ready();
    await toRating();
    await pressKey(KEY.enter);
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    expect(lit()).toBe(1);
  });

  it('clears the rating when the star that is already set is confirmed', async () => {
    serveDetail(server, movieServe({ user_rating: 3 }));
    const writes = serveUserActions(server);
    setup();
    await ready();
    await toRating();
    await pressKey(KEY.enter);
    expect(lit()).toBe(3);
    await pressKey(KEY.enter);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'DELETE', group: 'ratings', id: 'm1' });
    await waitFor(() => expect(stars()).toHaveAccessibleName('Rating'));
    expect(lit()).toBe(0);
  });

  it('cancels on Back and restores the shown value', async () => {
    serveDetail(server, movieServe({ user_rating: 2 }));
    const writes = serveUserActions(server);
    setup();
    await ready();
    await toRating();
    await pressKey(KEY.enter);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(lit()).toBe(4);
    await pressKey(KEY.back);
    expect(stars()).toHaveAttribute('data-picking', 'false');
    expect(lit()).toBe(2);
    expect(writes).toEqual([]);
    // Back only cancelled the picking: the page is still here.
    expect(screen.getByTestId('detail-hero')).toBeInTheDocument();
  });

  it('cancels when Down leaves the stars', async () => {
    serveDetail(server, movieServe({ user_rating: 2 }));
    setup();
    await ready();
    await toRating();
    await pressKey(KEY.enter);
    await pressKey(KEY.right);
    expect(lit()).toBe(3);
    await pressKey(KEY.up);
    expect(lit()).toBe(2);
    expect(stars()).toHaveAttribute('data-picking', 'false');
  });

  it('walks the row with Left and Right outside picking', async () => {
    serveDetail(server, movieServe());
    setup();
    await ready();
    await toRating();
    await pressKey(KEY.right);
    await focusKeyIs('detail-menu');
    await pressKey(KEY.left);
    await focusKeyIs('detail-rating');
    await pressKey(KEY.left);
    await focusKeyIs('detail-favorite');
  });

  it('saves the star the pointer clicks', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server);
    setup();
    await ready();
    fireEvent.click(stars().querySelectorAll('.detail-star')[3]!);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'PUT', group: 'ratings', body: { rating: 4 } });
  });

  it('takes the stars back and says so when the request fails', async () => {
    serveDetail(server, movieServe({ user_rating: 2 }));
    const writes = serveUserActions(server, { fail: () => true });
    setup();
    await ready();
    fireEvent.click(stars().querySelectorAll('.detail-star')[4]!);
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId('detail-notice')).toHaveTextContent('Failed to update rating'),
    );
    expect(lit()).toBe(2);
  });
});

describe('the row of buttons', () => {
  it('walks Play, watched, heart, stars, More with Left and Right, and holds at the ends', async () => {
    serveDetail(server, movieServe());
    setup();
    await ready();
    await focusKeyIs('detail-play');
    await pressKey(KEY.left);
    await focusKeyIs('detail-play');
    for (const key of ['detail-watched', 'detail-favorite', 'detail-rating', 'detail-menu']) {
      await pressKey(KEY.right);
      await focusKeyIs(key);
    }
    await pressKey(KEY.right);
    await focusKeyIs('detail-menu');
  });
});

describe('the More menu', () => {
  const open = async () => {
    await ready();
    await focusKeyIs('detail-play');
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.right);
    await focusKeyIs('detail-menu');
    await pressKey(KEY.enter);
    return screen.findByTestId('more-menu');
  };
  const names = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole('button')
      .map((el) => el.textContent);

  it('has the watchlist and Not Interested for a movie with nothing else', async () => {
    serveDetail(server, movieServe());
    setup();
    const menu = await open();
    expect(names(menu)).toEqual(['Add to Watchlist', 'Not Interested']);
    await focusKeyIs('detail-menu-watchlist');
    expect(screen.getByTestId('more-menu')).toBeInTheDocument();
  });

  it('flips the labels with the state', async () => {
    serveDetail(
      server,
      movieServe({ user_state: userState({ in_watchlist: true, not_interested: true }) }),
    );
    setup();
    const menu = await open();
    expect(names(menu)).toEqual(['Remove from Watchlist', 'Show in Recommendations']);
  });

  it('has the same two entries for a series', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          versions: [],
          play_content_id: 'e11',
          play_season_number: 1,
          user_state: userState(),
        }),
      seasons: [seasonOf(1)],
      episodes: (season) => [episodeOf(season, 1)],
    });
    setup({ itemId: 's1' });
    const menu = await open();
    expect(names(menu)).toEqual(['Add to Watchlist', 'Not Interested']);
  });

  it('has no Not Interested when the server sends no user state', async () => {
    serveDetail(server, { item: () => itemDetail() });
    setup();
    const menu = await open();
    expect(names(menu)).toEqual(['Add to Watchlist']);
  });

  it('never offers what a TV does not do', async () => {
    serveDetail(
      server,
      movieServe({ user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }) }),
    );
    setup();
    const menu = await open();
    const text = menu.textContent ?? '';
    for (const left of [
      'Download',
      'Collection',
      'Watch Party',
      'Marker',
      'Allow for',
      'Manage',
      'Shuffle',
    ]) {
      expect(text).not.toContain(left);
    }
  });

  it('adds to the watchlist with PUT, closes, and says so', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server);
    setup();
    const menu = await open();
    fireEvent.click(within(menu).getByRole('button', { name: 'Add to Watchlist' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'PUT', group: 'watchlist', id: 'm1' });
    expect(screen.queryByTestId('more-menu')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('detail-notice')).toHaveTextContent('Added to watchlist'),
    );
  });

  it('removes from the watchlist with DELETE', async () => {
    serveDetail(server, movieServe({ user_state: userState({ in_watchlist: true }) }));
    const writes = serveUserActions(server);
    setup();
    const menu = await open();
    fireEvent.click(within(menu).getByRole('button', { name: 'Remove from Watchlist' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'DELETE', group: 'watchlist', id: 'm1' });
  });

  it('says so when the watchlist cannot be updated, and the next menu shows the old state', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server, { fail: () => true });
    setup();
    const menu = await open();
    fireEvent.click(within(menu).getByRole('button', { name: 'Add to Watchlist' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId('detail-notice')).toHaveTextContent('Failed to update watchlist'),
    );
    fireEvent.click(button('More actions'));
    expect(
      within(await screen.findByTestId('more-menu')).getByRole('button', {
        name: 'Add to Watchlist',
      }),
    ).toBeInTheDocument();
  });

  it('marks Not Interested with PUT and takes it back with DELETE', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server);
    setup();
    const menu = await open();
    fireEvent.click(within(menu).getByRole('button', { name: 'Not Interested' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'PUT', group: 'not-interested', id: 'm1' });
    fireEvent.click(button('More actions'));
    const again = await screen.findByTestId('more-menu');
    fireEvent.click(within(again).getByRole('button', { name: 'Show in Recommendations' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ method: 'DELETE', group: 'not-interested', id: 'm1' });
  });

  it('closes on Back and returns the focus to the More button', async () => {
    serveDetail(server, movieServe());
    setup();
    await open();
    await pressKey(KEY.down);
    await focusKeyIs('detail-menu-not-interested');
    await pressKey(KEY.back);
    await waitFor(() => expect(screen.queryByTestId('more-menu')).toBeNull());
    await focusKeyIs('detail-menu');
    expect(screen.getByTestId('detail-hero')).toBeInTheDocument();
  });
});

describe('round 2: what the first tests left open', () => {
  const heart = () => button(/^(Favorite|Unfavorite)$/);
  const stars = () => screen.getByRole('button', { name: /^(Rating|\d stars?)$/ });
  const lit = () =>
    Array.from(stars().querySelectorAll('.detail-star')).filter(
      (el) => el.getAttribute('data-filled') === 'true',
    ).length;
  const itemUrl = `${BASE_URL}/api/v2/catalog/items/:id`;

  it('keeps the watched toggle disabled until the re-read of the item has answered', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server);
    setup();
    await ready();
    const held = gate();
    // From here on the item read is held back.
    server.use(
      http.get(itemUrl, async () => {
        await held.promise;
        return HttpResponse.json(itemDetail({ user_state: userState() }));
      }),
    );
    fireEvent.click(button('Mark Watched'));
    await waitFor(() => expect(writes).toHaveLength(1));
    // The write has been answered; the page still shows the old state.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(button('Mark Watched')).toBeDisabled();
    await act(async () => held.release());
    await waitFor(() => expect(button('Mark Watched')).toBeEnabled());
  });

  it('reads a mounted Home query again after a heart change', async () => {
    serveDetail(server, movieServe());
    serveUserActions(server);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    let reads = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['home', 'sections', BASE_URL, 'p1'],
      staleTime: Infinity,
      queryFn: () => ++reads,
    });
    const stop = observer.subscribe(() => undefined);
    await waitFor(() => expect(reads).toBe(1));
    setup({ itemId: 'm1' }, queryClient);
    await ready();
    fireEvent.click(heart());
    await waitFor(() => expect(reads).toBe(2));
    stop();
  });

  it('does not light the heart when the watchlist changes on an item without user state', async () => {
    serveDetail(server, { item: () => itemDetail() });
    const held = gate();
    const writes = serveUserActions(server, { gate: held.promise });
    setup();
    await ready();
    fireEvent.click(button('More actions'));
    const menu = await screen.findByTestId('more-menu');
    fireEvent.click(within(menu).getByRole('button', { name: 'Add to Watchlist' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(heart()).toHaveAttribute('aria-pressed', 'false');
    await act(async () => held.release());
  });

  it('keeps the optimistic heart when a read of the item that was under way answers later', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    serveDetail(server, movieServe());
    const writes = serveUserActions(server);
    setup({ itemId: 'm1' }, queryClient);
    await ready();
    const held = gate();
    server.use(
      http.get(itemUrl, async () => {
        await held.promise;
        return HttpResponse.json(itemDetail({ user_state: userState() }));
      }),
    );
    // A read is in flight when the heart is pressed.
    act(() => void queryClient.invalidateQueries({ queryKey: ['detail'] }));
    fireEvent.click(heart());
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => held.release());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(heart()).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks the player when the target episode is known but its episodes are still loading', async () => {
    serveDetail(server, {
      item: () =>
        itemDetail({
          content_id: 's1',
          type: 'series',
          versions: [],
          play_content_id: 'e11',
          play_season_number: 1,
        }),
      seasons: [seasonOf(1)],
      episodes: () => new Promise(() => undefined),
    });
    const { onPlay } = setup({ itemId: 's1' });
    await ready();
    fireEvent.click(primary());
    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'e11', intent: { kind: 'ask' } }),
    );
  });

  it('closes the resume dialog after a choice', async () => {
    serveDetail(
      server,
      movieServe({ user_data: rollup({ position_seconds: 754, duration_seconds: 5400 }) }),
    );
    const { onPlay } = setup({ itemId: 'm1' }, undefined, { stay: true });
    await ready();
    fireEvent.click(primary());
    fireEvent.click(await screen.findByRole('button', { name: 'Resume at 12:34' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('resume-dialog')).toBeNull();
  });

  it.each([
    [false, 'Add to Watchlist', 'lucide-plus', 'lucide-check'],
    [true, 'Remove from Watchlist', 'lucide-check', 'lucide-plus'],
  ])(
    'flips the icon of the watchlist entry with the state (%s)',
    async (on, name, shown, hidden) => {
      serveDetail(server, movieServe({ user_state: userState({ in_watchlist: on }) }));
      setup();
      await ready();
      fireEvent.click(button('More actions'));
      const entry = within(await screen.findByTestId('more-menu')).getByRole('button', { name });
      expect(entry.querySelector(`svg.${shown}`)).not.toBeNull();
      expect(entry.querySelector(`svg.${hidden}`)).toBeNull();
    },
  );

  it('closes the More menu after Not Interested', async () => {
    serveDetail(server, movieServe());
    const writes = serveUserActions(server);
    setup();
    await ready();
    fireEvent.click(button('More actions'));
    const menu = await screen.findByTestId('more-menu');
    fireEvent.click(within(menu).getByRole('button', { name: 'Not Interested' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(screen.queryByTestId('more-menu')).toBeNull();
  });

  it('cancels the pick on Back: the page stays, the stars come back, onBack is not called', async () => {
    serveDetail(server, movieServe({ user_rating: 2 }));
    const { onBack } = setup();
    await ready();
    await focusKeyIs('detail-play');
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.right);
    await focusKeyIs('detail-rating');
    await pressKey(KEY.enter);
    await pressKey(KEY.right);
    expect(lit()).toBe(3);
    await pressKey(KEY.back);
    expect(lit()).toBe(2);
    expect(onBack).not.toHaveBeenCalled();
    // Without the handler Back would ask to exit and take the focus away.
    expect(screen.queryByTestId('exit-dialog')).toBeNull();
    expect(getCurrentFocusKey()).toBe('detail-rating');
  });

  it('shows the saved stars again when the focus leaves the stars while picking', async () => {
    serveDetail(server, movieServe({ user_rating: 2 }));
    setup();
    await ready();
    await focusKeyIs('detail-play');
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.right);
    await focusKeyIs('detail-rating');
    await pressKey(KEY.enter);
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(lit()).toBe(4);
    // The pointer moves the focus to the heart.
    fireEvent.mouseEnter(heart());
    await focusKeyIs('detail-favorite');
    expect(stars()).toHaveAttribute('data-picking', 'false');
    expect(lit()).toBe(2);
  });

  it('words the star group in the singular for 1 and the plural for 2', async () => {
    serveDetail(server, movieServe({ user_rating: 1 }));
    setup();
    await ready();
    expect(stars()).toHaveAccessibleName('1 star');
    cleanup();
    serveDetail(server, movieServe({ user_rating: 2 }));
    setup();
    await ready();
    expect(stars()).toHaveAccessibleName('2 stars');
  });

  it('holds on More when there is no translate pill', async () => {
    serveDetail(server, movieServe());
    setup();
    await ready();
    await focusKeyIs('detail-play');
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.right);
    await focusKeyIs('detail-menu');
    await pressKey(KEY.right);
    await focusKeyIs('detail-menu');
  });

  describe('entering the action row from below', () => {
    const seasons = [seasonOf(1)];

    it('lands on the primary button, not on the button that was focused last', async () => {
      serveDetail(server, {
        item: () =>
          itemDetail({
            content_id: 's1',
            type: 'series',
            versions: [],
            play_content_id: 'e11',
            play_season_number: 1,
          }),
        seasons,
        episodes: (season) => [episodeOf(season, 1)],
      });
      setup({ itemId: 's1' });
      await screen.findByTestId('episode-strip');
      await focusKeyIs('detail-play');
      await pressKey(KEY.right);
      await focusKeyIs('detail-watched');
      await pressKey(KEY.down);
      await focusKeyIs('season:1');
      await pressKey(KEY.up);
      await focusKeyIs('detail-play');
    });

    it('lands on the watched toggle when the primary button is disabled', async () => {
      serveDetail(server, {
        item: () => itemDetail({ content_id: 's1', type: 'series', versions: [] }),
        seasons,
        episodes: () => [],
      });
      setup({ itemId: 's1' });
      await waitFor(() => expect(primary()).toBeDisabled());
      await screen.findByTestId('episodes-empty');
      await focusKeyIs('detail-watched');
      await pressKey(KEY.right);
      await focusKeyIs('detail-favorite');
      await pressKey(KEY.down);
      await focusKeyIs('season:1');
      await pressKey(KEY.up);
      await focusKeyIs('detail-watched');
    });
  });
});

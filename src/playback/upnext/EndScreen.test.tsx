// The end screen (post-roll) on its own: the next episode's block, the countdown states, the
// auto-play switch, the finished state and the On Deck row. The clock is faked for intervals only:
// the navigation and MSW need the real timeouts.
import { useState } from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { setFocus } from '../../app/nav';
import { BASE_URL, account } from '../../test/apiFixtures';
import { episodeOf } from '../../test/detailFixtures';
import { KEY, pressKey } from '../../test/keys';
import {
  onDeckEpisode,
  serveOnDeck,
  type OnDeckEntry,
  type OnDeckServe,
} from '../../test/onDeckFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import type { EpisodeRef } from '../episodes/neighbours';
import type { EpisodeNeighbours } from '../episodes/useEpisodeNeighbours';
import { EndScreen } from './EndScreen';
import { recordAutoAdvance, resetStillWatchingStreak } from './stillWatching';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  window.localStorage.clear();
  resetStillWatchingStreak();
});
afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const NEXT: EpisodeRef = { contentId: 'e12', seasonNumber: 1, episodeNumber: 2, title: 'Der Neue' };
const WITH_NEXT: EpisodeNeighbours = {
  previous: null,
  next: NEXT,
  settled: true,
  nextEntry: episodeOf(1, 2, {
    title: 'Der Neue',
    still_url: '/img/still-12.png',
    air_date: '2008-01-27',
    runtime: 45,
    overview: 'The new one arrives.',
  }),
};
const LAST: EpisodeNeighbours = { previous: null, next: null, settled: true, nextEntry: null };
const UNKNOWN: EpisodeNeighbours = { previous: null, next: null, settled: false, nextEntry: null };

interface Options {
  neighbours?: EpisodeNeighbours;
  /** The season lists are still loading at first; `settle()` of the result brings these in. */
  settleLater?: EpisodeNeighbours;
  ended?: boolean;
  /** Stored settings of the profile. */
  values?: Record<string, unknown>;
  seriesTitle?: string;
  onDeck?: OnDeckEntry[];
  /** The progress list fails, or waits for this. */
  onDeckList?: OnDeckServe['list'];
  /** The server does not know the settings contract. */
  noSettings?: boolean;
  lang?: 'de' | 'en';
}

interface Writes {
  put: { key: string; scope: string | null; body: unknown }[];
  del: { key: string; scope: string | null }[];
}

function setup(options: Options = {}) {
  const writes: Writes = { put: [], del: [] };
  // What the server holds: a write changes it, as the re-read after it must find.
  const stored: Record<string, unknown> = { ...options.values };
  const settings = serveSettings(server, {
    values: stored,
    ...(options.noSettings ? { capabilities: 'fail' as const } : {}),
  });
  serveOnDeck(server, { entries: options.onDeck, list: options.onDeckList });
  server.use(
    http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
      const body = (await request.json()) as { value: unknown };
      stored[String(params.key)] = body.value;
      writes.put.push({
        key: String(params.key),
        scope: new URL(request.url).searchParams.get('scope'),
        body,
      });
      return HttpResponse.json({
        key: String(params.key),
        scope: 'profile',
        value: body.value,
        revision: 1,
      });
    }),
    http.delete(`${BASE_URL}/api/v2/settings/values/:key`, ({ request, params }) => {
      writes.del.push({
        key: String(params.key),
        scope: new URL(request.url).searchParams.get('scope'),
      });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'tok',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const handlers = {
    onPlayNext: vi.fn(),
    onPlayItem: vi.fn(),
    onReturn: vi.fn(),
    onClose: vi.fn(),
  };
  const later = { settle: () => undefined as void };
  function Screen() {
    const [settled, setSettled] = useState(false);
    later.settle = () => setSettled(true);
    return (
      <EndScreen
        seriesId="ser1"
        seriesTitle={'seriesTitle' in options ? options.seriesTitle : 'A Show'}
        neighbours={
          options.settleLater
            ? settled
              ? options.settleLater
              : UNKNOWN
            : (options.neighbours ?? WITH_NEXT)
        }
        ended={options.ended ?? false}
        {...handlers}
      />
    );
  }
  renderWithSilo(<Screen />, {
    session,
    ...(options.lang ? { lang: options.lang } : {}),
    cardPrefs: false,
  });
  return { ...handlers, writes, settings, settle: () => act(() => later.settle()) };
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const playButton = () => screen.getByTestId('player-end-play');

/** Waits for the screen to be ready and holding the focus on its primary button. */
async function ready(testId = 'player-end-play') {
  await waitFor(() => expect(screen.getByTestId(testId)).toHaveFocus());
}

describe('the next episode block', () => {
  it('names the heading, the series, the episode and its facts, with the still and the overview', async () => {
    setup();
    await ready();
    expect(screen.getByRole('dialog', { name: 'Up next' })).toBeInTheDocument();
    expect(screen.getByTestId('player-end-series')).toHaveTextContent('A Show');
    expect(screen.getByTestId('player-end-episode')).toHaveTextContent('S1:E2 — Der Neue');
    expect(screen.getByTestId('player-end-meta')).toHaveTextContent('Jan 27, 2008');
    expect(screen.getByTestId('player-end-meta')).toHaveTextContent('45m');
    expect(screen.getByTestId('player-end-overview')).toHaveTextContent('The new one arrives.');
    expect(screen.getByTestId('player-end-still').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/img/still-12.png'),
    );
  });

  it('names the episode in German with the web’s code', async () => {
    serveSettings(server, {});
    serveOnDeck(server);
    const session = new Session(memoryStorage());
    session.set({
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      user: account,
      profileId: 'p1',
    });
    renderWithSilo(
      <EndScreen
        seriesId="ser1"
        seriesTitle="A Show"
        neighbours={WITH_NEXT}
        ended={false}
        onPlayNext={vi.fn()}
        onPlayItem={vi.fn()}
        onReturn={vi.fn()}
        onClose={vi.fn()}
      />,
      { session, lang: 'de', cardPrefs: false },
    );
    await ready();
    expect(screen.getByTestId('player-end-episode')).toHaveTextContent('S1:F2 — Der Neue');
    expect(screen.getByRole('dialog', { name: 'Als Nächstes' })).toBeInTheDocument();
  });

  it('shows a placeholder where the episode has no still, and no overview line without one', async () => {
    setup({
      neighbours: {
        ...WITH_NEXT,
        nextEntry: episodeOf(1, 2, { title: 'Der Neue', runtime: 0, overview: undefined }),
      },
    });
    await ready();
    expect(screen.getByText('No preview')).toBeInTheDocument();
    expect(screen.queryByTestId('player-end-overview')).toBeNull();
  });

  it('covers the still and the overview of an unwatched episode when spoiler protection is on', async () => {
    setup({
      values: {
        'catalog.hide_unwatched_episode_images': true,
        'catalog.hide_unwatched_episode_overviews': true,
      },
    });
    await waitFor(() => expect(screen.getByTestId('art-protected')).toBeInTheDocument());
    expect(screen.queryByTestId('player-end-overview')).toBeNull();
    expect(screen.getByTestId('player-end-still').querySelector('img[src*="still-12"]')).toBeNull();
  });

  it('shows a skeleton of the block until the season lists are in', () => {
    setup({ neighbours: UNKNOWN });
    expect(screen.getByTestId('player-end-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('player-end-play')).toBeNull();
    expect(screen.queryByTestId('player-end-finished')).toBeNull();
  });
});

describe('Play now and the countdown', () => {
  it('has the focus on Play now when the screen opens, and OK is the viewer’s start', async () => {
    const { onPlayNext } = setup();
    await ready();
    await pressKey(KEY.enter);
    expect(onPlayNext).toHaveBeenCalledTimes(1);
    expect(onPlayNext).toHaveBeenCalledWith(false);
  });

  it('the remote’s Play key plays the next episode as the viewer’s start', async () => {
    const { onPlayNext } = setup();
    await ready();
    fireEvent.keyDown(window, { keyCode: 415 });
    expect(onPlayNext).toHaveBeenCalledWith(false);
  });

  it('says "Starts on its own when the credits end" before the stream has ended, with no countdown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { onPlayNext } = setup();
    await ready();
    expect(screen.getByTestId('player-end-waits')).toHaveTextContent(
      'Starts on its own when the credits end',
    );
    expect(screen.queryByTestId('player-end-ring')).toBeNull();
    advance(60_000);
    expect(onPlayNext).not.toHaveBeenCalled();
  });

  it('after the end counts 10 s with the ring and then starts the next episode by itself', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { onPlayNext } = setup({ ended: true });
    await ready();
    expect(screen.getByTestId('player-end-startsin')).toHaveTextContent('Starts in 10s');
    const ring = screen.getByTestId('player-end-ring');
    const full = Number(ring.getAttribute('stroke-dasharray'));
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
    advance(4000);
    expect(screen.getByTestId('player-end-startsin')).toHaveTextContent('Starts in 6s');
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(full * 0.4);
    expect(onPlayNext).not.toHaveBeenCalled();
    advance(6000);
    expect(onPlayNext).toHaveBeenCalledTimes(1);
    expect(onPlayNext).toHaveBeenCalledWith(true);
  });

  it('keeps counting while the focus moves away from Play now', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { onPlayNext } = setup({ ended: true });
    await ready();
    advance(3000);
    await pressKey(KEY.down);
    await waitFor(() => expect(screen.getByTestId('player-end-autoplay')).toHaveFocus());
    advance(7000);
    expect(onPlayNext).toHaveBeenCalledTimes(1);
    expect(onPlayNext).toHaveBeenCalledWith(true);
  });

  it('has no countdown with auto-play off, though the stream has ended', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { onPlayNext } = setup({ ended: true, values: { 'playback.auto_play_next': false } });
    await waitFor(() =>
      expect(screen.getByTestId('player-end-autoplay')).toHaveAttribute('aria-checked', 'false'),
    );
    expect(screen.queryByTestId('player-end-countdown')).toBeNull();
    advance(60_000);
    expect(onPlayNext).not.toHaveBeenCalled();
  });

  it('has no countdown once the still-watching gate is closed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    for (let i = 0; i < 3; i += 1) recordAutoAdvance();
    const { onPlayNext } = setup({ ended: true });
    await ready();
    expect(screen.queryByTestId('player-end-countdown')).toBeNull();
    advance(60_000);
    expect(onPlayNext).not.toHaveBeenCalled();
    // The switch still shows the setting, not the gate.
    expect(screen.getByTestId('player-end-autoplay')).toHaveAttribute('aria-checked', 'true');
  });

  it('counts down when the gate is open (fewer than N advances)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    for (let i = 0; i < 2; i += 1) recordAutoAdvance();
    setup({ ended: true });
    await ready();
    expect(screen.getByTestId('player-end-countdown')).toBeInTheDocument();
  });
});

describe('the auto-play switch', () => {
  it('shows the profile’s setting and is reached with Down from Play now', async () => {
    setup();
    await ready();
    const toggle = screen.getByTestId('player-end-autoplay');
    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await pressKey(KEY.down);
    await waitFor(() => expect(toggle).toHaveFocus());
    await pressKey(KEY.up);
    await waitFor(() => expect(playButton()).toHaveFocus());
  });

  it('OK writes the setting at the profile and clears this TV’s own value', async () => {
    const { writes } = setup();
    await ready();
    await pressKey(KEY.down);
    await waitFor(() => expect(screen.getByTestId('player-end-autoplay')).toHaveFocus());
    await pressKey(KEY.enter);
    await waitFor(() => expect(writes.del).toHaveLength(1));
    expect(writes.put).toEqual([
      { key: 'playback.auto_play_next', scope: 'profile', body: { value: false } },
    ]);
    expect(writes.del).toEqual([{ key: 'playback.auto_play_next', scope: 'profile_device' }]);
    await waitFor(() =>
      expect(screen.getByTestId('player-end-autoplay')).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('is not offered when the server does not know the setting', async () => {
    setup({ noSettings: true });
    await ready();
    expect(screen.queryByTestId('player-end-autoplay')).toBeNull();
  });
});

describe('leaving', () => {
  it('Up from Play now reaches the close button, and OK there closes', async () => {
    const { onClose } = setup();
    await ready();
    await pressKey(KEY.up);
    await waitFor(() => expect(screen.getByTestId('player-end-close')).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Close' })).toBe(
      screen.getByTestId('player-end-close'),
    );
    await pressKey(KEY.enter);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back closes', async () => {
    const { onClose } = setup();
    await ready();
    await pressKey(KEY.back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the Stop key closes', async () => {
    const { onClose } = setup();
    await ready();
    fireEvent.keyDown(window, { keyCode: 413 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the last episode', () => {
  it('shows the finished state with a Back button that has the focus', async () => {
    const { onClose, onPlayNext } = setup({ neighbours: LAST, ended: true });
    await ready('player-end-back');
    expect(screen.getByRole('dialog', { name: 'Finished' })).toBeInTheDocument();
    expect(screen.getByText('You’ve finished A Show'.replace('’', "'"))).toBeInTheDocument();
    expect(screen.getByText('No more episodes available.')).toBeInTheDocument();
    expect(screen.queryByTestId('player-end-play')).toBeNull();
    expect(screen.queryByTestId('player-end-countdown')).toBeNull();
    await pressKey(KEY.enter);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The Play key has nothing to play.
    fireEvent.keyDown(window, { keyCode: 415 });
    expect(onPlayNext).not.toHaveBeenCalled();
  });

  it('names no series when the heading has none', async () => {
    setup({ neighbours: LAST, seriesTitle: undefined });
    await ready('player-end-back');
    expect(screen.getByText('End of playback')).toBeInTheDocument();
  });
});

describe('the On Deck row', () => {
  it('lists the progress entries in their order as wide cards, without the current series', async () => {
    setup({
      onDeck: [
        onDeckEpisode('x3', { series_title: 'Third Show' }),
        onDeckEpisode('x1', { series_id: 'ser1', series_title: 'A Show', title: 'Same series' }),
        onDeckEpisode('x2', { series_title: 'Other Show' }),
      ],
    });
    const row = await screen.findByTestId('player-end-ondeck');
    expect(within(row).getByText('On Deck')).toBeInTheDocument();
    await waitFor(() => expect(within(row).getAllByTestId('card-title')).toHaveLength(2));
    expect(
      within(row)
        .getAllByTestId('card-title')
        .map((c) => c.textContent),
    ).toEqual(['Third Show', 'Other Show']);
  });

  it('shows title, episode line, minutes left and the bar from position and length', async () => {
    setup({
      onDeck: [
        onDeckEpisode(
          'x2',
          { series_title: 'Other Show', title: 'Pilot', season_number: 1, episode_number: 7 },
          { position_seconds: 600, duration_seconds: 2400 },
        ),
      ],
    });
    const row = await screen.findByTestId('player-end-ondeck');
    expect(within(row).getByTestId('card-title')).toHaveTextContent('Other Show');
    expect(within(row).getByTestId('card-episode')).toHaveTextContent('Season 1 Episode 7 • Pilot');
    expect(within(row).getByTestId('card-status')).toHaveTextContent('30 min left');
    expect(within(row).getByTestId('card-progress')).toHaveStyle({ width: '25%' });
  });

  it('takes the position and length from the progress entry, not from the detail', async () => {
    setup({
      onDeck: [
        onDeckEpisode(
          'x2',
          { series_title: 'Other Show', position_seconds: 2000, duration_seconds: 2100 },
          { position_seconds: 1200, duration_seconds: 2400 },
        ),
      ],
    });
    const row = await screen.findByTestId('player-end-ondeck');
    expect(within(row).getByTestId('card-status')).toHaveTextContent('20 min left');
    expect(within(row).getByTestId('card-progress')).toHaveStyle({ width: '50%' });
  });

  it('leaves out an entry whose detail failed', async () => {
    setup({
      onDeck: [
        { ...onDeckEpisode('x1'), detail: 'fail' },
        onDeckEpisode('x2', { series_title: 'Other Show' }),
      ],
    });
    const row = await screen.findByTestId('player-end-ondeck');
    await waitFor(() => expect(within(row).getAllByTestId('card-title')).toHaveLength(1));
    expect(within(row).getByTestId('card-title')).toHaveTextContent('Other Show');
  });

  it('is not shown when nothing else is on deck', async () => {
    setup({
      onDeck: [onDeckEpisode('x1', { series_id: 'ser1' })],
    });
    await ready();
    await waitFor(() => expect(screen.queryByTestId('row-skeleton')).toBeNull());
    expect(screen.queryByTestId('player-end-ondeck')).toBeNull();
  });

  it('is not shown when the progress list is empty', async () => {
    setup({ onDeck: [] });
    await ready();
    await waitFor(() => expect(screen.queryByTestId('row-skeleton')).toBeNull());
    expect(screen.queryByTestId('player-end-ondeck')).toBeNull();
  });

  it('is not shown, and leaves no skeleton, when the progress list fails', async () => {
    setup({ onDeckList: 'fail' });
    await ready();
    await waitFor(() => expect(screen.queryByTestId('row-skeleton')).toBeNull());
    expect(screen.queryByTestId('player-end-ondeck')).toBeNull();
  });

  it('is reached with Down twice from Play now, OK plays the card, and Up returns to the switch', async () => {
    const { onPlayItem } = setup({
      onDeck: [onDeckEpisode('x2', { series_id: 'other', title: 'Pilot', series_title: 'Other' })],
    });
    const row = await screen.findByTestId('player-end-ondeck');
    await ready();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    const card = within(row).getByRole('button', { name: /Other/ });
    await waitFor(() => expect(card).toHaveFocus());
    await pressKey(KEY.up);
    await waitFor(() => expect(screen.getByTestId('player-end-autoplay')).toHaveFocus());
    await pressKey(KEY.down);
    await waitFor(() => expect(card).toHaveFocus());
    await pressKey(KEY.enter);
    expect(onPlayItem).toHaveBeenCalledTimes(1);
    expect(onPlayItem.mock.calls[0]![0]).toMatchObject({ content_id: 'x2' });
  });

  it('shows a row skeleton while the progress list is read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    serveSettings(server, {});
    serveOnDeck(server, { list: gate });
    const session = new Session(memoryStorage());
    session.set({
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      user: account,
      profileId: 'p1',
    });
    renderWithSilo(
      <EndScreen
        seriesId="ser1"
        seriesTitle="A Show"
        neighbours={WITH_NEXT}
        ended={false}
        onPlayNext={vi.fn()}
        onPlayItem={vi.fn()}
        onReturn={vi.fn()}
        onClose={vi.fn()}
      />,
      { session, cardPrefs: false },
    );
    expect(await screen.findByTestId('row-skeleton')).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByTestId('row-skeleton')).toBeNull());
  });

  it('shows the skeleton in the row’s own card size, three cards and a fourth', async () => {
    serveSettings(server, {});
    serveOnDeck(server, { list: new Promise(() => undefined) });
    const session = new Session(memoryStorage());
    session.set({
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      user: account,
      profileId: 'p1',
    });
    renderWithSilo(
      <EndScreen
        seriesId="ser1"
        seriesTitle="A Show"
        neighbours={WITH_NEXT}
        ended={false}
        onPlayNext={vi.fn()}
        onPlayItem={vi.fn()}
        onReturn={vi.fn()}
        onClose={vi.fn()}
      />,
      { session, cardPrefs: false },
    );
    const skeleton = await screen.findByTestId('row-skeleton');
    const slots = skeleton.querySelectorAll<HTMLElement>('.row-slot');
    expect(Array.from(slots, (slot) => slot.style.left)).toEqual([
      '0px',
      '256px',
      '512px',
      '768px',
    ]);
    expect(skeleton.querySelector<HTMLElement>('.row-track')!.style.left).toBe('12px');
  });
});

describe('the mini player', () => {
  it('is a button with the caption, in English', async () => {
    setup();
    await ready();
    const mini = screen.getByTestId('player-end-mini');
    expect(mini.tagName).toBe('BUTTON');
    expect(mini).toHaveTextContent('Still playing · Press OK to return');
    expect(mini).toHaveAttribute('data-ended', 'false');
    expect(mini).toBeEnabled();
  });

  it('has the caption in German', async () => {
    setup({ lang: 'de' });
    await ready();
    expect(screen.getByTestId('player-end-mini')).toHaveTextContent(
      'Läuft noch · OK zum Zurückkehren',
    );
  });

  it('OK on it and a click on it return to the picture', async () => {
    const { onReturn } = setup();
    await ready();
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
    await pressKey(KEY.enter);
    expect(onReturn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('player-end-mini'));
    expect(onReturn).toHaveBeenCalledTimes(2);
  });

  it('is reached with Left from Play now, and Right goes back to it', async () => {
    setup();
    await ready();
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
    await pressKey(KEY.right);
    await waitFor(() => expect(playButton()).toHaveFocus());
  });

  it('is reached with Left from the auto-play switch', async () => {
    setup();
    await ready();
    await pressKey(KEY.down);
    await waitFor(() => expect(screen.getByTestId('player-end-autoplay')).toHaveFocus());
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
  });

  it('is reached with Left from the first On Deck card but not from the second', async () => {
    setup({
      onDeck: [
        onDeckEpisode('x2', { series_id: 'other', series_title: 'Other', title: 'Pilot' }),
        onDeckEpisode('x3', { series_id: 'third', series_title: 'Third', title: 'Pilot' }),
      ],
    });
    const row = await screen.findByTestId('player-end-ondeck');
    await ready();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    const first = within(row).getByRole('button', { name: /Other/ });
    const second = within(row).getByRole('button', { name: /Third/ });
    await waitFor(() => expect(first).toHaveFocus());
    await pressKey(KEY.right);
    await waitFor(() => expect(second).toHaveFocus());
    await pressKey(KEY.left);
    await waitFor(() => expect(first).toHaveFocus());
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
  });

  it('is reached from the Back button of the finished state, and Right returns to it', async () => {
    setup({ neighbours: LAST });
    await ready('player-end-back');
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
    await pressKey(KEY.right);
    await waitFor(() => expect(screen.getByTestId('player-end-back')).toHaveFocus());
  });

  it('leaves the focus where the viewer moved when the season lists arrive late', async () => {
    const { settle } = setup({ settleLater: WITH_NEXT });
    await screen.findByTestId('player-end-loading');
    // The viewer reaches the close button while the block is still a skeleton.
    await act(() => setFocus('player-end-close'));
    await waitFor(() => expect(screen.getByTestId('player-end-close')).toHaveFocus());
    settle();
    await screen.findByTestId('player-end-play');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByTestId('player-end-close')).toHaveFocus();
  });

  it('takes the focus to the primary button when the season lists arrive late and nothing was chosen', async () => {
    const { settle } = setup({ settleLater: WITH_NEXT });
    await screen.findByTestId('player-end-loading');
    settle();
    await ready();
  });

  it('keeps the focus on itself for Up and Down', async () => {
    setup();
    await ready();
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
    await pressKey(KEY.up);
    await pressKey(KEY.down);
    expect(screen.getByTestId('player-end-mini')).toHaveFocus();
  });

  it('fades out and leaves the navigation once the stream has ended', async () => {
    setup({ ended: true });
    await ready();
    const mini = screen.getByTestId('player-end-mini');
    expect(mini).toHaveAttribute('data-ended', 'true');
    expect(mini).toBeDisabled();
    await pressKey(KEY.left);
    expect(playButton()).toHaveFocus();
  });
});

describe('the On Deck cards in the column', () => {
  it('has a progress bar on its cards and no quality or audio badges', async () => {
    const { settings } = setup({
      onDeck: [
        onDeckEpisode('x2', {
          series_id: 'other',
          series_title: 'Other',
          title: 'Pilot',
          overlay_summary: {
            resolution: '1080p',
            hdr: 'DV',
            audio: 'EAC3',
            release_type: 'BluRay',
          },
        }),
      ],
    });
    const row = await screen.findByTestId('player-end-ondeck');
    expect(within(row).getByTestId('card-progress')).toBeInTheDocument();
    // The badges would come once the profile's settings and the server's defaults are in.
    await waitFor(() => expect(settings.overlayConfig.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(row).queryAllByTestId('card-badge')).toHaveLength(0);
  });
});

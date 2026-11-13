// The end screen (post-roll) on its own: the next episode's block, the countdown states, the
// auto-play switch, the finished state and the On Deck row. The clock is faked for intervals only:
// the navigation and MSW need the real timeouts.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import { episodeOf } from '../../test/detailFixtures';
import { homeSection, resumeEpisode, serveHome } from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
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
  ended?: boolean;
  /** Stored settings of the profile. */
  values?: Record<string, unknown>;
  seriesTitle?: string;
  onDeck?: ReturnType<typeof resumeEpisode>[];
  /** The server does not know the settings contract. */
  noSettings?: boolean;
}

interface Writes {
  put: { key: string; scope: string | null; body: unknown }[];
  del: { key: string; scope: string | null }[];
}

function setup(options: Options = {}) {
  const writes: Writes = { put: [], del: [] };
  // What the server holds: a write changes it, as the re-read after it must find.
  const stored: Record<string, unknown> = { ...options.values };
  serveSettings(server, {
    values: stored,
    ...(options.noSettings ? { capabilities: 'fail' as const } : {}),
  });
  serveHome(server, {
    sections: [
      homeSection('continue_watching', 0, {
        section_type: 'continue_watching',
        items: options.onDeck ?? [],
      }),
    ],
  });
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
    onClose: vi.fn(),
  };
  renderWithSilo(
    <EndScreen
      seriesId="ser1"
      seriesTitle={'seriesTitle' in options ? options.seriesTitle : 'A Show'}
      neighbours={options.neighbours ?? WITH_NEXT}
      ended={options.ended ?? false}
      {...handlers}
    />,
    { session, cardPrefs: false },
  );
  return { ...handlers, writes };
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
    serveHome(server, { sections: [] });
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
  it('lists the continue-watching items without the current series, each as a wide card', async () => {
    setup({
      onDeck: [
        resumeEpisode('x1', { series_id: 'ser1', series_title: 'A Show', title: 'Same series' }),
        resumeEpisode('x2', {
          series_id: 'other',
          series_title: 'Other Show',
          title: 'Pilot',
          season_number: 1,
          episode_number: 7,
          position_seconds: 600,
          duration_seconds: 2400,
        }),
      ],
    });
    const row = await screen.findByTestId('player-end-ondeck');
    expect(within(row).getByText('On Deck')).toBeInTheDocument();
    const cards = within(row).getAllByTestId('card-title');
    expect(cards.map((c) => c.textContent)).toEqual(['Other Show']);
    expect(within(row).getByTestId('card-episode')).toHaveTextContent('Season 1 Episode 7 • Pilot');
    expect(within(row).getByTestId('card-status')).toHaveTextContent('30 min left');
    expect(within(row).getByTestId('card-progress')).toBeInTheDocument();
  });

  it('is not shown when nothing else is on deck', async () => {
    setup({
      onDeck: [resumeEpisode('x1', { series_id: 'ser1' })],
    });
    await ready();
    await waitFor(() => expect(screen.queryByTestId('row-skeleton')).toBeNull());
    expect(screen.queryByTestId('player-end-ondeck')).toBeNull();
  });

  it('is reached with Down twice from Play now, OK plays the card, and Up returns to the switch', async () => {
    const { onPlayItem } = setup({
      onDeck: [resumeEpisode('x2', { series_id: 'other', title: 'Pilot', series_title: 'Other' })],
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

  it('shows a row skeleton while Home’s list is read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    serveSettings(server, {});
    server.use(
      http.get(`${BASE_URL}/api/v2/home/capabilities`, () =>
        HttpResponse.json({ allowed: true, revision: 'r', state: 'available' }),
      ),
      http.get(`${BASE_URL}/api/v2/home/sections`, async () => {
        await gate;
        return HttpResponse.json({ sections: [] });
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
    renderWithSilo(
      <EndScreen
        seriesId="ser1"
        seriesTitle="A Show"
        neighbours={WITH_NEXT}
        ended={false}
        onPlayNext={vi.fn()}
        onPlayItem={vi.fn()}
        onClose={vi.fn()}
      />,
      { session, cardPrefs: false },
    );
    expect(await screen.findByTestId('row-skeleton')).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByTestId('row-skeleton')).toBeNull());
  });
});

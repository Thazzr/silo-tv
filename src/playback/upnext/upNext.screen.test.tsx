// The credits card and the end screen on the real PlayerScreen: the markers of the watch data, the
// position the video reports, the profile's settings, the keys. The session loads with real timers
// (MSW needs them); the intervals of the countdowns are faked afterwards.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import { episodeOf, seasonOf } from '../../test/detailFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import { homeSection, resumeEpisode, serveHome } from '../../test/homeFixtures';
import { KEY, pressKey } from '../../test/keys';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackCapabilities,
  playbackPlan,
  servePlayback,
  until,
  watchDetail,
  watchVersion,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { PORTRAIT_HASH, stubCanvas } from '../../test/thumbhashFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { clearInstallationCache } from '../session/startSession';
import { isStillWatchingGated, recordAutoAdvance, resetStillWatchingStreak } from './stillWatching';

type S = components['schemas'];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let restoreMedia: () => void;
const onTestEnd: (() => void)[] = [];
beforeEach(() => {
  window.localStorage.clear();
  resetStillWatchingStreak();
  clearInstallationCache();
  restoreMedia = installFakeMedia();
});
afterEach(async () => {
  for (const undo of onTestEnd.splice(0)) undo();
  vi.useRealTimers();
  restoreMedia();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const key = (keyCode: number) => fireEvent.keyDown(window, { keyCode });
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** 5400 s long, the credits run to the end. */
const CREDITS = { start_seconds: 5100, end_seconds: 5400 } as const;
const PREVIEW = { start_seconds: 5300, end_seconds: 5400 } as const;

const episodeWatch = (
  season: number,
  episode: number,
  markers: Partial<Pick<S['WatchFileVersion'], 'credits' | 'preview'>> = {},
) =>
  watchDetail({
    content_id: `e${season}${episode}`,
    type: 'episode',
    series_id: 'ser1',
    series_title: 'A Show',
    season_number: season,
    episode_number: episode,
    title: `Episode ${season}.${episode}`,
    versions: [watchVersion({ ...markers })],
  });

interface Options {
  watch?: S['WatchDetail'];
  /** The episodes of season 1; the second one is the next. */
  episodes?: S['Episode'][];
  values?: Record<string, unknown>;
  onDeck?: S['CatalogItem'][];
  /** The season's episode list is not found: there are no neighbours to read. */
  noEpisodes?: boolean;
  /** The season's episode list waits for this before it answers. */
  holdEpisodes?: Promise<void>;
  /** The player was opened by an automatic start. */
  automatic?: boolean;
  /** The settings answer is awaited before the profile's skip label appears (always, here). */
  threshold?: string;
  /** The playback plan of the episode. */
  plan?: S['PlaybackPlan'];
  /** The button an OK keydown presses before the player's own key handling sees that keydown. */
  pressedOn?: string;
}

const STILLS = [
  episodeOf(1, 1, { still_url: '/img/still-11.png' }),
  episodeOf(1, 2, { still_url: '/img/still-12.png', air_date: '2008-01-27' }),
];

async function mount(options: Options = {}) {
  const watch = options.watch ?? episodeWatch(1, 1, { credits: CREDITS });
  const calls = servePlayback(server, {
    start: [playableDecision(options.plan ?? playbackPlan())],
    watch,
    capabilities: playbackCapabilities({
      features: ['playback_plan_v3', 'sequenced_progress_v1'],
    }),
  });
  serveSettings(server, { values: options.values });
  serveHome(server, {
    sections: [
      homeSection('continue_watching', 0, {
        section_type: 'continue_watching',
        items: options.onDeck ?? [],
      }),
    ],
  });
  server.use(
    http.get(`${BASE_URL}/api/v2/catalog/series/*`, ({ request }) => {
      const path = new URL(request.url).pathname;
      const match = /\/seasons(?:\/(\d+)\/episodes)?$/.exec(path);
      if (!match) return new HttpResponse(null, { status: 404 });
      if (match[1] === undefined) return HttpResponse.json({ items: [seasonOf(1)] });
      if (options.holdEpisodes)
        return options.holdEpisodes.then(() =>
          HttpResponse.json({ items: options.episodes ?? STILLS }),
        );
      if (options.noEpisodes) return new HttpResponse(null, { status: 404 });
      return HttpResponse.json({ items: options.episodes ?? STILLS });
    }),
  );
  if (options.threshold)
    window.localStorage.setItem('silo-tv.settings.stillWatchingThreshold', options.threshold);
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const onExit = vi.fn();
  const onEpisode = vi.fn();
  const view = renderWithSilo(
    <PlayerScreen
      contentId={watch.content_id}
      title={watch.title}
      onExit={onExit}
      onEpisode={onEpisode}
      automatic={options.automatic}
    />,
    { session, cardPrefs: false },
  );
  if (options.pressedOn) {
    // Registered before the player's own key listener: the end screen's button acts on the
    // keydown and React renders it (effects included) before the next listener gets the same
    // event. A browser does that between two listeners of a real event (it runs the microtasks
    // there); jsdom, dispatching from a script, does not, so the test does it by hand.
    const testId = options.pressedOn;
    const press = (e: KeyboardEvent) => {
      if (e.keyCode === KEY.enter) act(() => screen.queryByTestId(testId)?.click());
    };
    window.addEventListener('keydown', press);
    onTestEnd.push(() => window.removeEventListener('keydown', press));
  }
  await screen.findByTestId('player');
  const video = view.container.querySelector('video')!;
  const state = fakeVideo(video);
  state.duration = 5400;
  fireEvent.playing(video);
  await screen.findByLabelText('10 seconds back');
  // The neighbours are in once an episode has the button of its neighbour: Next for the first
  // episode of the two, Previous for the last.
  if (watch.type === 'episode' && !options.noEpisodes && !options.holdEpisodes) {
    const name = watch.episode_number === 1 ? 'Next episode' : 'Previous episode';
    await screen.findByRole('button', { name, hidden: true });
  }
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const at = (seconds: number) => {
    state.currentTime = seconds;
    fireEvent.timeUpdate(video);
  };
  return { calls, video, state, onExit, onEpisode, at, view };
}

const card = () => screen.queryByTestId('player-upnext');
const endScreen = () => screen.queryByTestId('player-end');

describe('the credits card', () => {
  it('shows from the start of the credits with the countdown, the next episode and Play now focused', async () => {
    const { at } = await mount();
    at(5099);
    expect(card()).toBeNull();
    at(5100);
    expect(card()).not.toBeNull();
    expect(screen.getByTestId('player-upnext-in')).toHaveTextContent('Up next in 10s');
    expect(screen.getByTestId('player-upnext-episode')).toHaveTextContent('S1:E2 — Episode 1.2');
    expect(screen.getByTestId('player-upnext-play')).toHaveFocus();
    expect(screen.getByTestId('player-upnext-still').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/img/still-12.png'),
    );
    // The skip pill gives way, as the web's does.
    expect(screen.queryByTestId('player-skip')).toBeNull();
  });

  it('OK is Play now: the viewer’s start, the session stopped, and no play or pause', async () => {
    const { at, state, onEpisode, calls } = await mount();
    at(5100);
    key(KEY.enter);
    expect(onEpisode).toHaveBeenCalledTimes(1);
    expect(onEpisode).toHaveBeenCalledWith({ contentId: 'e12', title: 'Episode 1.2' });
    expect(state.play).not.toHaveBeenCalled();
    expect(state.pause).not.toHaveBeenCalled();
    vi.useRealTimers();
    await until(() => calls.stop.length === 1);
  });

  it('runs out after 10 s into an automatic start', async () => {
    const { at, onEpisode } = await mount();
    at(5100);
    advance(9000);
    expect(screen.getByTestId('player-upnext-in')).toHaveTextContent('Up next in 1s');
    expect(onEpisode).not.toHaveBeenCalled();
    advance(1000);
    expect(onEpisode).toHaveBeenCalledTimes(1);
    expect(onEpisode).toHaveBeenCalledWith({
      contentId: 'e12',
      title: 'Episode 1.2',
      automatic: true,
    });
  });

  it('Right to Cancel and OK hides it for the rest of the episode, and the skip pill returns', async () => {
    const { at, onEpisode } = await mount();
    at(5100);
    key(KEY.right);
    expect(screen.getByTestId('player-upnext-cancel')).toHaveAttribute('data-focused', 'true');
    key(KEY.enter);
    expect(card()).toBeNull();
    expect(screen.getByTestId('player-skip')).toHaveTextContent('Skip credits');
    advance(20_000);
    expect(onEpisode).not.toHaveBeenCalled();
    // Out of the credits and back in: cancelled for this episode, so it stays away.
    at(100);
    at(5200);
    expect(card()).toBeNull();
  });

  it('Back cancels it, and then works as usual', async () => {
    const { at, onEpisode, onExit } = await mount();
    at(5100);
    key(461);
    expect(card()).toBeNull();
    advance(20_000);
    expect(onEpisode).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('OK on Cancel is not a play or pause either', async () => {
    const { at, state } = await mount();
    at(5100);
    key(KEY.right);
    key(KEY.enter);
    expect(state.pause).not.toHaveBeenCalled();
    expect(state.play).not.toHaveBeenCalled();
  });

  it('a click on the card outside its buttons is not a click on the picture', async () => {
    const { at, state } = await mount();
    at(5100);
    fireEvent.click(screen.getByTestId('player-upnext-in'));
    fireEvent.click(screen.getByTestId('player-upnext'));
    expect(state.pause).not.toHaveBeenCalled();
    expect(state.play).not.toHaveBeenCalled();
  });

  it('a click on Play now is the viewer’s start', async () => {
    const { at, onEpisode } = await mount();
    at(5100);
    fireEvent.click(screen.getByTestId('player-upnext-play'));
    expect(onEpisode).toHaveBeenCalledWith({ contentId: 'e12', title: 'Episode 1.2' });
  });

  it('does not show without a credits marker', async () => {
    const plain = await mount({ watch: episodeWatch(1, 1) });
    plain.at(5200);
    expect(card()).toBeNull();
  });

  it('does not show when the credits stop short of the end', async () => {
    const { at } = await mount({
      watch: episodeWatch(1, 1, { credits: { start_seconds: 5100, end_seconds: 5300 } }),
    });
    at(5200);
    expect(card()).toBeNull();
  });

  it('does not show on the last episode, which has no next', async () => {
    const { at } = await mount({
      watch: episodeWatch(1, 2, { credits: CREDITS }),
    });
    at(5200);
    expect(card()).toBeNull();
  });

  it('starts at the preview when the profile allows it', async () => {
    const { at } = await mount({
      watch: episodeWatch(1, 1, { preview: PREVIEW }),
      values: { 'playback.auto_play_next_preview': true },
    });
    at(5299);
    expect(card()).toBeNull();
    at(5300);
    expect(card()).not.toBeNull();
  });

  it('ignores the preview when the profile does not allow it', async () => {
    const { at } = await mount({ watch: episodeWatch(1, 1, { preview: PREVIEW }) });
    at(5350);
    expect(card()).toBeNull();
  });

  it('shows even with auto-play off: the web’s card does not ask for that setting', async () => {
    const { at } = await mount({ values: { 'playback.auto_play_next': false } });
    at(5100);
    expect(card()).not.toBeNull();
  });

  it('is held back once the still-watching gate is closed', async () => {
    recordAutoAdvance();
    const { at } = await mount({ automatic: true, threshold: '1' });
    at(5100);
    expect(card()).toBeNull();
  });

  it('shows while the gate has advances left', async () => {
    recordAutoAdvance();
    const { at } = await mount({ automatic: true, threshold: '2' });
    at(5100);
    expect(card()).not.toBeNull();
  });

  it('a player the viewer opened clears the count of automatic advances', async () => {
    recordAutoAdvance();
    const { at } = await mount({ threshold: '1' });
    at(5100);
    expect(card()).not.toBeNull();
  });

  it('an automatic start counts, and a viewer’s start does not', async () => {
    window.localStorage.setItem('silo-tv.settings.stillWatchingThreshold', '1');
    const viewer = await mount();
    viewer.at(5100);
    key(KEY.enter);
    expect(isStillWatchingGated()).toBe(false);
    cleanup();
    vi.useRealTimers();
    const automatic = await mount();
    automatic.at(5100);
    advance(10_000);
    expect(isStillWatchingGated()).toBe(true);
  });
});

describe('the end screen', () => {
  it('comes up 30 s before the end over the playing picture, and not a second earlier', async () => {
    const { at, state } = await mount();
    at(5369);
    expect(endScreen()).toBeNull();
    at(5370);
    expect(endScreen()).not.toBeNull();
    expect(screen.getByTestId('player-end-series')).toHaveTextContent('A Show');
    expect(screen.getByTestId('player-end-episode')).toHaveTextContent('S1:E2 — Episode 1.2');
    expect(screen.getByTestId('player-end-waits')).toHaveTextContent(
      'Starts on its own when the credits end',
    );
    // The video keeps playing underneath.
    expect(state.pause).not.toHaveBeenCalled();
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'false');
  });

  it('takes over from the credits card', async () => {
    const { at } = await mount();
    at(5100);
    expect(card()).not.toBeNull();
    at(5375);
    expect(card()).toBeNull();
    expect(endScreen()).not.toBeNull();
  });

  it('starts its countdown only when the video has ended, then plays the next episode by itself', async () => {
    const { at, video, state, onEpisode } = await mount();
    at(5375);
    advance(30_000);
    expect(onEpisode).not.toHaveBeenCalled();
    state.ended = true;
    state.currentTime = 5400;
    fireEvent.ended(video);
    await waitFor(() =>
      expect(screen.getByTestId('player-end-startsin')).toHaveTextContent('Starts in 10s'),
    );
    advance(10_000);
    expect(onEpisode).toHaveBeenCalledTimes(1);
    expect(onEpisode).toHaveBeenCalledWith({
      contentId: 'e12',
      title: 'Episode 1.2',
      automatic: true,
    });
  });

  it('is entered on the end of the stream when the 30 s were missed', async () => {
    const { at, video, state } = await mount();
    at(100);
    expect(endScreen()).toBeNull();
    state.ended = true;
    fireEvent.ended(video);
    await waitFor(() => expect(endScreen()).not.toBeNull());
    expect(screen.getByTestId('player-end-startsin')).toHaveTextContent('Starts in 10s');
  });

  it('is never entered by a movie: its end closes the player', async () => {
    const { at, video, state, onExit } = await mount({ watch: watchDetail() });
    at(5390);
    expect(endScreen()).toBeNull();
    state.ended = true;
    fireEvent.ended(video);
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(endScreen()).toBeNull();
  });

  it('shows the finished state for the last episode', async () => {
    const { at } = await mount({ watch: episodeWatch(1, 2) });
    at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-finished')).toBeInTheDocument());
    expect(screen.getByText("You've finished A Show")).toBeInTheDocument();
  });

  it('shows the finished state, not a skeleton for good, when the season list cannot be read', async () => {
    const { at } = await mount({ noEpisodes: true });
    at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-finished')).toBeInTheDocument());
    expect(screen.queryByTestId('player-end-loading')).toBeNull();
  });

  it('waits behind a skeleton while the season lists are read, then shows the next episode', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { at } = await mount({ holdEpisodes: hold });
    at(5380);
    expect(screen.getByTestId('player-end-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('player-end-finished')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toBeInTheDocument());
    expect(screen.queryByTestId('player-end-loading')).toBeNull();
  });

  it('has the keys: OK is Play now (not a pause), and the picture is not clickable through it', async () => {
    vi.useRealTimers();
    const { at, state, onEpisode } = await mount();
    vi.useRealTimers();
    at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    fireEvent.click(screen.getByTestId('player-end'));
    expect(state.pause).not.toHaveBeenCalled();
    await pressKey(KEY.enter);
    expect(onEpisode).toHaveBeenCalledWith({ contentId: 'e12', title: 'Episode 1.2' });
    expect(state.pause).not.toHaveBeenCalled();
    expect(state.play).not.toHaveBeenCalled();
  });

  it('Back and the close button stop the session and leave the player', async () => {
    const first = await mount();
    first.at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    vi.useRealTimers();
    fireEvent.keyDown(window, { keyCode: KEY.back });
    expect(first.onExit).toHaveBeenCalledTimes(1);
    await until(() => first.calls.stop.length === 1);
    cleanup();

    const second = await mount();
    vi.useRealTimers();
    second.at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    fireEvent.click(screen.getByTestId('player-end-close'));
    expect(second.onExit).toHaveBeenCalledTimes(1);
  });

  it('plays an On Deck item as the viewer’s start, and leaves the current series out of the row', async () => {
    vi.useRealTimers();
    const { at, onEpisode } = await mount({
      onDeck: [
        resumeEpisode('x1', { series_id: 'ser1', series_title: 'A Show', title: 'Same' }),
        resumeEpisode('x2', { series_id: 'other', series_title: 'Other Show', title: 'Pilot' }),
      ],
    });
    vi.useRealTimers();
    at(5380);
    const row = await screen.findByTestId('player-end-ondeck');
    expect(
      within(row)
        .getAllByTestId('card-title')
        .map((c) => c.textContent),
    ).toEqual(['Other Show']);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await waitFor(() =>
      expect(within(row).getByRole('button', { name: /Other Show/ })).toHaveFocus(),
    );
    await pressKey(KEY.enter);
    expect(onEpisode).toHaveBeenCalledWith({ contentId: 'x2', title: 'Pilot' });
  });

  it('lets the Magic Remote wheel move its focus, where the playing picture ignores it', async () => {
    vi.useRealTimers();
    const { at } = await mount();
    vi.useRealTimers();
    const before = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    await act(async () => {
      window.dispatchEvent(wheel);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(wheel.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByTestId('player-end-autoplay')).toHaveFocus());
  });

  it('does not let the controls act on a key while it shows', async () => {
    vi.useRealTimers();
    const { at, state } = await mount({
      onDeck: [],
    });
    vi.useRealTimers();
    at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    await pressKey(KEY.up);
    expect(screen.getByTestId('player-end-close')).toHaveFocus();
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'false');
    expect(state.pause).not.toHaveBeenCalled();
  });
});

// The fake element starts paused, so the remote's Play key starts it: the controls hear it again.
const PLAY_KEY = 415;
const player = () => screen.getByTestId('player');

/**
 * A press as the TV delivers it: the keydown and the keyup reach the window one by one (mount with
 * `pressedOn`, so the end screen is already gone when the player's own key handling gets the
 * same keydown).
 */
async function realPress() {
  window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: KEY.enter, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { keyCode: KEY.enter, bubbles: true }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('the mini player', () => {
  it('shrinks the picture into the mini player while the stream plays, and takes it back full size', async () => {
    const { at } = await mount();
    expect(player()).not.toHaveAttribute('data-end');
    at(5380);
    expect(player()).toHaveAttribute('data-end', 'mini');
    expect(screen.getByTestId('player-end-mini')).toHaveTextContent('Still playing');
  });

  it('fades the picture out when the stream ends, and the mini player leaves the focus', async () => {
    vi.useRealTimers();
    const { at, video, state } = await mount();
    vi.useRealTimers();
    at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
    state.ended = true;
    fireEvent.ended(video);
    await waitFor(() => expect(player()).toHaveAttribute('data-end', 'ended'));
    expect(screen.getByTestId('player-end-mini')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
  });

  it('OK on it closes the end screen, gives the full picture back and the keys work again', async () => {
    vi.useRealTimers();
    const { at, state, onEpisode } = await mount();
    vi.useRealTimers();
    at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
    await pressKey(KEY.enter);
    expect(endScreen()).toBeNull();
    expect(screen.queryByTestId('player-end-backdrop')).toBeNull();
    expect(player()).not.toHaveAttribute('data-end');
    expect(state.play).not.toHaveBeenCalled();
    // The press that returned is over; the next key is the viewer's.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    key(PLAY_KEY);
    expect(state.play).toHaveBeenCalledTimes(1);
    expect(onEpisode).not.toHaveBeenCalled();
  });

  it('one OK acts once: the same press does not also pause the picture it returns to', async () => {
    vi.useRealTimers();
    const { at, state } = await mount({ pressedOn: 'player-end-mini', watch: episodeWatch(1, 1) });
    vi.useRealTimers();
    at(5380);
    await waitFor(() => expect(screen.getByTestId('player-end-play')).toHaveFocus());
    await pressKey(KEY.left);
    await waitFor(() => expect(screen.getByTestId('player-end-mini')).toHaveFocus());
    // A real press: the events reach the window one by one, not batched by a test helper, so the
    // end screen is already gone when the player's own key handling gets the same keydown.
    await realPress();
    expect(endScreen()).toBeNull();
    // The press that returned did not also act as OK on the hidden controls: they stay hidden
    // and the playback is as it was.
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'false');
    expect(state.play).not.toHaveBeenCalled();
    expect(state.pause).not.toHaveBeenCalled();
    // The next press is the viewer's again.
    key(PLAY_KEY);
    expect(state.play).toHaveBeenCalledTimes(1);
  });

  it('a click on it does the same', async () => {
    vi.useRealTimers();
    const { at } = await mount();
    vi.useRealTimers();
    at(5380);
    fireEvent.click(await screen.findByTestId('player-end-mini'));
    expect(endScreen()).toBeNull();
    expect(player()).not.toHaveAttribute('data-end');
  });

  it('is not entered by the last 30 s again after the return, but by the stream’s end', async () => {
    vi.useRealTimers();
    const { at, video, state } = await mount();
    vi.useRealTimers();
    at(5380);
    fireEvent.click(await screen.findByTestId('player-end-mini'));
    expect(endScreen()).toBeNull();
    at(100);
    at(5385);
    at(5399);
    expect(endScreen()).toBeNull();
    state.ended = true;
    fireEvent.ended(video);
    await waitFor(() => expect(endScreen()).not.toBeNull());
    expect(player()).toHaveAttribute('data-end', 'ended');
    expect(screen.getByTestId('player-end-startsin')).toHaveTextContent('Starts in 10s');
  });

  it('holds the credits card off after the return: it would start the next episode under the viewer', async () => {
    vi.useRealTimers();
    const { at } = await mount();
    vi.useRealTimers();
    at(5380);
    fireEvent.click(await screen.findByTestId('player-end-mini'));
    expect(card()).toBeNull();
    at(5200);
    expect(card()).toBeNull();
  });

  it('keeps the player’s own layers away while the end screen shows: no subtitles', async () => {
    vi.useRealTimers();
    server.use(
      http.get(
        `${BASE_URL}/api/v2/stream/${SESSION_ID}/subtitles/:name`,
        () =>
          new HttpResponse('WEBVTT\n\n01:28:20.000 --> 01:29:55.000\nLast words', {
            headers: { 'content-type': 'text/vtt' },
          }),
      ),
    );
    const { at } = await mount({
      plan: playbackPlan({
        subtitle: {
          mode: 'render',
          inventory: [],
          artifact: {
            url: `/api/v2/stream/${SESSION_ID}/subtitles/0.vtt?file_id=file-1`,
            mime_type: 'text/vtt',
            format: 'vtt',
            timing_origin_seconds: 0,
          },
        },
      }),
    });
    vi.useRealTimers();
    at(5360);
    expect(await screen.findByText('Last words')).toBeInTheDocument();
    at(5380);
    expect(endScreen()).not.toBeNull();
    expect(screen.queryByText('Last words')).toBeNull();
    // Back at the picture they are drawn again.
    fireEvent.click(screen.getByTestId('player-end-mini'));
    expect(await screen.findByText('Last words')).toBeInTheDocument();
  });

  it('keeps the player’s own layers away while the end screen shows: no buffering spinner', async () => {
    vi.useRealTimers();
    const { at, video } = await mount();
    vi.useRealTimers();
    at(5380);
    fireEvent.waiting(video);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByTestId('player-cue')).toBeNull();
    // Back at the picture the same wait shows it.
    fireEvent.click(await screen.findByTestId('player-end-mini'));
    expect(await screen.findByTestId('player-cue')).toBeInTheDocument();
  });

  it('has the next episode’s ThumbHash picture as the background, plain without one', async () => {
    const canvas = stubCanvas();
    vi.useRealTimers();
    const hashed = await mount({
      episodes: [
        episodeOf(1, 1),
        episodeOf(1, 2, { still_url: '/img/still-12.png', still_thumbhash: PORTRAIT_HASH }),
      ],
    });
    vi.useRealTimers();
    hashed.at(5380);
    const backdrop = await screen.findByTestId('player-end-backdrop');
    expect(canvas).toHaveBeenCalled();
    await waitFor(() =>
      expect(backdrop.getAttribute('style')).toContain('data:image/png;base64,14x32'),
    );
    cleanup();

    const plain = await mount();
    vi.useRealTimers();
    plain.at(5380);
    const bare = await screen.findByTestId('player-end-backdrop');
    expect(bare.getAttribute('style') ?? '').not.toContain('url(');
    vi.restoreAllMocks();
  });

  it('keeps the picture of an unwatched episode out of the background when spoilers are hidden', async () => {
    stubCanvas();
    vi.useRealTimers();
    const { at } = await mount({
      episodes: [
        episodeOf(1, 1),
        episodeOf(1, 2, { still_url: '/img/still-12.png', still_thumbhash: PORTRAIT_HASH }),
      ],
      values: { 'catalog.hide_unwatched_episode_images': true },
    });
    vi.useRealTimers();
    at(5380);
    const backdrop = await screen.findByTestId('player-end-backdrop');
    await waitFor(() => expect(screen.getByTestId('art-protected')).toBeInTheDocument());
    expect(backdrop.getAttribute('style') ?? '').not.toContain('url(');
    vi.restoreAllMocks();
  });
});

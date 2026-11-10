// The player's on-screen controls and keys, driven by key events on the real PlayerScreen. The
// session loads with real timers (MSW needs them); then the clock is faked, so every timing rule
// (5 s hide, 200 ms skip commit, 300 ms hold, scrub rates) runs exactly.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  servePlayback,
  until,
  watchDetail,
  type PlaybackServerOptions,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings, type SettingsServe } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { SPINNER_DELAY_MS, SPINNER_MIN_MS } from './timing';
import { clearInstallationCache } from '../usePlaybackSession';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let restoreMedia: () => void;
beforeEach(() => {
  window.localStorage.clear();
  clearInstallationCache();
  restoreMedia = installFakeMedia();
});
afterEach(async () => {
  vi.useRealTimers();
  restoreMedia();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const K = {
  ok: 13,
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  playPause: 179,
  play: 415,
  pause: 19,
  stop: 413,
  rewind: 412,
  fastForward: 417,
  back: 461,
};

function down(keyCode: number, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { keyCode, ...init });
}
function up(keyCode: number) {
  fireEvent.keyUp(window, { keyCode });
}
function tap(keyCode: number) {
  down(keyCode);
  up(keyCode);
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

async function mount(
  options: {
    firstFrame?: boolean;
    settings?: SettingsServe;
    playback?: PlaybackServerOptions;
  } = {},
) {
  const { firstFrame = true, settings = {} } = options;
  const calls = servePlayback(server, options.playback);
  serveSettings(server, settings);
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const onExit = vi.fn();
  const view = renderWithSilo(<PlayerScreen contentId="m1" title="First Title" onExit={onExit} />, {
    session,
  });
  await screen.findByTestId('player');
  const video = view.container.querySelector('video')!;
  const state = fakeVideo(video);
  state.duration = 5400;
  if (firstFrame) fireEvent.playing(video);
  if (options.settings) {
    // Wait for the profile's values: the overlay names the skip amounts.
    await screen.findByLabelText(
      `${String(settings.values?.['player.video_skip_back_seconds'] ?? 10)} seconds back`,
    );
  }
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  return { calls, onExit, video, state, view };
}

const osd = () => screen.getByTestId('player-osd');
const isOpen = () => osd().getAttribute('data-visible') === 'true';
const scrubber = () => screen.getByTestId('player-scrubber');
const focused = (name: string) =>
  document.querySelector(`[data-focus-key="${name}"]`)?.getAttribute('data-focused') === 'true';
const anyFocused = () => document.querySelector('[data-focused="true"]') !== null;
const shownTime = () => screen.getByTestId('player-time').textContent;

describe('overlay visibility', () => {
  it('is closed at first; the first key opens it with the focus on the scrubber', async () => {
    await mount();
    expect(isOpen()).toBe(false);
    expect(anyFocused()).toBe(false);
    tap(K.up);
    expect(isOpen()).toBe(true);
    expect(focused('scrubber')).toBe(true);
    expect(scrubber()).toHaveFocus();
  });

  it('hides 5 s after the last key and takes the focus away', async () => {
    await mount();
    tap(K.up);
    advance(4999);
    expect(isOpen()).toBe(true);
    // Activity restarts the countdown.
    tap(K.down);
    advance(4999);
    expect(isOpen()).toBe(true);
    advance(1);
    expect(isOpen()).toBe(false);
    expect(anyFocused()).toBe(false);
  });

  it('moves the focus off the overlay before it becomes aria-hidden, on every hide', async () => {
    await mount();
    // What had the focus at the moment each overlay part got aria-hidden.
    const seen: boolean[] = [];
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
      if (name === 'aria-hidden' && this.classList.contains('player-osd')) {
        seen.push(this.contains(document.activeElement));
      }
      return original.call(this, name, value);
    };
    try {
      tap(K.up);
      tap(K.down);
      expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus();
      advance(5000);
    } finally {
      Element.prototype.setAttribute = original;
    }
    expect(isOpen()).toBe(false);
    expect(seen).toEqual([false]);
    expect(osd().getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('player-osd-top').getAttribute('aria-hidden')).toBe('true');
    expect(osd().contains(document.activeElement)).toBe(false);
  });

  it('stays open while paused, and hides 5 s after playing again', async () => {
    const { state, video } = await mount();
    // The fake element starts paused: Play starts it, and the engine reports the first frame.
    tap(K.play);
    fireEvent.playing(video);
    tap(K.pause);
    expect(state.pause).toHaveBeenCalledTimes(1);
    advance(20_000);
    expect(isOpen()).toBe(true);
    tap(K.play);
    fireEvent.playing(video);
    advance(4999);
    expect(isOpen()).toBe(true);
    advance(1);
    expect(isOpen()).toBe(false);
  });

  it('stays open while buffering', async () => {
    const { video } = await mount();
    tap(K.up);
    fireEvent.waiting(video);
    advance(20_000);
    expect(isOpen()).toBe(true);
    fireEvent.playing(video);
    advance(5000);
    expect(isOpen()).toBe(false);
  });

  it('stays open while scrubbing, and hides 5 s after the scrub ends', async () => {
    await mount();
    tap(K.up);
    tap(K.fastForward);
    advance(20_000);
    expect(isOpen()).toBe(true);
    tap(K.back);
    advance(5000);
    expect(isOpen()).toBe(false);
  });

  it('opens on pointer movement with the focus on the scrubber', async () => {
    await mount();
    fireEvent.mouseMove(screen.getByTestId('player'));
    expect(isOpen()).toBe(true);
    expect(focused('scrubber')).toBe(true);
  });

  it('the first key while hidden only shows it: no skip, no toggle', async () => {
    const { state } = await mount();
    tap(K.right);
    advance(1000);
    expect(state.seeks).toEqual([]);
    expect(isOpen()).toBe(true);
    advance(5000);
    expect(isOpen()).toBe(false);
    tap(K.ok);
    expect(state.play).not.toHaveBeenCalled();
    expect(state.pause).not.toHaveBeenCalled();
    expect(isOpen()).toBe(true);
  });

  it('Play, Pause and PlayPause act at once while hidden, and open the overlay', async () => {
    const { state } = await mount();
    tap(K.play);
    expect(state.play).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(true);
    advance(5000);
    expect(isOpen()).toBe(false);
    tap(K.pause);
    expect(state.pause).toHaveBeenCalledTimes(1);
    tap(K.playPause);
    expect(state.play).toHaveBeenCalledTimes(2);
  });

  it('the Stop key leaves the player, stopping the session', async () => {
    const { onExit, calls } = await mount();
    // The stop request goes through the network mock, which needs the real clock.
    vi.useRealTimers();
    tap(K.stop);
    expect(onExit).toHaveBeenCalledTimes(1);
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.sessionId).toBe(SESSION_ID);
  });
});

describe('before the first frame', () => {
  it('ignores every key but Back', async () => {
    const { state, onExit } = await mount({ firstFrame: false });
    for (const code of [K.ok, K.up, K.down, K.right, K.play, K.playPause, K.fastForward]) tap(code);
    advance(1000);
    expect(isOpen()).toBe(false);
    expect(state.play).not.toHaveBeenCalled();
    expect(state.seeks).toEqual([]);
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.mouseMove(screen.getByTestId('player'));
    expect(isOpen()).toBe(false);
    tap(K.back);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('skipping', () => {
  it('skips by the profile values, not fixed ones', async () => {
    const { state } = await mount({
      settings: {
        values: { 'player.video_skip_back_seconds': 15, 'player.video_skip_forward_seconds': 45 },
      },
    });
    state.currentTime = 200;
    tap(K.up);
    tap(K.right);
    advance(200);
    expect(state.seeks).toEqual([245]);
    tap(K.left);
    advance(200);
    expect(state.seeks).toEqual([245, 230]);
  });

  it('adds rapid presses up and seeks once, 200 ms after the last one', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    tap(K.right);
    advance(100);
    tap(K.right);
    advance(100);
    tap(K.right);
    // The target is shown while it is pending.
    expect(shownTime()).toBe('3:10');
    advance(199);
    expect(state.seeks).toEqual([]);
    advance(1);
    expect(state.seeks).toEqual([190]);
    advance(2000);
    expect(state.seeks).toEqual([190]);
  });

  it('a Left press after Rights subtracts from the pending target', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    tap(K.right);
    tap(K.left);
    advance(200);
    expect(state.seeks).toEqual([120]);
  });

  it('OK on the scrubber toggles play and pause', async () => {
    const { state } = await mount();
    tap(K.up);
    tap(K.ok);
    expect(state.play).toHaveBeenCalledTimes(1);
    tap(K.ok);
    expect(state.pause).toHaveBeenCalledTimes(1);
  });
});

describe('scrub mode', () => {
  it('a held direction key (no keyup for 300 ms) enters it with NO skip, from the position before the press', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    down(K.right);
    advance(299);
    expect(screen.queryByTestId('player-scrub')).not.toBeInTheDocument();
    advance(1);
    const chip = screen.getByTestId('player-scrub');
    expect(chip).toHaveAttribute('data-rate', '2');
    expect(chip).toHaveTextContent('1:40');
    expect(state.seeks).toEqual([]);
    advance(1000);
    // Releasing the key ends nothing: the mode stays and still nothing is seeked.
    up(K.right);
    advance(1000);
    expect(screen.getByTestId('player-scrub')).toBeInTheDocument();
    expect(state.seeks).toEqual([]);
  });

  it('a repeated keydown (e.repeat) is a hold at once, without a skip', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    down(K.right);
    down(K.right, { repeat: true });
    expect(screen.getByTestId('player-scrub')).toHaveAttribute('data-rate', '2');
    advance(1000);
    expect(state.seeks).toEqual([]);
  });

  it('a tap (keyup within 300 ms) adds exactly one skip and commits 200 ms later', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    down(K.right);
    advance(100);
    // Nothing is pending before the keyup (the display shows the last reported position).
    expect(shownTime()).toBe('0:00');
    up(K.right);
    expect(shownTime()).toBe('2:10');
    advance(199);
    expect(state.seeks).toEqual([]);
    advance(1);
    expect(state.seeks).toEqual([130]);
    advance(1000);
    expect(screen.queryByTestId('player-scrub')).not.toBeInTheDocument();
    expect(state.seeks).toEqual([130]);
  });

  it('on a remote that never sends a keyup, a press skips at once and repeats make a hold', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    // The pointer opens the overlay, so no keyup has been seen yet.
    fireEvent.mouseMove(screen.getByTestId('player'));
    down(K.right);
    expect(shownTime()).toBe('2:10');
    advance(350);
    expect(state.seeks).toEqual([130]);
    down(K.right);
    const chip = screen.getByTestId('player-scrub');
    expect(chip).toHaveTextContent('2:10');
  });

  it('Rewind and Fast Forward enter it; presses step the rate 2, 4, 8, 16 and no further', async () => {
    await mount();
    tap(K.up);
    const rates = [];
    for (let i = 0; i < 5; i += 1) {
      tap(K.fastForward);
      rates.push(screen.getByTestId('player-scrub').getAttribute('data-rate'));
    }
    expect(rates).toEqual(['2', '4', '8', '16', '16']);
  });

  it('the opposite direction slows down, then reverses', async () => {
    await mount();
    tap(K.up);
    for (let i = 0; i < 4; i += 1) tap(K.fastForward);
    const rates = [];
    for (let i = 0; i < 5; i += 1) {
      tap(K.rewind);
      rates.push(screen.getByTestId('player-scrub').getAttribute('data-rate'));
    }
    expect(rates).toEqual(['8', '4', '2', '-2', '-4']);
  });

  it('Left and Right step the rate like Rewind and Fast Forward while scrubbing', async () => {
    await mount();
    tap(K.up);
    tap(K.fastForward);
    tap(K.right);
    expect(screen.getByTestId('player-scrub')).toHaveAttribute('data-rate', '4');
    tap(K.left);
    tap(K.left);
    expect(screen.getByTestId('player-scrub')).toHaveAttribute('data-rate', '-2');
    tap(K.left);
    expect(screen.getByTestId('player-scrub')).toHaveAttribute('data-rate', '-4');
  });

  it('moves the target at the rate and shows it; OK commits it with ONE seek', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    tap(K.fastForward);
    advance(5000);
    // 2x for 5 s.
    expect(screen.getByTestId('player-scrub')).toHaveTextContent('1:50');
    expect(shownTime()).toBe('1:50');
    tap(K.fastForward);
    advance(5000);
    // then 4x for 5 s.
    expect(screen.getByTestId('player-scrub')).toHaveTextContent('2:10');
    expect(state.seeks).toEqual([]);
    tap(K.ok);
    // The engine's own timeline adds a float origin; the count is what matters.
    expect(state.seeks).toHaveLength(1);
    expect(state.seeks[0]).toBeCloseTo(130, 6);
    expect(screen.queryByTestId('player-scrub')).not.toBeInTheDocument();
    advance(1000);
    expect(state.seeks).toHaveLength(1);
  });

  it('going back stops at the start', async () => {
    const { state } = await mount();
    state.currentTime = 4;
    tap(K.up);
    tap(K.rewind);
    advance(10_000);
    tap(K.ok);
    expect(state.seeks).toEqual([0]);
  });

  it('the Play key commits too, and starts a paused video', async () => {
    const { state } = await mount();
    state.currentTime = 10;
    tap(K.up);
    tap(K.fastForward);
    advance(5000);
    tap(K.play);
    expect(state.seeks).toHaveLength(1);
    expect(state.seeks[0]).toBeCloseTo(20, 6);
    expect(state.play).toHaveBeenCalledTimes(1);
  });

  it('Back cancels without a seek; the overlay stays', async () => {
    const { state, onExit } = await mount();
    state.currentTime = 100;
    tap(K.up);
    tap(K.fastForward);
    advance(5000);
    tap(K.back);
    expect(screen.queryByTestId('player-scrub')).not.toBeInTheDocument();
    expect(state.seeks).toEqual([]);
    expect(isOpen()).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
    // The playhead shows the real position again.
    expect(shownTime()).toBe('0:00');
  });

  it('Back goes in order: cancel scrubbing, hide the overlay, leave', async () => {
    const { onExit } = await mount();
    tap(K.up);
    tap(K.fastForward);
    tap(K.back);
    expect(isOpen()).toBe(true);
    expect(screen.queryByTestId('player-scrub')).not.toBeInTheDocument();
    tap(K.back);
    expect(isOpen()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    tap(K.back);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('buttons', () => {
  it('Down reaches the buttons on Play/Pause, Up returns to the scrubber', async () => {
    await mount();
    tap(K.up);
    tap(K.down);
    expect(focused('playPause')).toBe(true);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus();
    tap(K.up);
    expect(focused('scrubber')).toBe(true);
  });

  it('Down from the scrubber goes to Play/Pause, and Down on a button does nothing', async () => {
    await mount();
    tap(K.up);
    tap(K.down);
    expect(focused('playPause')).toBe(true);
    tap(K.down);
    expect(focused('playPause')).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Left and Right walk the whole row and stop at the ends', async () => {
    await mount();
    tap(K.up);
    tap(K.down);
    tap(K.left);
    expect(focused('skipBack')).toBe(true);
    tap(K.left);
    expect(focused('skipBack')).toBe(true);
    tap(K.right);
    tap(K.right);
    expect(focused('skipForward')).toBe(true);
    // A movie without chapters or a quality choice has only Info after the transport buttons.
    tap(K.right);
    expect(focused('info')).toBe(true);
    tap(K.right);
    expect(focused('info')).toBe(true);
  });

  it('every button has an accessible name', async () => {
    await mount();
    tap(K.up);
    for (const name of ['10 seconds back', 'Pause', '30 seconds forward', 'Info', 'Exit']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('Play/Pause shows what it will do, and OK on it toggles', async () => {
    const { state, video } = await mount();
    tap(K.up);
    tap(K.down);
    // The fake element starts paused, so the first OK plays.
    tap(K.ok);
    expect(state.play).toHaveBeenCalledTimes(1);
    fireEvent.playing(video);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    tap(K.ok);
    expect(state.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('OK on the skip buttons skips by the profile values, accumulating', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    tap(K.up);
    tap(K.down);
    tap(K.right);
    tap(K.ok);
    tap(K.ok);
    advance(200);
    expect(state.seeks).toEqual([160]);
    tap(K.left);
    tap(K.left);
    tap(K.ok);
    advance(200);
    expect(state.seeks).toEqual([160, 150]);
  });
});

describe('Exit', () => {
  it('stands in the top-left part of the overlay, with its label, apart from the bottom row', async () => {
    await mount();
    tap(K.up);
    const top = screen.getByTestId('player-osd-top');
    const exit = screen.getByRole('button', { name: 'Exit' });
    expect(top).toContainElement(exit);
    expect(exit).toHaveTextContent('Exit');
    expect(osd()).not.toContainElement(exit);
    // It shows and hides with the overlay.
    expect(top).toHaveAttribute('data-visible', 'true');
    advance(5000);
    expect(top).toHaveAttribute('data-visible', 'false');
  });

  it('is reached with Up from the scrubber; Down goes back to the scrubber', async () => {
    await mount();
    tap(K.up);
    tap(K.up);
    expect(focused('close')).toBe(true);
    expect(screen.getByRole('button', { name: 'Exit' })).toHaveFocus();
    tap(K.down);
    expect(focused('scrubber')).toBe(true);
  });

  it('does nothing on Left, Right and Up', async () => {
    const { state, onExit } = await mount();
    tap(K.up);
    tap(K.up);
    for (const code of [K.left, K.right, K.up]) {
      tap(code);
      expect(focused('close')).toBe(true);
    }
    advance(1000);
    expect(state.seeks).toEqual([]);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Enter on it leaves the player and stops the session', async () => {
    const { onExit, calls } = await mount();
    vi.useRealTimers();
    tap(K.up);
    tap(K.up);
    tap(K.ok);
    expect(onExit).toHaveBeenCalledTimes(1);
    await until(() => calls.stop.length === 1);
  });
});

describe('the title block', () => {
  const EPISODE = watchDetail({
    type: 'episode',
    title: 'Pilot',
    series_title: 'Some Show',
    season_number: 1,
    episode_number: 1,
    year: 2020,
  });

  it('shows the series, then only "S1 · E1 — TITLE" on the second line: no time', async () => {
    await mount({ playback: { watch: EPISODE } });
    tap(K.up);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Some Show');
    expect(screen.getByTestId('player-meta').textContent).toBe('S1 · E1 — PILOT');
  });

  it('keeps a long episode title on its line and the time out of the block', async () => {
    const long = 'A very long episode title that could never fit on the line next to the time';
    await mount({ playback: { watch: { ...EPISODE, title: long } } });
    tap(K.up);
    expect(screen.getByTestId('player-detail')).toHaveTextContent(
      `S1 · E1 — ${long.toUpperCase()}`,
    );
    expect(screen.getByTestId('player-meta')).not.toContainElement(
      screen.getByTestId('player-clock'),
    );
    expect(screen.getByTestId('player-meta').textContent).not.toMatch(/\d:\d\d/);
  });

  it('shows only the year for a movie', async () => {
    await mount({ playback: { watch: watchDetail({ year: 1999 }) } });
    tap(K.up);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('First Title');
    expect(screen.getByTestId('player-meta').textContent).toBe('1999');
  });

  it('has nothing on the second line for a movie without a year', async () => {
    await mount();
    tap(K.up);
    expect(screen.getByTestId('player-meta').textContent).toBe('');
  });
});

describe('the clock above the scrubber', () => {
  const MINUS = '\u2212';
  const EPISODE = watchDetail({ type: 'episode', title: 'Pilot', series_title: 'Some Show' });
  const clock = () => screen.getByTestId('player-clock');

  /** 14:00:00 local; the file is 1:30:00 long, so from the start it ends at 15:30. */
  const at1400 = () => vi.setSystemTime(new Date(2026, 10, 10, 14, 0, 0));

  it('sits right above the scrubber, in the same block, and not in the title block', async () => {
    await mount();
    tap(K.up);
    expect(clock().nextElementSibling).toBe(screen.getByTestId('player-scrubber'));
    expect(clock().parentElement).toHaveClass('player-osd-scrubwrap');
    expect(screen.getByTestId('player-meta')).not.toContainElement(clock());
  });

  it('is Combined by default: position, length and the end time (12 h in English)', async () => {
    await mount();
    at1400();
    tap(K.up);
    expect(clock().textContent).toBe('0:00 / 1:30:00 · Ends at 3:30 PM');
    expect(clock()).toHaveAttribute('data-mode', 'combined');
  });

  it('shows Position / length alone', async () => {
    window.localStorage.setItem('silo-tv.settings.timeDisplay', 'position');
    await mount();
    tap(K.up);
    expect(clock().textContent).toBe('0:00 / 1:30:00');
  });

  it('shows the time left with a true minus sign', async () => {
    window.localStorage.setItem('silo-tv.settings.timeDisplay', 'remaining');
    const { state, video } = await mount();
    state.currentTime = 4080;
    fireEvent.timeUpdate(video);
    tap(K.up);
    // 4080 s played of 5400: 22:00 left.
    expect(clock().textContent).toBe(`${MINUS}22:00`);
  });

  it('shows the end time alone', async () => {
    window.localStorage.setItem('silo-tv.settings.timeDisplay', 'endsAt');
    await mount();
    at1400();
    tap(K.up);
    expect(clock().textContent).toBe('Ends at 3:30 PM');
  });

  it('writes the end time in 24 h when the profile says 24h, and in 12 h for 12h', async () => {
    await mount({ settings: { values: { 'ui.time_format': '24h' } } });
    at1400();
    tap(K.up);
    expect(clock().textContent).toBe('0:00 / 1:30:00 · Ends at 15:30');
  });

  it('writes 12 h when the profile says 12h', async () => {
    await mount({ settings: { values: { 'ui.time_format': '12h' } } });
    at1400();
    tap(K.up);
    expect(screen.getByTestId('player-ends')).toHaveTextContent('Ends at 3:30 PM');
  });

  it('shows the pending skip target as the position, and the end time follows it', async () => {
    const { state } = await mount({ playback: { watch: EPISODE } });
    at1400();
    state.currentTime = 100;
    tap(K.up);
    tap(K.right);
    // 100 s + the 30 s skip is 2:10; 5270 s are left: 14:00 + 1:27:50 is 3:27 PM.
    expect(clock().textContent).toBe('2:10 / 1:30:00 · Ends at 3:27 PM');
  });

  it('reads the mode when the player opens, not later', async () => {
    window.localStorage.setItem('silo-tv.settings.timeDisplay', 'remaining');
    await mount();
    window.localStorage.setItem('silo-tv.settings.timeDisplay', 'position');
    tap(K.up);
    expect(clock()).toHaveAttribute('data-mode', 'remaining');
  });
});

describe('the blue key and a pending hold', () => {
  it('cancels a Right held on the scrubber: Info stays, focus on its button, no scrub starts', async () => {
    await mount();
    // A keyup has been seen, so the remote delivers them and a hold waits for HOLD_MS.
    tap(K.up);
    down(K.right);
    down(406);
    expect(screen.getByTestId('player-info')).toBeInTheDocument();
    advance(1000);
    expect(screen.queryByTestId('player-scrub')).not.toBeInTheDocument();
    expect(screen.getByTestId('player-info')).toBeInTheDocument();
    expect(focused('info')).toBe(true);
  });
});

describe('keys the player owns', () => {
  it('are prevented while the overlay is open: an arrow and a media key', async () => {
    await mount();
    tap(K.up);
    const arrow = new KeyboardEvent('keydown', { keyCode: K.right, cancelable: true });
    expect(window.dispatchEvent(arrow)).toBe(false);
    const forward = new KeyboardEvent('keydown', { keyCode: K.fastForward, cancelable: true });
    expect(window.dispatchEvent(forward)).toBe(false);
  });

  it('do not reach another keydown listener on the window', async () => {
    await mount();
    const other = vi.fn();
    window.addEventListener('keydown', other);
    try {
      tap(K.up);
      tap(K.ok);
      tap(K.right);
      expect(other).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', other);
    }
  });
});

describe('with the overlay hidden', () => {
  it('Down only shows the overlay on the scrubber: it opens no menu', async () => {
    await mount();
    tap(K.down);
    expect(isOpen()).toBe(true);
    expect(focused('scrubber')).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('player-info')).not.toBeInTheDocument();
  });
});

describe('Magic Remote pointer', () => {
  it('a click on the scrubber seeks to the clicked fraction, once', async () => {
    const { state } = await mount();
    tap(K.up);
    const track = document.querySelector('.player-scrubber-track')!;
    track.getBoundingClientRect = () =>
      ({ left: 100, width: 1000, top: 0, right: 1100, bottom: 6, height: 6 }) as DOMRect;
    fireEvent.click(scrubber(), { clientX: 350 });
    // A quarter of 5400 s.
    expect(state.seeks).toEqual([1350]);
    advance(1000);
    expect(state.seeks).toEqual([1350]);
  });

  it('hovering a button moves the focus to it', async () => {
    await mount();
    tap(K.up);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Exit' }));
    expect(focused('close')).toBe(true);
    fireEvent.mouseEnter(scrubber());
    expect(focused('scrubber')).toBe(true);
  });

  it('the buttons are clickable', async () => {
    const { state, onExit } = await mount();
    state.currentTime = 100;
    tap(K.up);
    fireEvent.click(screen.getByRole('button', { name: '30 seconds forward' }));
    fireEvent.click(screen.getByRole('button', { name: '30 seconds forward' }));
    advance(200);
    expect(state.seeks).toEqual([160]);
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('pointer movement keeps the overlay open', async () => {
    await mount();
    tap(K.up);
    advance(4000);
    fireEvent.mouseMove(screen.getByTestId('player'));
    advance(4000);
    expect(isOpen()).toBe(true);
    advance(1000);
    expect(isOpen()).toBe(false);
  });
});

describe('the first key while hidden acts on nothing', () => {
  it('Rewind and Fast Forward only open the overlay: no scrub mode', async () => {
    const { state } = await mount();
    tap(K.fastForward);
    expect(isOpen()).toBe(true);
    expect(screen.queryByTestId('player-scrub')).not.toBeInTheDocument();
    advance(5000);
    expect(isOpen()).toBe(false);
    tap(K.rewind);
    expect(isOpen()).toBe(true);
    expect(screen.queryByTestId('player-scrub')).not.toBeInTheDocument();
    advance(2000);
    expect(state.seeks).toEqual([]);
  });

  it('Right, Up and Left only open it: the focus stays on the scrubber and nothing seeks', async () => {
    const { state } = await mount();
    for (const code of [K.right, K.up, K.left]) {
      tap(code);
      expect(isOpen()).toBe(true);
      expect(focused('scrubber')).toBe(true);
      expect(focused('playPause')).toBe(false);
      advance(5000);
      expect(isOpen()).toBe(false);
    }
    expect(state.seeks).toEqual([]);
  });
});

describe('the buffering spinner at the player', () => {
  it('waits SPINNER_DELAY_MS before it shows', async () => {
    const { video } = await mount();
    fireEvent.waiting(video);
    advance(SPINNER_DELAY_MS - 1);
    expect(screen.queryByTestId('player-cue')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByTestId('player-cue')).toBeInTheDocument();
  });

  it('stays SPINNER_MIN_MS once shown, even when the frame comes at once', async () => {
    const { video } = await mount();
    fireEvent.waiting(video);
    advance(SPINNER_DELAY_MS);
    expect(screen.getByTestId('player-cue')).toBeInTheDocument();
    fireEvent.playing(video);
    advance(SPINNER_MIN_MS - 1);
    expect(screen.getByTestId('player-cue')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByTestId('player-cue')).not.toBeInTheDocument();
  });
});

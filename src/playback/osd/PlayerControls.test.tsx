// The player's on-screen controls and keys, driven by key events on the real PlayerScreen. The
// session loads with real timers (MSW needs them); then the clock is faked, so every timing rule
// (5 s hide, 200 ms skip commit, 300 ms hold, scrub rates) runs exactly.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import { ACCESS_TOKEN, SESSION_ID, servePlayback, until } from '../../test/playbackFixtures';
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

async function mount(options: { firstFrame?: boolean; settings?: SettingsServe } = {}) {
  const { firstFrame = true, settings = {} } = options;
  const calls = servePlayback(server);
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

  it('Left and Right walk the buttons and stop at the ends', async () => {
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
    tap(K.right);
    expect(focused('options')).toBe(true);
    tap(K.right);
    expect(focused('close')).toBe(true);
    tap(K.right);
    expect(focused('close')).toBe(true);
  });

  it('every button has an accessible name', async () => {
    await mount();
    tap(K.up);
    for (const name of ['10 seconds back', 'Pause', '30 seconds forward', 'Options', 'Close']) {
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

  it('Close leaves the player and stops the session', async () => {
    const { onExit, calls } = await mount();
    vi.useRealTimers();
    tap(K.up);
    tap(K.down);
    tap(K.right);
    tap(K.right);
    tap(K.right);
    expect(focused('close')).toBe(true);
    tap(K.ok);
    expect(onExit).toHaveBeenCalledTimes(1);
    await until(() => calls.stop.length === 1);
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
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Close' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
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

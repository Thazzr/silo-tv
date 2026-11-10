/// <reference types="node" />
import { readFileSync } from 'node:fs';
// The skip pill on the real PlayerScreen: segments from the watch detail, the profile's skip
// settings, keys. The session loads with real timers (MSW needs them); then the clock is faked so
// the 5 s rules run exactly.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import type { components } from '../../api/generated/schema';
import { account } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import {
  ACCESS_TOKEN,
  playbackCapabilities,
  servePlayback,
  watchDetail,
  watchVersion,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { clearInstallationCache } from '../session/startSession';

type S = components['schemas'];

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

const K = { ok: 13, left: 37, up: 38, right: 39, down: 40, back: 461 };
const tap = (keyCode: number) => {
  fireEvent.keyDown(window, { keyCode });
  fireEvent.keyUp(window, { keyCode });
};
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

const INTRO = { kind: 'intro', start_seconds: 10, end_seconds: 60 } as const;
const RECAP = { kind: 'recap', start_seconds: 100, end_seconds: 130 } as const;
const CREDITS = { kind: 'credits', start_seconds: 5300, end_seconds: 5400 } as const;
const PREVIEW = { kind: 'preview', start_seconds: 200, end_seconds: 230 } as const;

interface Options {
  list?: S['MarkerOccurrence'][];
  singular?: Partial<Pick<S['WatchFileVersion'], 'intro' | 'recap' | 'credits' | 'preview'>>;
  /** The server lists marker_segments_v1. */
  capability?: boolean;
  values?: Record<string, unknown>;
  /** The settings reads wait for this; the test then runs on real timers. */
  gate?: Promise<void>;
}

function renderPlayer(options: Options = {}) {
  const { list = [], singular = {}, capability = true, values = {} } = options;
  const calls = servePlayback(server, {
    capabilities: playbackCapabilities({
      features: [
        'playback_plan_v3',
        'sequenced_progress_v1',
        ...(capability ? ['marker_segments_v1'] : []),
      ],
    }),
    watch: watchDetail({ versions: [watchVersion({ marker_segments: list, ...singular })] }),
  });
  // 11 s is no default: seeing the label means the profile's values have arrived.
  serveSettings(server, {
    gate: options.gate,
    values: { 'player.video_skip_back_seconds': 15, ...values },
  });
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
  return { calls, view, onExit };
}

async function mount(options: Options = {}) {
  const { view, onExit } = renderPlayer(options);
  await screen.findByTestId('player');
  const video = view.container.querySelector('video')!;
  const state = fakeVideo(video);
  state.duration = 5400;
  fireEvent.playing(video);
  await screen.findByLabelText('15 seconds back');
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  /** The video is at `seconds`. */
  const at = (seconds: number) => {
    state.currentTime = seconds;
    fireEvent.timeUpdate(video);
  };
  return { video, state, onExit, at };
}

const pill = () => screen.queryByTestId('player-skip');
const pillFocused = () => pill()?.getAttribute('data-focused') === 'true';
const isOpen = () => screen.getByTestId('player-osd').getAttribute('data-visible') === 'true';

describe('the skip pill in ask mode', () => {
  it('shows on entering a segment, holds the focus, and OK skips with one seek to its end', async () => {
    const { state, at } = await mount({ list: [INTRO] });
    at(9);
    expect(pill()).toBeNull();
    at(10);
    expect(pill()).toHaveTextContent('Skip intro');
    expect(pillFocused()).toBe(true);
    expect(pill()).toHaveFocus();
    expect(screen.getByTestId('player-skip-fill')).toBeInTheDocument();
    tap(K.ok);
    expect(state.seeks).toEqual([60]);
    expect(pill()).toBeNull();
    expect(isOpen()).toBe(false);
  });

  it('leaves the pill visible but gives the focus back to the video after 5 s; OK opens the overlay', async () => {
    const { state, at } = await mount({ list: [INTRO] });
    at(10);
    advance(4999);
    expect(pillFocused()).toBe(true);
    advance(1);
    expect(pill()).toBeInTheDocument();
    expect(pillFocused()).toBe(false);
    expect(screen.queryByTestId('player-skip-fill')).toBeNull();
    tap(K.ok);
    expect(isOpen()).toBe(true);
    expect(state.seeks).toEqual([]);
    expect(pill()).toBeInTheDocument();
  });

  it('is reached with Right from the last button, activates with OK, and Left goes back', async () => {
    const { state, at } = await mount({ list: [INTRO] });
    at(10);
    advance(5000);
    tap(K.up); // opens the overlay on the scrubber
    tap(K.down); // play/pause
    tap(K.right); // forward
    tap(K.right); // info, the last button
    expect(document.querySelector('[data-focus-key="info"]')).toHaveAttribute(
      'data-focused',
      'true',
    );
    tap(K.right);
    expect(pillFocused()).toBe(true);
    expect(pill()).toHaveFocus();
    tap(K.left);
    expect(pillFocused()).toBe(false);
    expect(document.querySelector('[data-focus-key="info"]')).toHaveAttribute(
      'data-focused',
      'true',
    );
    tap(K.right);
    tap(K.ok);
    expect(state.seeks).toEqual([60]);
    // The pill is gone, so the focus is back on the scrubber.
    expect(pill()).toBeNull();
    expect(document.querySelector('[data-focus-key="scrubber"]')).toHaveAttribute(
      'data-focused',
      'true',
    );
  });

  it('is not reached with Right while there is no pill', async () => {
    await mount({ list: [INTRO] });
    tap(K.up);
    tap(K.down);
    tap(K.right);
    tap(K.right);
    tap(K.right);
    tap(K.right);
    expect(document.querySelector('[data-focus-key="info"]')).toHaveAttribute(
      'data-focused',
      'true',
    );
  });

  it('Back dismisses the pill first, then hides the overlay, then leaves', async () => {
    const { at, onExit } = await mount({ list: [INTRO] });
    at(10);
    tap(K.up);
    expect(isOpen()).toBe(true);
    expect(pill()).toBeInTheDocument();
    tap(K.back);
    expect(pill()).toBeNull();
    expect(isOpen()).toBe(true);
    tap(K.back);
    expect(isOpen()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    tap(K.back);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Back on a pill with the overlay closed only dismisses it, and it stays dismissed for that segment', async () => {
    const { at, onExit } = await mount({ list: [INTRO] });
    at(10);
    tap(K.back);
    expect(pill()).toBeNull();
    expect(isOpen()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    at(20);
    expect(pill()).toBeNull();
    // Another segment still offers its pill.
    tap(K.back);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('offers the recap, the preview and the credits with their own texts', async () => {
    const { at } = await mount({ list: [RECAP, PREVIEW, CREDITS] });
    at(110);
    expect(pill()).toHaveTextContent('Skip recap');
    at(210);
    expect(pill()).toHaveTextContent('Skip preview');
    at(5310);
    expect(pill()).toHaveTextContent('Skip credits');
  });

  it('finds the second of two intros', async () => {
    const { state, at } = await mount({
      list: [INTRO, { kind: 'intro', start_seconds: 1500, end_seconds: 1550 }],
    });
    at(1510);
    expect(pill()).toHaveTextContent('Skip intro');
    tap(K.ok);
    expect(state.seeks).toEqual([1550]);
  });

  it('offers nothing when the file has no segments', async () => {
    const { at } = await mount();
    at(30);
    expect(pill()).toBeNull();
    expect(screen.queryAllByTestId('player-scrubber-band')).toHaveLength(0);
  });
});

describe('intro mode', () => {
  it('never: no pill and no skip', async () => {
    const { state, at } = await mount({
      list: [INTRO],
      values: { 'playback.intro_skip_mode': 'never' },
    });
    at(20);
    expect(pill()).toBeNull();
    expect(state.seeks).toEqual([]);
  });

  it('always: skips once on entering, offers "Watch intro" for 5 s, OK goes back without skipping again', async () => {
    const { state, at } = await mount({
      list: [INTRO],
      values: { 'playback.intro_skip_mode': 'always' },
    });
    at(10);
    expect(state.seeks).toEqual([60]);
    expect(pill()).toHaveTextContent('Watch intro');
    expect(pillFocused()).toBe(true);
    tap(K.ok);
    expect(state.seeks).toEqual([60, 10]);
    expect(pill()).toBeNull();
    // The video is back in the intro: no second automatic skip.
    at(10);
    at(11);
    expect(state.seeks).toEqual([60, 10]);
    expect(pill()).toBeNull();
  });

  it('always: "Watch intro" goes after 5 s', async () => {
    const { at } = await mount({
      list: [INTRO],
      values: { 'playback.intro_skip_mode': 'always' },
    });
    at(10);
    advance(4999);
    expect(pill()).toHaveTextContent('Watch intro');
    advance(1);
    expect(pill()).toBeNull();
  });

  it('always: seeking back into a skipped intro does not skip again', async () => {
    const { state, at } = await mount({
      list: [INTRO],
      values: { 'playback.intro_skip_mode': 'always' },
    });
    at(10);
    at(60);
    advance(5000);
    at(30);
    expect(state.seeks).toEqual([60]);
  });
});

describe('while the profile settings are unknown', () => {
  it('starts nothing, then skips once when the settings say always', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { calls, view } = renderPlayer({
      list: [INTRO],
      values: { 'playback.intro_skip_mode': 'always' },
      gate,
    });
    // The start waits for the profile's values (its quality preference), so no frame can play
    // before the skip modes are known.
    await screen.findByTestId('player-loading');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.start).toHaveLength(0);
    open();
    await screen.findByTestId('player');
    const video = view.container.querySelector('video')!;
    const state = fakeVideo(video);
    state.duration = 5400;
    fireEvent.playing(video);
    state.currentTime = 20;
    fireEvent.timeUpdate(video);
    expect(await screen.findByText('Watch intro')).toBeInTheDocument();
    expect(state.seeks).toEqual([60]);
    expect(screen.queryByText('Skip intro')).toBeNull();
  });
});

describe('recap and credits', () => {
  it('skip by themselves once when their settings say so', async () => {
    const { state, at } = await mount({
      list: [RECAP, { kind: 'credits', start_seconds: 3000, end_seconds: 3100 }],
      values: { 'playback.auto_skip_recap': true, 'playback.auto_skip_credits': true },
    });
    at(100);
    expect(state.seeks).toEqual([130]);
    expect(pill()).toBeNull();
    // Back into the recap: not again.
    at(110);
    expect(state.seeks).toEqual([130]);
    at(3000);
    expect(state.seeks).toEqual([130, 3100]);
  });

  it('show a pill when their settings say so', async () => {
    const { state, at } = await mount({ list: [RECAP, CREDITS] });
    at(100);
    expect(pill()).toHaveTextContent('Skip recap');
    at(5300);
    expect(pill()).toHaveTextContent('Skip credits');
    expect(state.seeks).toEqual([]);
  });

  it('credits to the end skip to the end of the stream, which ends it', async () => {
    const { state, at, video, onExit } = await mount({
      list: [CREDITS],
      values: { 'playback.auto_skip_credits': true },
    });
    at(5300);
    expect(state.seeks).toEqual([5400]);
    state.ended = true;
    fireEvent.ended(video);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('a pill for credits that run to the end also seeks to the end', async () => {
    const { state, at } = await mount({
      list: [{ kind: 'credits', start_seconds: 5300, end_seconds: 5398.5 }],
    });
    at(5300);
    tap(K.ok);
    expect(state.seeks).toEqual([5400]);
  });

  it('never skip a preview by themselves', async () => {
    const { state, at } = await mount({
      list: [PREVIEW],
      values: {
        'playback.intro_skip_mode': 'always',
        'playback.auto_skip_recap': true,
        'playback.auto_skip_credits': true,
      },
    });
    at(210);
    expect(state.seeks).toEqual([]);
    expect(pill()).toHaveTextContent('Skip preview');
  });
});

describe('where the segments come from', () => {
  it('uses the list when the server has marker_segments_v1', async () => {
    const { at } = await mount({
      list: [INTRO],
      singular: { recap: { start_seconds: 100, end_seconds: 130 } },
    });
    at(110);
    expect(pill()).toBeNull();
    at(20);
    expect(pill()).toBeInTheDocument();
  });

  it('uses the singular fields on a server without it', async () => {
    const { at } = await mount({
      capability: false,
      list: [INTRO],
      singular: { recap: { start_seconds: 100, end_seconds: 130 } },
    });
    at(20);
    expect(pill()).toBeNull();
    at(110);
    expect(pill()).toHaveTextContent('Skip recap');
  });

  it('has no segments with the capability but only singular fields', async () => {
    const { at } = await mount({
      singular: { intro: { start_seconds: 10, end_seconds: 60 } },
    });
    at(20);
    expect(pill()).toBeNull();
  });
});

describe('scrubber bands', () => {
  it('draw every kind, previews included, at their fractions of the track', async () => {
    await mount({
      list: [
        { kind: 'intro', start_seconds: 540, end_seconds: 1080 },
        { kind: 'recap', start_seconds: 0, end_seconds: 270 },
        { kind: 'preview', start_seconds: 2000, end_seconds: 2100 },
        { kind: 'credits', start_seconds: 4860, end_seconds: 5400 },
      ],
    });
    const bands = screen.getAllByTestId('player-scrubber-band');
    // One band per kind, previews included, each carrying its kind for its colour.
    expect(bands.map((b) => b.getAttribute('data-kind'))).toEqual([
      'recap',
      'intro',
      'preview',
      'credits',
    ]);
    expect(bands.map((b) => [b.style.left, b.style.width]).filter((_, i) => i !== 2)).toEqual([
      ['0%', '5%'],
      ['10%', '10%'],
      ['90%', '10%'],
    ]);
    expect(Number.parseFloat(bands[2]!.style.left)).toBeCloseTo((2000 / 5400) * 100, 2);
  });
});

describe('skip pill styles', () => {
  const css = readFileSync('src/styles.css', 'utf-8');

  it('is at least 75 px high with 20 px text, and white with dark text when focused', () => {
    const base = /\.player-skip \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(Number(/height: (\d+)px/.exec(base)?.[1])).toBeGreaterThanOrEqual(75);
    expect(Number(/font-size: (\d+)px/.exec(base)?.[1])).toBeGreaterThanOrEqual(20);
    const focused = /\.player-skip\[data-focused='true'\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(focused).toContain('background: var(--focus-fill)');
    expect(focused).toContain('color: var(--focus-content)');
  });

  it('animates the fill with a transform only', () => {
    expect(/@keyframes player-skip-fill \{([^}]*\{[^}]*\})/.exec(css)?.[1]).toContain('transform');
  });
});

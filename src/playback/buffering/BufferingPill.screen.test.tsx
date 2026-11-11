/// <reference types="node" />
// The buffering prompt and the undo pill on the real PlayerScreen: what shows after repeated
// stalls in each mode, the keys and the focus, the corner slot it shares with the skip pill, the
// 15 s countdown and the notices. The session loads on real timers (MSW needs them); then the
// clock is faked so the 10 s grace, the 15 s countdown and the 120 s waits run exactly.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { Session } from '../../api/session';
import { account } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackCapabilities,
  playbackPlan,
  servePlayback,
  watchDetail,
  watchVersion,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { PROMPT_MS, REOFFER_MIN_MS, STARTUP_GRACE_MS } from '../session/bufferingQuality';
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

const RUNGS: S['AvailableQualityV3'][] = [
  { label: '1080p', preserves_source: false, bitrate_kbps: 8000 },
  { label: '720p', preserves_source: false, bitrate_kbps: 4000 },
];

function planOn(n: number, kbps?: number) {
  return playbackPlan({
    plan_id: `plan:${n}`,
    plan_attempt_key: `v3:key-${n}`,
    stream: {
      container: 'mp4',
      header_refresh: 'none',
      headers: {},
      protocol: 'http',
      url: `/api/v2/stream/${SESSION_ID}?st=signed-${n}`,
    },
    effective_recipe: {
      video_codec: 'h264',
      audio_codec: 'aac',
      ...(kbps !== undefined ? { bitrate_kbps: kbps } : {}),
    },
    available_qualities: RUNGS,
  });
}

const INTRO = { kind: 'intro', start_seconds: 10, end_seconds: 60 } as const;

interface Options {
  mode?: 'never' | 'ask' | 'always';
  kbps?: number;
  /** The server's manifest revision; the mode key exists from 23. */
  revision?: number;
  quality?: string;
  segments?: S['MarkerOccurrence'][];
}

async function mount(options: Options = {}) {
  const calls = servePlayback(server, {
    capabilities: playbackCapabilities({
      features: ['playback_plan_v3', 'sequenced_progress_v1', 'marker_segments_v1'],
    }),
    watch: watchDetail({
      versions: [watchVersion({ marker_segments: options.segments ?? [] })],
    }),
    start: [playableDecision(planOn(1, 'kbps' in options ? options.kbps : 10_000))],
    replan: [playableDecision(planOn(2, 5000))],
  });
  serveSettings(server, {
    manifestRevision: options.revision,
    values: {
      'playback.buffering_quality_mode': options.mode ?? 'ask',
      'playback.preferred_quality': options.quality ?? 'auto',
      'player.video_skip_back_seconds': 15,
    },
  });
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const view = renderWithSilo(
    <PlayerScreen contentId="m1" title="First Title" onExit={vi.fn()} />,
    {
      session,
    },
  );
  await screen.findByTestId('player');
  const video = view.container.querySelector('video')!;
  const state = fakeVideo(video);
  state.duration = 5400;
  fireEvent.loadedMetadata(video);
  fireEvent.playing(video);
  await screen.findByLabelText('15 seconds back');
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  advance(STARTUP_GRACE_MS + 1);
  const at = (seconds: number) => {
    state.currentTime = seconds;
    fireEvent.timeUpdate(video);
  };
  /** A wait of `ms`, then a frame. */
  const stall = (ms: number) => {
    state.paused = false;
    // Media data arrived just before: the link is not silent.
    fireEvent(video, new Event('progress'));
    fireEvent(video, new Event('waiting'));
    advance(ms);
    fireEvent.playing(video);
  };
  const twoStalls = () => {
    stall(1500);
    advance(1000);
    stall(1500);
  };
  return { calls, video, state, at, stall, twoStalls };
}

const prompt = () => screen.queryByTestId('player-buffering');
const lowerButton = () => screen.getByTestId('player-buffering-lower');
const keepButton = () => screen.getByTestId('player-buffering-keep');
const skipPill = () => screen.queryByTestId('player-skip');

describe('the prompt (ask mode)', () => {
  it('shows after two stalls with Lower quality focused and a countdown line, and takes no replan yet', async () => {
    const { calls, twoStalls } = await mount();
    expect(prompt()).toBeNull();
    twoStalls();
    expect(prompt()).toHaveTextContent('Playback keeps buffering');
    expect(lowerButton()).toHaveTextContent('Lower quality');
    expect(keepButton()).toHaveTextContent('Keep quality');
    expect(lowerButton()).toHaveFocus();
    expect(lowerButton()).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('player-buffering-line')).toHaveAttribute('data-running', 'true');
    expect(calls.replan).toHaveLength(0);
  });

  it('moves between the buttons with Left and Right, and OK on Keep closes it for good', async () => {
    const { calls, twoStalls, stall } = await mount();
    twoStalls();
    tap(K.right);
    expect(keepButton()).toHaveFocus();
    expect(keepButton()).toHaveAttribute('data-focused', 'true');
    expect(lowerButton()).toHaveAttribute('data-focused', 'false');
    tap(K.left);
    expect(lowerButton()).toHaveFocus();
    tap(K.right);
    tap(K.ok);
    expect(prompt()).toBeNull();
    expect(calls.replan).toHaveLength(0);
    // The title is answered: more stalls do not ask again.
    advance(STARTUP_GRACE_MS);
    stall(1500);
    advance(1000);
    stall(1500);
    expect(prompt()).toBeNull();
  });

  it('does not open the overlay on Left and Right, but any other key does', async () => {
    const { twoStalls } = await mount();
    twoStalls();
    tap(K.right);
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'false');
    tap(K.up);
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'true');
    expect(prompt()).toBeInTheDocument();
  });

  it('Back keeps the quality', async () => {
    const { calls, twoStalls } = await mount();
    twoStalls();
    tap(K.back);
    expect(prompt()).toBeNull();
    expect(calls.replan).toHaveLength(0);
  });

  it('Lower sends the lowering replan and then shows the undo pill', async () => {
    const { calls, twoStalls } = await mount();
    twoStalls();
    tap(K.ok);
    vi.useRealTimers();
    await waitFor(() => expect(calls.replan).toHaveLength(1));
    expect(calls.replan[0]!.body).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
      bandwidth_estimate_kbps: 7000,
      bandwidth_estimate_source: 'observed_rebuffer',
    });
    const restore = await screen.findByTestId('player-buffering-restore');
    expect(restore).toHaveTextContent('Restore quality');
    expect(screen.getByTestId('player-buffering')).toHaveTextContent(
      'Quality lowered to stop buffering',
    );
  });

  it('disappears after 15 s without an answer, and comes back no sooner than 120 s after it showed', async () => {
    const { calls, twoStalls } = await mount();
    twoStalls();
    advance(PROMPT_MS - 1);
    expect(prompt()).toBeInTheDocument();
    advance(1);
    expect(prompt()).toBeNull();
    // Inside the wait nothing comes, even with fresh stalls.
    twoStalls();
    expect(prompt()).toBeNull();
    advance(REOFFER_MIN_MS);
    twoStalls();
    expect(prompt()).toBeInTheDocument();
    expect(calls.replan).toHaveLength(0);
  });

  it('freezes the countdown while paused and resumes it where it was', async () => {
    const { twoStalls, video, state } = await mount();
    twoStalls();
    advance(10_000);
    state.paused = false;
    fireEvent.pause(video);
    expect(screen.getByTestId('player-buffering-line')).toHaveAttribute('data-running', 'false');
    advance(60_000);
    expect(prompt()).toBeInTheDocument();
    fireEvent.playing(video);
    expect(screen.getByTestId('player-buffering-line')).toHaveAttribute('data-running', 'true');
    advance(4_999);
    expect(prompt()).toBeInTheDocument();
    advance(1);
    expect(prompt()).toBeNull();
  });

  it('animates the countdown line with transform only', async () => {
    const { twoStalls } = await mount();
    twoStalls();
    const css = readFileSync('src/styles.css', 'utf8');
    const rule = /@keyframes player-buffering-line\s*{([^}]*}[^}]*)}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/transform:\s*scaleX\(0\)/);
    expect(rule).not.toMatch(/width|left|right|opacity/);
  });
});

describe('the corner slot', () => {
  it('waits for the skip pill, and its 15 s start when it shows', async () => {
    const { twoStalls, at } = await mount({ segments: [INTRO] });
    at(10);
    expect(skipPill()).toBeInTheDocument();
    twoStalls();
    // The skip pill wins the corner.
    expect(skipPill()).toBeInTheDocument();
    expect(prompt()).toBeNull();
    advance(PROMPT_MS * 3);
    // Still waiting, not expired: leaving the segment frees the slot, and the pill has all 15 s.
    at(70);
    expect(skipPill()).toBeNull();
    expect(prompt()).toBeInTheDocument();
    advance(PROMPT_MS - 1);
    expect(prompt()).toBeInTheDocument();
    advance(1);
    expect(prompt()).toBeNull();
  });

  it('hides when the skip pill arrives and comes back when it is gone', async () => {
    const { twoStalls, at } = await mount({ segments: [INTRO] });
    twoStalls();
    expect(prompt()).toBeInTheDocument();
    at(10);
    expect(skipPill()).toBeInTheDocument();
    expect(prompt()).toBeNull();
    tap(K.back); // dismisses the skip pill
    expect(skipPill()).toBeNull();
    expect(prompt()).toBeInTheDocument();
  });

  it("keeps the skip pill's keys while it holds the corner", async () => {
    const { twoStalls, at, state } = await mount({ segments: [INTRO] });
    at(10);
    twoStalls();
    tap(K.ok);
    expect(state.seeks).toEqual([60]);
  });
});

describe('always, on Auto', () => {
  it('lowers at once, shows the undo pill, and OK restores', async () => {
    const { calls, twoStalls } = await mount({ mode: 'always' });
    twoStalls();
    vi.useRealTimers();
    await waitFor(() => expect(calls.replan).toHaveLength(1));
    expect(calls.replan[0]!.body).toMatchObject({ bandwidth_estimate_kbps: 7000 });
    const restore = await screen.findByTestId('player-buffering-restore');
    expect(restore).toHaveFocus();
    tap(K.ok);
    await waitFor(() => expect(calls.replan).toHaveLength(2));
    expect(calls.replan[1]!.body).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
      learned_limit: 'clear',
    });
    expect(screen.queryByTestId('player-buffering')).toBeNull();
  });

  it('Back on the undo pill only hides it', async () => {
    const { calls, twoStalls } = await mount({ mode: 'always' });
    twoStalls();
    vi.useRealTimers();
    await screen.findByTestId('player-buffering-restore');
    tap(K.back);
    expect(screen.queryByTestId('player-buffering')).toBeNull();
    expect(calls.replan).toHaveLength(1);
  });

  it('runs always, with no buffering fields, against a server that does not know the setting', async () => {
    const { calls, twoStalls } = await mount({ mode: 'never', revision: 22 });
    twoStalls();
    vi.useRealTimers();
    await waitFor(() => expect(calls.replan).toHaveLength(1));
    const body = calls.replan[0]!.body;
    expect(body).toMatchObject({
      bandwidth_estimate_kbps: 7000,
      client_features: ['playback_plan_v3'],
    });
    for (const field of [
      'bandwidth_estimate_source',
      'observed_throughput_kbps',
      'learned_limit',
    ]) {
      expect(body).not.toHaveProperty(field);
    }
    expect(calls.start[0]!.body).toMatchObject({ client_features: ['playback_plan_v3'] });
  });
});

describe('never', () => {
  it('shows nothing and sends nothing but the learned-limit control', async () => {
    const { calls, twoStalls } = await mount({ mode: 'never' });
    twoStalls();
    expect(prompt()).toBeNull();
    expect(calls.replan).toHaveLength(0);
    expect(calls.start[0]!.body).toMatchObject({ learned_limit: 'ignore' });
  });
});

describe('on a picked quality', () => {
  it('asks first even in always mode, and Lower sends the lower rung', async () => {
    const { calls, twoStalls } = await mount({ mode: 'always', quality: '1080p', kbps: 8000 });
    twoStalls();
    expect(prompt()).toBeInTheDocument();
    expect(calls.replan).toHaveLength(0);
    tap(K.ok);
    vi.useRealTimers();
    await waitFor(() => expect(calls.replan).toHaveLength(1));
    expect(calls.replan[0]!.body).toMatchObject({
      operation: 'quality_change',
      quality_preference: '720p',
    });
    expect(calls.replan[0]!.body).not.toHaveProperty('bandwidth_estimate_kbps');
    const notice = await screen.findByTestId('player-buffering-notice');
    expect(notice).toHaveTextContent('Quality lowered to stop buffering');
  });
});

describe("the can't-go-lower notice", () => {
  it('shows for 5 s when the plan names no bitrate, and sends nothing', async () => {
    const { calls, twoStalls } = await mount({ mode: 'always', kbps: undefined });
    twoStalls();
    expect(screen.getByTestId('player-buffering-notice')).toHaveTextContent(
      "This video can't go lower",
    );
    expect(prompt()).toBeNull();
    expect(calls.replan).toHaveLength(0);
    advance(4999);
    expect(screen.queryByTestId('player-buffering-notice')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByTestId('player-buffering-notice')).toBeNull();
  });
});

describe('the player events that reach the controller', () => {
  it('a seek makes the wait after it no stall, and the same wait without a seek is one', async () => {
    const { video, state } = await mount();
    const hold = (ms: number) => {
      for (let left = ms; left > 0; left -= 1000) {
        fireEvent(video, new Event('progress'));
        advance(Math.min(1000, left));
      }
    };
    state.paused = false;
    fireEvent.seeking(video);
    fireEvent(video, new Event('waiting'));
    hold(8000);
    expect(prompt()).toBeNull();
    fireEvent.playing(video);
    fireEvent(video, new Event('progress'));
    fireEvent(video, new Event('waiting'));
    hold(6000);
    expect(prompt()).toBeInTheDocument();
  });
});

describe('the pill and the rest of the player', () => {
  it('is hidden while a menu is open and comes back when it closes', async () => {
    const { twoStalls } = await mount();
    // Overlay, down to the buttons, right to the gear, OK: the settings menu opens.
    tap(K.up);
    tap(K.down);
    tap(K.right);
    tap(K.right);
    tap(K.ok);
    expect(screen.getByTestId('player-menu-settings')).toBeInTheDocument();
    twoStalls();
    expect(prompt()).toBeNull();
    tap(K.back);
    expect(screen.queryByTestId('player-menu-settings')).toBeNull();
    expect(prompt()).toBeInTheDocument();
  });

  it('Left and Right move between the buttons only while the pill is focused; otherwise they belong to the overlay', async () => {
    const { twoStalls } = await mount();
    twoStalls();
    tap(K.right);
    expect(keepButton()).toHaveAttribute('data-focused', 'true');
    tap(K.left);
    expect(lowerButton()).toHaveAttribute('data-focused', 'true');
    // Any other key opens the overlay with the focus on the scrubber: the pill is not focused.
    tap(K.up);
    expect(lowerButton()).toHaveAttribute('data-focused', 'false');
    tap(K.right);
    expect(lowerButton()).toHaveAttribute('data-focused', 'false');
    expect(keepButton()).toHaveAttribute('data-focused', 'false');
  });
});

describe('the pill in the full screen, round 5', () => {
  it('stands above the controls while the overlay is open', async () => {
    const { twoStalls } = await mount();
    twoStalls();
    expect(screen.getByTestId('player-buffering')).toHaveAttribute('data-raised', 'false');
    tap(K.up);
    expect(screen.getByTestId('player-buffering')).toHaveAttribute('data-raised', 'true');
  });

  it('shows a pause at 5 s on its countdown line', async () => {
    const { twoStalls, video, state } = await mount();
    twoStalls();
    advance(5000);
    state.paused = false;
    fireEvent.pause(video);
    expect(screen.getByTestId('player-buffering-line').style.animationDelay).toBe('-5000ms');
  });

  it('hovering Keep makes it the choice and moves the focus to the pill, also from the overlay', async () => {
    const { twoStalls } = await mount();
    twoStalls();
    tap(K.up); // the overlay opens with the focus on the scrubber
    expect(lowerButton()).toHaveAttribute('data-focused', 'false');
    fireEvent.mouseEnter(keepButton());
    expect(keepButton()).toHaveAttribute('data-focused', 'true');
    expect(lowerButton()).toHaveAttribute('data-focused', 'false');
  });

  it('Left and Right move between the buttons when the overlay is open and the pill has the focus', async () => {
    const { twoStalls } = await mount();
    twoStalls();
    tap(K.up);
    tap(K.down);
    // Right along the buttons until the pill has the focus.
    for (let i = 0; i < 8 && lowerButton().getAttribute('data-focused') !== 'true'; i += 1) {
      tap(K.right);
    }
    expect(lowerButton()).toHaveAttribute('data-focused', 'true');
    tap(K.right);
    expect(keepButton()).toHaveAttribute('data-focused', 'true');
    tap(K.left);
    expect(lowerButton()).toHaveAttribute('data-focused', 'true');
    tap(K.left);
    expect(lowerButton()).toHaveAttribute('data-focused', 'false');
  });

  it('reports itself shown when the skip pill gives the corner up: the re-offer wait counts from then', async () => {
    const { twoStalls, at } = await mount({ mode: 'ask', segments: [INTRO] });
    at(10);
    twoStalls();
    expect(prompt()).toBeNull();
    // The prompt waits 40 s behind the skip pill; it is shown at the moment the slot is free.
    advance(40_000);
    at(70);
    expect(prompt()).toBeInTheDocument();
    advance(15_000);
    expect(prompt()).toBeNull();
    // From 120 s after it showed (105 s from now) the next one may come; 90 s from now not yet.
    advance(90_000);
    twoStalls();
    expect(prompt()).toBeNull();
    advance(20_000);
    twoStalls();
    expect(prompt()).toBeInTheDocument();
  });
});

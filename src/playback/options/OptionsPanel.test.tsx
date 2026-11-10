// The options panel on the real PlayerScreen: opening, the tabs, Back, the keys, quality,
// "Auto-play next" and chapters, driven by key events like a remote. Real timers throughout: the
// spatial navigation decides asynchronously (pressKey waits for it), and nothing here lasts the 5 s
// the overlay needs to hide.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import type { components } from '../../api/generated/schema';
import { BASE_URL, account } from '../../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
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
  type PlaybackServerOptions,
} from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings, type SettingsServe } from '../../test/settingsFixtures';
import { PlayerScreen } from '../PlayerScreen';
import { clearInstallationCache } from '../usePlaybackSession';

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
  restoreMedia();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  server.resetHandlers();
});

const MEDIA = { playPause: 179, rewind: 412, stop: 413 };

const rung = (label: string, display_name?: string): S['AvailableQualityV3'] => ({
  label,
  preserves_source: false,
  ...(display_name ? { display_name } : {}),
});
const RUNGS = [rung('1080p', '1080p (8 Mbps)'), rung('720p')];

/** A plan on a stream of its own, so a replan to it reloads the video (a new `loadId`). */
const planOnStream = (n: number, overrides: Partial<S['PlaybackPlan']> = {}) =>
  playbackPlan({
    plan_id: `plan:${n}`,
    plan_attempt_key: `v3:key-${n}`,
    stream: {
      container: 'mp4',
      header_refresh: 'none',
      headers: {},
      protocol: 'http',
      url: `/api/v2/stream/${SESSION_ID}?st=signed-${n}`,
    },
    available_qualities: RUNGS,
    ...overrides,
  });

const CHAPTERS: S['WatchChapter'][] = [
  { index: 0, title: 'Opening', start_seconds: 0, end_seconds: 100, source: 'embedded' },
  { index: 1, title: '', start_seconds: 100, end_seconds: 200, source: 'embedded' },
  { index: 2, title: 'Finale', start_seconds: 200, end_seconds: 300, source: 'embedded' },
];

interface MountOptions extends PlaybackServerOptions {
  settings?: SettingsServe;
}

async function mount(options: MountOptions = {}) {
  const { settings, ...playback } = options;
  const calls = servePlayback(server, {
    start: [playableDecision(planOnStream(1))],
    ...playback,
  });
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
  const video = () => view.container.querySelector('video')!;
  const state = fakeVideo(video());
  state.duration = 5400;
  fireEvent.playing(video());
  // The overlay's amounts name the settings as known.
  await screen.findByLabelText('10 seconds back');
  return { calls, onExit, view, video, state };
}

const key = (keyCode: number) => fireEvent.keyDown(window, { keyCode });
const panel = () => screen.queryByTestId('player-options');
const overlayOpen = () => screen.getByTestId('player-osd').getAttribute('data-visible') === 'true';
const focusKey = () => document.activeElement?.getAttribute('data-focus-key');
const osdFocused = (name: string) =>
  document.querySelector(`[data-focus-key="${name}"]`)?.getAttribute('data-focused') === 'true';

/** Waits for the focus to rest on `name` (the spatial navigation moves it asynchronously). */
const focusOn = (name: string) => waitFor(() => expect(focusKey()).toBe(name));

/** Opens the panel the quick way: Down with the overlay hidden. */
async function openPanel() {
  key(KEY.down);
  await screen.findByTestId('player-options');
  await focusOn('player-opt-tab-info');
}

/** Moves along the tab strip to `tab` with Right, and Down into its first row. */
async function openTab(tab: 'video' | 'chapters', into = false) {
  await pressKey(KEY.right);
  if (tab === 'chapters') await pressKey(KEY.right);
  await focusOn(`player-opt-tab-${tab}`);
  if (into) await pressKey(KEY.down);
}

describe('opening the panel', () => {
  it('opens with Down while the overlay is hidden; the overlay stays hidden', async () => {
    await mount();
    expect(panel()).toBeNull();
    key(KEY.down);
    expect(await screen.findByTestId('player-options')).toBeInTheDocument();
    expect(overlayOpen()).toBe(false);
  });

  it('opens with Down on an OSD button, and with OK on the Options button', async () => {
    await mount();
    key(KEY.up); // the overlay opens on the scrubber
    key(KEY.down); // Play/Pause
    expect(osdFocused('playPause')).toBe(true);
    expect(panel()).toBeNull();
    key(KEY.down);
    expect(await screen.findByTestId('player-options')).toBeInTheDocument();
    expect(overlayOpen()).toBe(false);
    key(KEY.back);
    expect(panel()).toBeNull();

    // Back brought the overlay back on Options; OK there opens the panel again.
    expect(osdFocused('options')).toBe(true);
    key(KEY.enter);
    expect(await screen.findByTestId('player-options')).toBeInTheDocument();
  });

  it('does not open on Down while the focus is on the scrubber', async () => {
    await mount();
    key(KEY.up);
    expect(osdFocused('scrubber')).toBe(true);
    key(KEY.down);
    expect(osdFocused('playPause')).toBe(true);
    expect(panel()).toBeNull();
  });

  it('opens with a click on the Options button', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Options', hidden: true }));
    expect(await screen.findByTestId('player-options')).toBeInTheDocument();
  });

  it('keeps playing and draws the subtitles unlifted while it is open', async () => {
    const { state } = await mount();
    await openPanel();
    expect(state.pause).not.toHaveBeenCalled();
    expect(overlayOpen()).toBe(false);
  });
});

describe('the tabs', () => {
  it('opens with the focus on the Info tab, and again on the tab used last', async () => {
    await mount();
    await openPanel();
    expect(screen.getByTestId('options-info')).toBeInTheDocument();
    await pressKey(KEY.right);
    await focusOn('player-opt-tab-video');
    key(KEY.back);
    expect(panel()).toBeNull();
    key(KEY.down);
    await screen.findByTestId('player-options');
    await focusOn('player-opt-tab-video');
    expect(screen.getByTestId('options-tab-video')).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the focused tab at once with Left and Right', async () => {
    await mount({ watch: watchDetail({ versions: [watchVersion({ chapters: CHAPTERS })] }) });
    await openPanel();
    expect(screen.getByTestId('options-info')).toBeInTheDocument();
    await pressKey(KEY.right);
    await focusOn('player-opt-tab-video');
    expect(screen.getByTestId('options-quality')).toBeInTheDocument();
    expect(screen.queryByTestId('options-info')).toBeNull();
    await pressKey(KEY.right);
    await focusOn('player-opt-tab-chapters');
    expect(screen.getByTestId('options-chapters')).toBeInTheDocument();
    // The ends hold.
    await pressKey(KEY.right);
    expect(focusKey()).toBe('player-opt-tab-chapters');
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    await focusOn('player-opt-tab-info');
    await pressKey(KEY.left);
    expect(focusKey()).toBe('player-opt-tab-info');
    expect(screen.getByTestId('options-info')).toBeInTheDocument();
  });

  it('enters the rows with Down and returns to the active tab with Up from the first row', async () => {
    await mount();
    await openPanel();
    await openTab('video', true);
    await focusOn('player-opt-quality-auto');
    await pressKey(KEY.down);
    await focusOn('player-opt-quality-1080p');
    await pressKey(KEY.up);
    await focusOn('player-opt-quality-auto');
    await pressKey(KEY.up);
    await focusOn('player-opt-tab-video');
    // The Info tab has no rows: Down stays on the strip.
    await pressKey(KEY.left);
    await pressKey(KEY.down);
    expect(focusKey()).toBe('player-opt-tab-info');
  });

  it('hides the Chapters tab for a file without chapters', async () => {
    await mount();
    await openPanel();
    expect(screen.getByTestId('options-tab-video')).toBeInTheDocument();
    expect(screen.queryByTestId('options-tab-chapters')).toBeNull();
  });

  it('hides the Video tab for a movie without a quality choice, and shows no note', async () => {
    await mount({
      watch: watchDetail({ type: 'movie' }),
      start: [playableDecision(planOnStream(1, { available_qualities: [] }))],
    });
    await openPanel();
    expect(screen.queryByTestId('options-tab-video')).toBeNull();
    expect(screen.getByTestId('options-tab-info')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('nothing to choose');
  });

  it('keeps the Video tab for an episode without a quality choice: it holds "Auto-play next"', async () => {
    await mount({
      watch: watchDetail({ type: 'episode' }),
      start: [playableDecision(planOnStream(1, { available_qualities: [] }))],
    });
    await openPanel();
    expect(screen.getByTestId('options-tab-video')).toBeInTheDocument();
  });

  it('opens on Info when the remembered Video tab is gone after a reload', async () => {
    const { calls, video } = await mount({
      replan: [playableDecision(planOnStream(2, { available_qualities: [] }))],
    });
    await openPanel();
    await openTab('video', true);
    await pressKey(KEY.down);
    await focusOn('player-opt-quality-1080p');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    // The new plan offers no choice: the panel stays open, now on Info, with the tab focused.
    await focusOn('player-opt-tab-info');
    fireEvent.playing(video());
    expect(screen.queryByTestId('options-tab-video')).toBeNull();
    expect(screen.getByTestId('options-info')).toBeInTheDocument();
    key(KEY.back);
    expect(panel()).toBeNull();
    key(KEY.down);
    await screen.findByTestId('player-options');
    await focusOn('player-opt-tab-info');
    expect(screen.getByTestId('options-info')).toBeInTheDocument();
  });
});

describe('Back', () => {
  it('closes only the panel when it was opened with Down and the overlay hidden', async () => {
    const { onExit } = await mount();
    await openPanel();
    key(KEY.back);
    expect(panel()).toBeNull();
    expect(overlayOpen()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    // The old order applies again: with the overlay hidden, Back leaves.
    key(KEY.back);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('closes only the panel when it was opened from the Options button, and shows the overlay on it', async () => {
    const { onExit } = await mount();
    key(KEY.up);
    key(KEY.down);
    key(KEY.right);
    key(KEY.right);
    expect(osdFocused('options')).toBe(true);
    key(KEY.enter);
    await screen.findByTestId('player-options');
    await openTab('video', true);
    key(KEY.back);
    expect(panel()).toBeNull();
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('options')).toBe(true);
    expect(screen.getByRole('button', { name: 'Options' })).toHaveFocus();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('keeps the old order with the panel closed: overlay first, then leave', async () => {
    const { onExit } = await mount();
    key(KEY.up);
    expect(overlayOpen()).toBe(true);
    key(KEY.back);
    expect(overlayOpen()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    key(KEY.back);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('keys while the panel is open', () => {
  it('leave the arrows, OK and the other keys to the panel: no skip, no scrub, no overlay', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    await openPanel();
    await pressKey(KEY.left);
    await pressKey(KEY.right);
    await pressKey(KEY.up);
    // A rewind key would start the scrub ladder outside the panel.
    const rewind = new KeyboardEvent('keydown', { keyCode: MEDIA.rewind, cancelable: true });
    window.dispatchEvent(rewind);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(state.seeks).toEqual([]);
    expect(state.currentTime).toBe(100);
    expect(rewind.defaultPrevented).toBe(false);
    expect(overlayOpen()).toBe(false);
    expect(panel()).not.toBeNull();
  });

  it('still toggle playback with Play/Pause, without bringing the overlay back', async () => {
    const { state } = await mount();
    await openPanel();
    key(MEDIA.playPause);
    expect(state.play).toHaveBeenCalledTimes(1);
    key(MEDIA.playPause);
    expect(state.pause).toHaveBeenCalledTimes(1);
    expect(overlayOpen()).toBe(false);
    expect(panel()).not.toBeNull();
  });

  it('still stop the playback with the Stop key', async () => {
    const { onExit } = await mount();
    await openPanel();
    key(MEDIA.stop);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('do not show the overlay on pointer movement, and a click on the video does nothing', async () => {
    const { video, state } = await mount();
    await openPanel();
    fireEvent.mouseMove(screen.getByTestId('player'));
    expect(overlayOpen()).toBe(false);
    fireEvent.click(video());
    expect(state.play).not.toHaveBeenCalled();
    expect(state.pause).not.toHaveBeenCalled();
  });

  it('let the wheel move the focus in the panel, and leave it alone once the panel is closed', async () => {
    await mount();
    await openPanel();
    await openTab('video');
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    await act(async () => {
      window.dispatchEvent(wheel);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(wheel.defaultPrevented).toBe(true);
    await focusOn('player-opt-quality-auto');
    key(KEY.back);
    const after = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

describe('the loading cue beside the panel', () => {
  it('moves into the area left of the panel while it is open, and back when it closes', async () => {
    const { video } = await mount();
    fireEvent.waiting(video());
    const cue = await screen.findByTestId('player-cue');
    expect(cue).not.toHaveClass('player-cue-aside');
    await openPanel();
    expect(screen.getByTestId('player-cue')).toHaveClass('player-cue-aside');
    key(KEY.back);
    expect(screen.getByTestId('player-cue')).not.toHaveClass('player-cue-aside');
  });
});

describe('the skip pill and Back with the panel open', () => {
  const INTRO = { kind: 'intro', start_seconds: 10, end_seconds: 60 } as const;
  const withPill = async () => {
    const ctx = await mount({
      capabilities: playbackCapabilities({
        features: ['playback_plan_v3', 'sequenced_progress_v1', 'marker_segments_v1'],
      }),
      watch: watchDetail({ versions: [watchVersion({ marker_segments: [INTRO] })] }),
    });
    ctx.state.currentTime = 10;
    fireEvent.timeUpdate(ctx.video());
    await screen.findByTestId('player-skip');
    return ctx;
  };

  it('does not draw the pill while the panel is open, and draws it again after', async () => {
    await withPill();
    await openPanel();
    expect(screen.queryByTestId('player-skip')).toBeNull();
    key(KEY.back);
    expect(screen.getByTestId('player-skip')).toBeInTheDocument();
  });

  it('Back closes the panel and leaves the pill alone', async () => {
    const { onExit } = await withPill();
    await openPanel();
    key(KEY.back);
    expect(panel()).toBeNull();
    // Not dismissed: it is still offered.
    expect(screen.getByTestId('player-skip')).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Back closes the panel during an active scrub', async () => {
    const { onExit } = await mount();
    key(KEY.up);
    // The Rewind key enters the scrub at once.
    key(MEDIA.rewind);
    await screen.findByTestId('player-scrub');
    fireEvent.click(screen.getByRole('button', { name: 'Options', hidden: true }));
    await screen.findByTestId('player-options');
    key(KEY.back);
    expect(panel()).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('the remembered focus', () => {
  it('is reset when the panel closes: a new opening starts on the active tab, not on the row', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Options', hidden: true }));
    await focusOn('player-opt-tab-info');
    await openTab('video', true);
    await pressKey(KEY.down);
    await focusOn('player-opt-quality-1080p');
    key(KEY.back);
    expect(panel()).toBeNull();
    // Back left the overlay on the Options button; opening from there involves no other key.
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    await screen.findByTestId('player-options');
    await focusOn('player-opt-tab-video');
    // A remembered row would take the focus a moment later: it must stay on the tab.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(focusKey()).toBe('player-opt-tab-video');
  });

  it('is reset when a chapter pick closes the panel: the next opening starts on the tab', async () => {
    await mount({ watch: watchDetail({ versions: [watchVersion({ chapters: CHAPTERS })] }) });
    await openPanel();
    await openTab('chapters', true);
    await pressKey(KEY.down);
    await focusOn('player-opt-chapter-1');
    await pressKey(KEY.enter);
    await waitFor(() => expect(panel()).toBeNull());
    // The overlay is up on the scrubber: open the panel again from its Options button, so no key
    // press of this test competes with the panel for the focus.
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    await screen.findByTestId('player-options');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(focusKey()).toBe('player-opt-tab-chapters');
  });

  it('falls back to the active tab when the remembered row is gone after a reload', async () => {
    const { calls } = await mount({
      replan: [playableDecision(planOnStream(2, { available_qualities: [rung('720p')] }))],
    });
    await openPanel();
    await openTab('video', true);
    await pressKey(KEY.down);
    await focusOn('player-opt-quality-1080p');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    await waitFor(() =>
      expect(document.querySelector('[data-focus-key="player-opt-quality-1080p"]')).toBeNull(),
    );
    await focusOn('player-opt-tab-video');
  });
});

describe('the Info tab', () => {
  it('names the title, the episode, the route and the tracks, and never a URL or a token', async () => {
    await mount({
      watch: watchDetail({
        title: 'The Pilot',
        type: 'episode',
        series_title: 'Some Show',
        season_number: 1,
        episode_number: 2,
        year: 2021,
        versions: [
          watchVersion({
            resolution: '2160p',
            hdr: true,
            chapters: CHAPTERS,
            audio_tracks: [{ default: true, language: 'en', codec: 'eac3', channels: 6 }],
          }),
        ],
      }),
    });
    await openPanel();
    const info = screen.getByTestId('options-info');
    for (const text of [
      'Some Show',
      'The Pilot',
      'S1 · E2',
      '2021 · 1 h 30 min',
      'Direct play',
      'H264 · 2160p · HDR',
      'en · EAC3 · 5.1',
      'Off',
      'Opening',
    ]) {
      expect(info).toHaveTextContent(text);
    }
    expect(document.body.textContent).not.toContain(ACCESS_TOKEN);
    expect(document.body.textContent).not.toContain('signed-1');
    expect(document.body.textContent).not.toContain('/api/v2/stream');
  });

  it('names the route of a remux and of a transcode', async () => {
    await mount({
      start: [playableDecision(planOnStream(1, { delivery: 'server_transcode_hls' }))],
    });
    await openPanel();
    expect(screen.getByTestId('options-info')).toHaveTextContent('Transcode');
  });

  it('words a remux as Remux', async () => {
    await mount({ start: [playableDecision(planOnStream(1, { delivery: 'server_remux_hls' }))] });
    await openPanel();
    expect(screen.getByTestId('options-info')).toHaveTextContent('Remux');
  });
});

describe('quality', () => {
  it("lists Auto and the plan's qualities, by display name, with Auto checked", async () => {
    await mount();
    await openPanel();
    await openTab('video');
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows.map((row) => row.textContent)).toEqual(['Auto', '1080p (8 Mbps)', '720p']);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it("sends a quality_change replan with the row's label, and the panel survives the reload", async () => {
    const { calls, video } = await mount({
      replan: [playableDecision(planOnStream(2, { active_quality: '1080p' }))],
    });
    await openPanel();
    await openTab('video', true);
    const before = video();
    await pressKey(KEY.down);
    await focusOn('player-opt-quality-1080p');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body).toMatchObject({
      operation: 'quality_change',
      quality_preference: '1080p',
    });
    // A new stream: the video element is another one, the panel stays on the Video tab and the
    // focus is back on the row that was picked.
    await waitFor(() => expect(video()).not.toBe(before));
    expect(panel()).not.toBeNull();
    expect(screen.getByTestId('options-tab-video')).toHaveAttribute('aria-selected', 'true');
    await focusOn('player-opt-quality-1080p');
    expect(screen.getByRole('menuitemradio', { name: '1080p (8 Mbps)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('sends the literal auto for the Auto row when another quality is the preference', async () => {
    const { calls } = await mount({
      settings: { values: { 'playback.preferred_quality': '720p' } },
      replan: [playableDecision(planOnStream(2))],
    });
    await openPanel();
    await openTab('video');
    // The profile's 720p was sent at the start and is the checked row.
    expect(calls.start[0]?.body.quality_preference).toBe('720p');
    expect(screen.getByRole('menuitemradio', { name: '720p' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await pressKey(KEY.down);
    await focusOn('player-opt-quality-auto');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
    });
  });

  it('names the preference in the heading when no row matches it', async () => {
    await mount({ settings: { values: { 'playback.preferred_quality': '2160p' } } });
    await openPanel();
    await openTab('video');
    expect(screen.getByTestId('options-quality')).toHaveTextContent('Quality · 2160p');
    expect(
      screen.getAllByRole('menuitemradio').map((row) => row.getAttribute('aria-checked')),
    ).toEqual(['false', 'false', 'false']);
  });

  it('sends nothing for the checked row', async () => {
    const { calls } = await mount();
    await openPanel();
    await openTab('video', true);
    await focusOn('player-opt-quality-auto');
    await pressKey(KEY.enter);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(calls.replan).toHaveLength(0);
  });

  it('says so when the quality cannot be used, and the old stream plays on', async () => {
    const { calls, video } = await mount();
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/replan`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Bad Request', status: 400, code: 'invalid_quality' },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const before = video();
    await openPanel();
    await openTab('video', true);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('options-quality-note')).toHaveTextContent(
      "This quality can't be used right now.",
    );
    expect(video()).toBe(before);
    expect(calls.stop).toHaveLength(0);
    expect(panel()).not.toBeNull();
  });

  it('ignores further picks while a change is in flight', async () => {
    let replans = 0;
    await mount();
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/replan`, async () => {
        replans += 1;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return HttpResponse.json(playableDecision(planOnStream(2)));
      }),
    );
    await openPanel();
    await openTab('video', true);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(replans).toBe(1);
  });

  it('marks the row the plan reports when the server advertises plan_active_quality_v1', async () => {
    await mount({
      capabilities: {
        allowed: true,
        deliveries: ['original_http'],
        features: ['playback_plan_v3', 'sequenced_progress_v1', 'plan_active_quality_v1'],
        installation_id: 'install-1',
        protocol_versions: [3],
        revision: 'rev-1',
        state: 'available',
      },
      settings: { values: { 'playback.preferred_quality': '1080p' } },
      start: [playableDecision(planOnStream(1, { active_quality: '720p' }))],
    });
    await openPanel();
    await openTab('video');
    expect(screen.getByRole('menuitemradio', { name: '720p' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: '1080p (8 Mbps)' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

describe('Auto-play next', () => {
  const EPISODE = watchDetail({
    type: 'episode',
    series_title: 'Some Show',
    season_number: 1,
    episode_number: 1,
  });

  it('shows the row for an episode, not for a movie', async () => {
    await mount({ watch: EPISODE });
    await openPanel();
    await openTab('video');
    expect(screen.getByTestId('options-autoplay-value')).toHaveTextContent('On');
    cleanup();

    await mount({ watch: watchDetail({ type: 'movie' }) });
    await openPanel();
    await openTab('video');
    expect(screen.queryByTestId('options-autoplay-value')).toBeNull();
  });

  it('writes the toggled value at the profile_device scope on OK', async () => {
    const puts: { key: string; scope: string | null; body: unknown }[] = [];
    await mount({ watch: EPISODE });
    server.use(
      http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
        const body = (await request.json()) as { value: unknown };
        puts.push({
          key: String(params.key),
          scope: new URL(request.url).searchParams.get('scope'),
          body,
        });
        return HttpResponse.json({
          key: params.key,
          scope: 'profile_device',
          value: body.value,
          revision: 1,
        });
      }),
    );
    await openPanel();
    await openTab('video');
    // Down through the quality rows to the switch.
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.down);
    await focusOn('player-opt-autoplay');
    await pressKey(KEY.enter);
    await until(() => puts.length === 1);
    expect(puts[0]).toEqual({
      key: 'playback.auto_play_next',
      scope: 'profile_device',
      body: { value: false },
    });
    await waitFor(() =>
      expect(screen.getByTestId('options-autoplay-value')).toHaveTextContent('Off'),
    );
  });

  it('writes once when OK is pressed twice before the first write is answered', async () => {
    let writes = 0;
    await mount({ watch: EPISODE });
    server.use(
      http.put(`${BASE_URL}/api/v2/settings/values/:key`, async ({ request, params }) => {
        writes += 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
        const body = (await request.json()) as { value: unknown };
        return HttpResponse.json({
          key: params.key,
          scope: 'profile_device',
          value: body.value,
          revision: 1,
        });
      }),
    );
    await openPanel();
    await openTab('video');
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.down);
    await focusOn('player-opt-autoplay');
    await pressKey(KEY.enter);
    await pressKey(KEY.enter);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(writes).toBe(1);
  });

  it('shows the old value again when the write fails', async () => {
    let attempts = 0;
    await mount({ watch: EPISODE });
    server.use(
      http.put(`${BASE_URL}/api/v2/settings/values/:key`, () => {
        attempts += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await openPanel();
    await openTab('video');
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.down);
    await focusOn('player-opt-autoplay');
    await pressKey(KEY.enter);
    await until(() => attempts === 1);
    await waitFor(() =>
      expect(screen.getByTestId('options-autoplay-value')).toHaveTextContent('On'),
    );
  });
});

describe('chapters', () => {
  const withChapters = () =>
    mount({ watch: watchDetail({ versions: [watchVersion({ chapters: CHAPTERS })] }) });

  it('lists one row per chapter with its start, an untitled one by its place', async () => {
    await withChapters();
    await openPanel();
    await openTab('chapters');
    const rows = screen.getAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Opening0:00',
      'Chapter 21:40',
      'Finale3:20',
    ]);
    // The playhead is at the start: the first chapter plays.
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual(['true', null, null]);
    // The attribute options.css styles the current row by.
    expect(rows.map((row) => row.getAttribute('data-current') === 'true')).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('seeks to the chapter start on OK, closes the panel and shows the scrubber', async () => {
    const { state } = await withChapters();
    await openPanel();
    await openTab('chapters', true);
    await pressKey(KEY.down);
    await focusOn('player-opt-chapter-1');
    await pressKey(KEY.enter);
    await waitFor(() => expect(state.seeks.at(-1)).toBe(100));
    expect(panel()).toBeNull();
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('scrubber')).toBe(true);
  });
});

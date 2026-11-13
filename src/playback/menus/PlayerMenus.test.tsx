// The player's menus on the real PlayerScreen: opening and closing them with a remote's keys, the
// gear (quality), chapters and the info column. Real timers throughout: the
// spatial navigation decides asynchronously (pressKey waits for it), and nothing here lasts the 5 s
// the overlay needs to hide (the one test that does switches to a fake clock itself).
/// <reference types="node" />
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
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
import { clearInstallationCache } from '../session/startSession';
import type { OsdMenu } from './usePanelState';

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

const MEDIA = { playPause: 179, rewind: 412, stop: 413 };

const rung = (
  label: string,
  display_name?: string,
  bitrate_kbps?: number,
): S['AvailableQualityV3'] => ({
  label,
  preserves_source: false,
  ...(display_name ? { display_name } : {}),
  ...(bitrate_kbps ? { bitrate_kbps } : {}),
});
const RUNGS = [
  rung('1080p', '1080p (8 Mbps)', 8000),
  rung('720p', undefined, 3500),
  rung('480p', 'SD', 800),
];

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
const withChapters = () => watchDetail({ versions: [watchVersion({ chapters: CHAPTERS })] });

interface MountOptions extends PlaybackServerOptions {
  settings?: SettingsServe;
  lang?: 'de' | 'en';
}

/**
 * A fake clock that also runs with real time, so the spatial navigation's waits still pass. Install
 * it before a menu opens, so the overlay's own timer is the fake one from the start.
 */
const useClock = () =>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });

async function mount(options: MountOptions = {}) {
  const { settings, lang, ...playback } = options;
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
  const view = renderWithSilo(
    <PlayerScreen contentId="m1" title="First Title" onExit={onExit} onEpisode={vi.fn()} />,
    {
      session,
      lang,
    },
  );
  await screen.findByTestId('player');
  const video = () => view.container.querySelector('video')!;
  const state = fakeVideo(video());
  state.duration = 5400;
  fireEvent.playing(video());
  // The overlay's amounts name the settings as known.
  await screen.findByLabelText(lang === 'de' ? '10 Sekunden zurück' : '10 seconds back');
  return { calls, onExit, view, video, state };
}

const key = (keyCode: number) => fireEvent.keyDown(window, { keyCode });
const menu = (id: OsdMenu) => screen.queryByTestId(`player-menu-${id}`);
const info = () => screen.queryByTestId('player-info');
const overlayOpen = () => screen.getByTestId('player-osd').getAttribute('data-visible') === 'true';
const focusKey = () => document.activeElement?.getAttribute('data-focus-key');
const osdFocused = (name: string) =>
  document.querySelector(`[data-focus-key="${name}"]`)?.getAttribute('data-focused') === 'true';

/** Waits for the focus to rest on `name` (the spatial navigation moves it asynchronously). */
const focusOn = (name: string) => waitFor(() => expect(focusKey()).toBe(name));

/** Walks the overlay's focus to a button of the row (Up shows the overlay, Down, then Right). */
function toButton(name: string) {
  key(KEY.up);
  key(KEY.down);
  for (let i = 0; i < 7 && !osdFocused(name); i += 1) key(KEY.right);
  expect(osdFocused(name)).toBe(true);
}

/** Opens a menu with the keys; a popover is waited for, with the focus on a row. */
async function openMenu(name: OsdMenu) {
  toButton(name);
  key(KEY.enter);
  if (name === 'info') {
    await screen.findByTestId('player-info');
    return;
  }
  await screen.findByTestId(`player-menu-${name}`);
  await waitFor(() => expect(focusKey()).toMatch(/^player-menu-/));
}

const gearLabel = () => screen.getByTestId('player-quality-label').textContent;

describe('opening and closing', () => {
  it('opens with Enter on its button, on the checked row, and the overlay stays', async () => {
    await mount();
    expect(menu('settings')).toBeNull();
    await openMenu('settings');
    await focusOn('player-menu-quality-auto');
    expect(overlayOpen()).toBe(true);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('marks the button of an open popover as open, not focused: only the focused row has the focus', async () => {
    await mount();
    await openMenu('settings');
    await focusOn('player-menu-quality-auto');
    const gear = screen.getByRole('button', { name: 'Settings' });
    expect(gear).toHaveAttribute('data-open', 'true');
    expect(gear).toHaveAttribute('data-focused', 'false');
    const focusedNow = Array.from(document.querySelectorAll('[data-focused="true"]'));
    expect(focusedNow.map((el) => el.getAttribute('data-focus-key'))).toEqual([
      'player-menu-quality-auto',
    ]);
    key(KEY.back);
    expect(gear).not.toHaveAttribute('data-open');
    expect(gear).toHaveAttribute('data-focused', 'true');
  });

  it('opens with a click on its button, and a second click closes it', async () => {
    await mount();
    key(KEY.up);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByTestId('player-menu-settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(menu('settings')).toBeNull();
  });

  it('Up and Down walk the rows, and the ends hold', async () => {
    await mount();
    await openMenu('settings');
    await focusOn('player-menu-quality-auto');
    await pressKey(KEY.up);
    expect(focusKey()).toBe('player-menu-quality-auto');
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-1080p');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-480p');
    await pressKey(KEY.down);
    expect(focusKey()).toBe('player-menu-quality-480p');
  });

  it('Back closes it with the focus on its button; the overlay stays', async () => {
    const { onExit } = await mount();
    await openMenu('settings');
    key(KEY.back);
    expect(menu('settings')).toBeNull();
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('settings')).toBe(true);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("Back after the pointer hovered another button still puts the focus on the menu's own button", async () => {
    await mount();
    await openMenu('settings');
    fireEvent.mouseMove(screen.getByRole('button', { name: 'Info' }));
    key(KEY.back);
    expect(menu('settings')).toBeNull();
    expect(osdFocused('settings')).toBe(true);
    expect(osdFocused('info')).toBe(false);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
  });

  it('Left and Right close it and move to the neighbouring button, without opening that one', async () => {
    await mount({ watch: withChapters() });
    await openMenu('settings');
    await pressKey(KEY.left);
    expect(menu('settings')).toBeNull();
    // Chapters sits left of Settings (a missing Audio or Subtitles button does not leave a gap).
    expect(osdFocused('chapters')).toBe(true);
    expect(screen.getByRole('button', { name: 'Chapters' })).toHaveFocus();
    expect(menu('chapters')).toBeNull();

    key(KEY.enter);
    await screen.findByTestId('player-menu-chapters');
    await pressKey(KEY.right);
    expect(menu('chapters')).toBeNull();
    expect(osdFocused('settings')).toBe(true);
    expect(menu('settings')).toBeNull();
  });

  it('only one menu is open at a time: a click on another button switches', async () => {
    await mount({ watch: withChapters() });
    await openMenu('settings');
    fireEvent.click(screen.getByRole('button', { name: 'Chapters' }));
    expect(await screen.findByTestId('player-menu-chapters')).toBeInTheDocument();
    expect(menu('settings')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(await screen.findByTestId('player-info')).toBeInTheDocument();
    expect(menu('chapters')).toBeNull();
  });

  it('keeps the overlay open while a menu is open, and hides it 5 s after the menu closes', async () => {
    await mount();
    useClock();
    await openMenu('settings');
    act(() => void vi.advanceTimersByTime(30_000));
    expect(overlayOpen()).toBe(true);
    expect(menu('settings')).not.toBeNull();
    key(KEY.back);
    act(() => void vi.advanceTimersByTime(4999));
    expect(overlayOpen()).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(overlayOpen()).toBe(false);
  });

  it('keeps a long list inside its popover: the focused row is scrolled into view without animation', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      await mount({ watch: withChapters() });
      await openMenu('chapters');
      await pressKey(KEY.down);
      await focusOn('player-menu-chapter-1');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('the button row', () => {
  const focusedButton = () =>
    ['skipBack', 'playPause', 'skipForward', 'chapters', 'settings', 'info'].find(osdFocused);

  it('walks across the present menu buttons: no gap where Chapters is missing', async () => {
    await mount();
    key(KEY.up);
    key(KEY.down);
    const seen = [focusedButton()];
    for (let i = 0; i < 5; i += 1) {
      key(KEY.right);
      seen.push(focusedButton());
    }
    expect(seen).toEqual(['playPause', 'skipForward', 'settings', 'info', 'info', 'info']);
  });

  it('includes Chapters between the transport buttons and Settings when the file has chapters', async () => {
    await mount({ watch: withChapters() });
    key(KEY.up);
    key(KEY.down);
    const seen = [focusedButton()];
    for (let i = 0; i < 4; i += 1) {
      key(KEY.right);
      seen.push(focusedButton());
    }
    expect(seen).toEqual(['playPause', 'skipForward', 'chapters', 'settings', 'info']);
    // And back with Left, the start holding.
    for (let i = 0; i < 6; i += 1) key(KEY.left);
    expect(focusedButton()).toBe('skipBack');
  });
});

describe('the pointer in a menu', () => {
  it('does not scroll a row into view when the pointer focuses it, unlike a key', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      await mount({ watch: withChapters() });
      await openMenu('chapters');
      await focusOn('player-menu-chapter-0');
      scrollIntoView.mockClear();
      fireEvent.mouseMove(screen.getByRole('menuitem', { name: /Finale/ }));
      await focusOn('player-menu-chapter-2');
      expect(scrollIntoView).not.toHaveBeenCalled();
      await pressKey(KEY.up);
      await focusOn('player-menu-chapter-1');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('keys while a menu is open', () => {
  it('leave the arrows and OK to the menu: no skip, no scrub, nothing prevented', async () => {
    const { state } = await mount();
    state.currentTime = 100;
    await openMenu('settings');
    await pressKey(KEY.down);
    await pressKey(KEY.up);
    const rewind = new KeyboardEvent('keydown', { keyCode: MEDIA.rewind, cancelable: true });
    window.dispatchEvent(rewind);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(state.seeks).toEqual([]);
    expect(state.currentTime).toBe(100);
    expect(screen.queryByTestId('player-scrub')).toBeNull();
    // The player's handler leaves the keys it does not own alone.
    expect(rewind.defaultPrevented).toBe(false);
    expect(menu('settings')).not.toBeNull();
  });

  it('still toggle playback with Play/Pause, and leave on Stop', async () => {
    const { state, onExit } = await mount();
    await openMenu('settings');
    key(MEDIA.playPause);
    expect(state.play).toHaveBeenCalledTimes(1);
    key(MEDIA.playPause);
    expect(state.pause).toHaveBeenCalledTimes(1);
    expect(menu('settings')).not.toBeNull();
    key(MEDIA.stop);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('the blue key opens Info in place of the popover, and a second press closes Info', async () => {
    await mount();
    await openMenu('settings');
    key(406);
    expect(info()).not.toBeNull();
    expect(menu('settings')).toBeNull();
    expect(osdFocused('info')).toBe(true);
    expect(screen.queryByTestId('player-diagnostics')).toBeNull();
    key(406);
    expect(info()).toBeNull();
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('info')).toBe(true);
  });

  it('prevents the default of the blue key while a popover is open', async () => {
    await mount();
    await openMenu('settings');
    const blue = new KeyboardEvent('keydown', { keyCode: 406, cancelable: true });
    window.dispatchEvent(blue);
    expect(blue.defaultPrevented).toBe(true);
  });

  it('Play does nothing while playing, and Pause does nothing while paused, in a popover', async () => {
    const { state } = await mount();
    await openMenu('settings');
    state.paused = false;
    key(415);
    expect(state.play).not.toHaveBeenCalled();
    key(19);
    expect(state.pause).toHaveBeenCalledTimes(1);
    state.paused = true;
    key(19);
    expect(state.pause).toHaveBeenCalledTimes(1);
    key(415);
    expect(state.play).toHaveBeenCalledTimes(1);
  });

  it('a click on the video closes the menu and does not toggle play', async () => {
    const { video, state } = await mount();
    await openMenu('settings');
    fireEvent.click(video());
    expect(menu('settings')).toBeNull();
    expect(state.play).not.toHaveBeenCalled();
    expect(state.pause).not.toHaveBeenCalled();
    expect(overlayOpen()).toBe(true);
  });

  it('a click on an overlay area without a control closes the menu, one inside the menu does not', async () => {
    const { state } = await mount();
    await openMenu('settings');
    fireEvent.click(menu('settings')!);
    expect(menu('settings')).not.toBeNull();
    fireEvent.click(screen.getByTestId('player-osd'));
    expect(menu('settings')).toBeNull();
    expect(state.play).not.toHaveBeenCalled();
    expect(state.pause).not.toHaveBeenCalled();
  });

  it('a click inside the open Info column neither closes it nor toggles play', async () => {
    const { state } = await mount();
    await openMenu('info');
    fireEvent.click(screen.getByTestId('player-info-now'));
    fireEvent.click(screen.getByRole('heading', { name: 'Now' }));
    expect(info()).not.toBeNull();
    expect(state.play).not.toHaveBeenCalled();
    expect(state.pause).not.toHaveBeenCalled();
  });

  it('let the wheel move the focus in the menu, and leave it alone once it is closed', async () => {
    await mount();
    await openMenu('settings');
    await focusOn('player-menu-quality-auto');
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    await act(async () => {
      window.dispatchEvent(wheel);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(wheel.defaultPrevented).toBe(true);
    await focusOn('player-menu-quality-1080p');
    key(KEY.back);
    const after = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('a hovered row takes the focus, a click on it acts', async () => {
    const { calls } = await mount({ replan: [playableDecision(planOnStream(2))] });
    await openMenu('settings');
    fireEvent.mouseMove(screen.getByRole('menuitemradio', { name: /720p/ }));
    await focusOn('player-menu-quality-720p');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /720p/ }));
    await until(() => calls.replan.length === 1);
  });
});

describe('Back in order', () => {
  it('closes a menu first, then hides the overlay, then leaves', async () => {
    const { onExit } = await mount();
    await openMenu('settings');
    key(KEY.back);
    expect(menu('settings')).toBeNull();
    expect(overlayOpen()).toBe(true);
    key(KEY.back);
    expect(overlayOpen()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    key(KEY.back);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('closes the menu during a scrub before it cancels the scrub', async () => {
    const { onExit } = await mount();
    key(KEY.up);
    key(MEDIA.rewind);
    await screen.findByTestId('player-scrub');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('player-menu-settings');
    key(KEY.back);
    expect(menu('settings')).toBeNull();
    expect(screen.getByTestId('player-scrub')).toBeInTheDocument();
    key(KEY.back);
    expect(screen.queryByTestId('player-scrub')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });

  describe('with a skip pill', () => {
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

    it('hides the pill while a popover is open, and Back leaves it alone', async () => {
      const { onExit } = await withPill();
      await openMenu('settings');
      expect(screen.queryByTestId('player-skip')).toBeNull();
      key(KEY.back);
      expect(menu('settings')).toBeNull();
      // Not dismissed: it is still offered.
      expect(screen.getByTestId('player-skip')).toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();
    });

    it('Right from Info moves to the pill and closes Info', async () => {
      await withPill();
      await openMenu('info');
      expect(screen.getByTestId('player-skip')).toBeInTheDocument();
      key(KEY.right);
      expect(info()).toBeNull();
      expect(screen.getByTestId('player-skip')).toHaveAttribute('data-focused', 'true');
    });

    it('Back dismisses the pill after the menu, then hides the overlay', async () => {
      await withPill();
      await openMenu('settings');
      key(KEY.back);
      key(KEY.back);
      expect(screen.queryByTestId('player-skip')).toBeNull();
      expect(overlayOpen()).toBe(true);
      key(KEY.back);
      expect(overlayOpen()).toBe(false);
    });
  });
});

describe('the gear: settings', () => {
  it("lists Auto and the plan's qualities by display name, with Auto checked and the bitrates right", async () => {
    await mount();
    await openMenu('settings');
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows.map((row) => row.querySelector('.player-menu-row-name')?.textContent)).toEqual([
      'Auto',
      '1080p (8 Mbps)',
      '720p',
      'SD',
    ]);
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    // Mbps from 1000 kbps up, kbps below; none on Auto.
    expect(
      rows.map((row) => within(row).queryByTestId('menu-bitrate')?.textContent ?? null),
    ).toEqual([null, '8 Mbps', '3.5 Mbps', '800 kbps']);
    expect(screen.getByTestId('menu-quality')).toHaveTextContent('Quality');
  });

  it('writes the bitrate with a decimal comma in German', async () => {
    await mount({ lang: 'de' });
    await openMenu('settings');
    expect(screen.getAllByTestId('menu-bitrate').map((el) => el.textContent)).toEqual([
      '8 Mbps',
      '3,5 Mbps',
      '800 kbps',
    ]);
  });

  it('shows no bitrate for a rung without one', async () => {
    await mount({
      start: [playableDecision(planOnStream(1, { available_qualities: [rung('720p')] }))],
    });
    await openMenu('settings');
    expect(screen.queryByTestId('menu-bitrate')).toBeNull();
  });

  it("sends a quality_change replan with the row's label, then closes the menu with the focus back on the gear", async () => {
    const { calls, video } = await mount({
      replan: [playableDecision(planOnStream(2, { active_quality: '1080p' }))],
    });
    await openMenu('settings');
    const before = video();
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-1080p');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body).toMatchObject({
      operation: 'quality_change',
      quality_preference: '1080p',
    });
    // A new stream: the video element is another one, the menu is closed, the overlay is up and
    // the focus is on the gear button.
    await waitFor(() => expect(video()).not.toBe(before));
    await waitFor(() => expect(menu('settings')).toBeNull());
    expect(overlayOpen()).toBe(true);
    const gear = screen.getByRole('button', { name: /Settings/ });
    expect(gear).not.toHaveAttribute('data-open');
    expect(gear).toHaveAttribute('data-focused', 'true');
    await waitFor(() => expect(gear).toHaveFocus());
    expect(gearLabel()).toBe('1080p (8 Mbps)');
  });

  it('starts a later reload like a normal load: no overlay up, no gear focus', async () => {
    const { video } = await mount({
      replan: [playableDecision(planOnStream(2)), playableDecision(planOnStream(3))],
    });
    await openMenu('settings');
    const first = video();
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-1080p');
    await pressKey(KEY.enter);
    await waitFor(() => expect(video()).not.toBe(first));
    await waitFor(() => expect(menu('settings')).toBeNull());
    // The pick's own load lands on the gear with the overlay up ...
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('settings')).toBe(true);
    // ... a failure recovery after it is a load like any other.
    const second = video();
    fakeVideo(second).error = { code: 4, message: 'unsupported' };
    fireEvent.error(second);
    await waitFor(() => expect(video()).not.toBe(second));
    expect(overlayOpen()).toBe(false);
    expect(osdFocused('settings')).toBe(false);
  });

  it('hides the overlay by itself after the pick, as after any close', async () => {
    const { calls, video } = await mount({ replan: [playableDecision(planOnStream(2))] });
    useClock();
    await openMenu('settings');
    const before = video();
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-1080p');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    await waitFor(() => expect(video()).not.toBe(before));
    await waitFor(() => expect(menu('settings')).toBeNull());
    fireEvent.playing(video());
    expect(overlayOpen()).toBe(true);
    act(() => void vi.advanceTimersByTime(5000));
    expect(overlayOpen()).toBe(false);
  });

  it('closes the menu for an applied pick that keeps the stream, too', async () => {
    // The same stream URL: the plan changes, the video element stays.
    const { calls, video } = await mount({
      replan: [playableDecision(planOnStream(1, { plan_id: 'plan:other' }))],
    });
    await openMenu('settings');
    const before = video();
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-1080p');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    await waitFor(() => expect(menu('settings')).toBeNull());
    expect(video()).toBe(before);
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('settings')).toBe(true);
    expect(screen.getByRole('button', { name: /Settings/ })).toHaveFocus();
  });

  it('keeps the keys alive after a paused reload, where no frame plays: a key shows the overlay and Play/Pause resumes', async () => {
    const { calls, video, state } = await mount({ replan: [playableDecision(planOnStream(2))] });
    key(MEDIA.playPause);
    key(MEDIA.playPause);
    expect(state.pause).toHaveBeenCalledTimes(1);
    state.currentTime = 47;
    fireEvent.timeUpdate(video());
    // The pause showed the overlay: the gear is reached with the pointer.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('player-menu-settings');
    await focusOn('player-menu-quality-auto');
    const before = video();
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-1080p');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    await waitFor(() => expect(video()).not.toBe(before));
    await waitFor(() => expect(menu('settings')).toBeNull());
    // The new load is paused (autoplay off): its first decoded frame is all there will be.
    fireEvent.loadedData(video());
    // The time and the scrubber show where the load begins, not 0:00.
    await waitFor(() => expect(screen.getByTestId('player-time')).toHaveTextContent('0:47'));
    expect(screen.getByTestId('player-scrubber')).toHaveAttribute('aria-valuenow', '47');
    // The menu closed with the pick: one Back hides the overlay.
    key(KEY.back);
    expect(overlayOpen()).toBe(false);
    key(KEY.up);
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('scrubber')).toBe(true);
    key(MEDIA.playPause);
    expect(fakeVideo(video()).play).toHaveBeenCalledTimes(1);
  });

  it('sends the literal auto for the Auto row when another quality is the preference', async () => {
    const { calls } = await mount({
      settings: { values: { 'playback.preferred_quality': '720p' } },
      replan: [playableDecision(planOnStream(2))],
    });
    await openMenu('settings');
    // The profile's 720p was sent at the start and is the checked row.
    expect(calls.start[0]?.body.quality_preference).toBe('720p');
    expect(screen.getByRole('menuitemradio', { name: /720p/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await focusOn('player-menu-quality-720p');
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    await focusOn('player-menu-quality-auto');
    await pressKey(KEY.enter);
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
    });
  });

  it('names the preference in the heading when no row matches it, and the Enter that opened the menu picks nothing', async () => {
    const { calls } = await mount({
      settings: { values: { 'playback.preferred_quality': '2160p' } },
    });
    await openMenu('settings');
    expect(screen.getByTestId('menu-quality')).toHaveTextContent('Quality · 2160p');
    expect(
      screen.getAllByRole('menuitemradio').map((row) => row.getAttribute('aria-checked')),
    ).toEqual(['false', 'false', 'false', 'false']);
    // The first row (Auto) holds the focus, and the key that opened the menu did not press it.
    await focusOn('player-menu-quality-auto');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(calls.replan).toHaveLength(0);
  });

  it('sends nothing for the checked row', async () => {
    const { calls } = await mount();
    await openMenu('settings');
    await focusOn('player-menu-quality-auto');
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
    await openMenu('settings');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('menu-quality-note')).toHaveTextContent(
      "This quality can't be used right now.",
    );
    expect(video()).toBe(before);
    expect(calls.stop).toHaveLength(0);
    expect(menu('settings')).not.toBeNull();
    expect(osdFocused('settings')).toBe(false);
  });

  it('keeps the menu open, with the note, when the server cannot be reached for the moment', async () => {
    const { video } = await mount();
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/replan`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Unavailable', status: 503, code: 'unavailable' },
          { status: 503, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const before = video();
    await openMenu('settings');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    expect(await screen.findByTestId('menu-quality-note')).toBeInTheDocument();
    expect(video()).toBe(before);
    expect(menu('settings')).not.toBeNull();
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
    await openMenu('settings');
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    await pressKey(KEY.down);
    await pressKey(KEY.enter);
    // A second press while the first change is in flight is dropped, not answered as a refusal.
    expect(screen.queryByTestId('menu-quality-note')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(replans).toBe(1);
    expect(screen.queryByTestId('menu-quality-note')).toBeNull();
  });

  it('keeps the menu open while the change is in flight, and closes it onto the gear when it is applied', async () => {
    let replans = 0;
    const { video } = await mount();
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/replan`, async () => {
        replans += 1;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return HttpResponse.json(playableDecision(planOnStream(2)));
      }),
    );
    await openMenu('settings');
    const before = video();
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-1080p');
    await pressKey(KEY.enter);
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-720p');
    expect(menu('settings')).not.toBeNull();
    await waitFor(() => expect(video()).not.toBe(before), { timeout: 2500 });
    expect(replans).toBe(1);
    await waitFor(() => expect(menu('settings')).toBeNull());
    expect(screen.getByRole('button', { name: /Settings/ })).toHaveFocus();
  });

  it('keeps an open menu, on the row it was on, when the stream reloads for another reason', async () => {
    // A failure recovery loads a new stream under the open menu; it stays, with its focus.
    const { video } = await mount({ replan: [playableDecision(planOnStream(2))] });
    await openMenu('settings');
    const before = video();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-720p');
    fakeVideo(before).error = { code: 4, message: 'unsupported' };
    fireEvent.error(before);
    await waitFor(() => expect(video()).not.toBe(before));
    expect(menu('settings')).not.toBeNull();
    expect(overlayOpen()).toBe(true);
    await focusOn('player-menu-quality-720p');
  });

  it('falls back to the checked row, else the first, when the remembered row is gone after such a reload', async () => {
    const { video } = await mount({
      replan: [playableDecision(planOnStream(2, { available_qualities: [rung('1080p')] }))],
    });
    await openMenu('settings');
    const before = video();
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await focusOn('player-menu-quality-720p');
    fakeVideo(before).error = { code: 4, message: 'unsupported' };
    fireEvent.error(before);
    await waitFor(() => expect(video()).not.toBe(before));
    await waitFor(() =>
      expect(document.querySelector('[data-focus-key="player-menu-quality-720p"]')).toBeNull(),
    );
    // 720p is no row of the new plan: the checked row (Auto) takes the focus.
    await focusOn('player-menu-quality-auto');
  });

  it('marks the row the plan reports when the server advertises plan_active_quality_v1', async () => {
    await mount({
      capabilities: playbackCapabilities({
        features: ['playback_plan_v3', 'sequenced_progress_v1', 'plan_active_quality_v1'],
      }),
      settings: { values: { 'playback.preferred_quality': '1080p' } },
      start: [playableDecision(planOnStream(1, { active_quality: '720p' }))],
    });
    await openMenu('settings');
    expect(screen.getByRole('menuitemradio', { name: /720p/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: /1080p/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  describe('the button label', () => {
    it('says Auto while Auto is checked', async () => {
      await mount();
      key(KEY.up);
      expect(gearLabel()).toBe('Auto');
    });

    it("follows the checked row's display name", async () => {
      await mount({ settings: { values: { 'playback.preferred_quality': '1080p' } } });
      key(KEY.up);
      expect(gearLabel()).toBe('1080p (8 Mbps)');
    });

    it('names the preference when no row is checked', async () => {
      await mount({ settings: { values: { 'playback.preferred_quality': '2160p' } } });
      key(KEY.up);
      expect(gearLabel()).toBe('2160p');
    });

    it('follows a quality change after the reload', async () => {
      const { calls } = await mount({
        replan: [playableDecision(planOnStream(2, { active_quality: '480p' }))],
      });
      await openMenu('settings');
      for (let i = 0; i < 3; i += 1) await pressKey(KEY.down);
      await focusOn('player-menu-quality-480p');
      await pressKey(KEY.enter);
      await until(() => calls.replan.length === 1);
      await waitFor(() => expect(gearLabel()).toBe('SD'));
    });
  });

  describe('the settings button', () => {
    it('is hidden for a movie without a quality choice', async () => {
      await mount({
        watch: watchDetail({ type: 'movie' }),
        start: [playableDecision(planOnStream(1, { available_qualities: [] }))],
      });
      key(KEY.up);
      expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Info' })).toBeInTheDocument();
    });

    it('is hidden for an episode without a quality choice, too: Auto-play next is not in the gear', async () => {
      await mount({
        watch: watchDetail({ type: 'episode' }),
        start: [playableDecision(planOnStream(1, { available_qualities: [] }))],
      });
      key(KEY.up);
      expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    });

    it('closes for good when a new stream leaves it nothing to show: arrows, auto-hide and Back work', async () => {
      const { calls, video, onExit } = await mount({
        replan: [playableDecision(planOnStream(2, { available_qualities: [] }))],
      });
      useClock();
      await openMenu('settings');
      await pressKey(KEY.down);
      await focusOn('player-menu-quality-1080p');
      await pressKey(KEY.enter);
      await until(() => calls.replan.length === 1);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull());
      fireEvent.playing(video());
      expect(menu('settings')).toBeNull();
      // The keys are the player's again: an arrow moves the overlay's focus.
      key(KEY.right);
      expect(osdFocused('scrubber')).toBe(true);
      key(KEY.down);
      expect(osdFocused('playPause')).toBe(true);
      // No hidden menu holds the overlay open.
      act(() => void vi.advanceTimersByTime(5000));
      expect(overlayOpen()).toBe(false);
      // And Back is not taken by one: it leaves.
      expect(onExit).not.toHaveBeenCalled();
      key(KEY.back);
      expect(onExit).toHaveBeenCalledTimes(1);
    });
  });

  describe('without "Auto-play next"', () => {
    // The row is a profile setting on the settings screen, not part of the gear (as in Silo's web
    // player, which has no such toggle in the player).
    const EPISODE = watchDetail({
      type: 'episode',
      series_title: 'Some Show',
      season_number: 1,
      episode_number: 1,
    });

    it('lists the quality section only, for an episode too', async () => {
      await mount({ watch: EPISODE });
      await openMenu('settings');
      const box = screen.getByTestId('player-menu-settings');
      expect(box.querySelectorAll('.player-menu-heading')).toHaveLength(1);
      expect(screen.getAllByRole('menuitemradio')).toHaveLength(4);
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.queryByText('Playback')).toBeNull();
      expect(screen.queryByText(/Auto-play/)).toBeNull();
      // Down from the last quality holds: there is no row below it.
      for (let i = 0; i < 6; i += 1) await pressKey(KEY.down);
      await focusOn('player-menu-quality-480p');
    });

    it('writes nothing to the settings when a row is pressed', async () => {
      const puts: string[] = [];
      await mount({ watch: EPISODE });
      server.use(
        http.put(`${BASE_URL}/api/v2/settings/values/:key`, ({ params }) => {
          puts.push(String(params.key));
          return new HttpResponse(null, { status: 500 });
        }),
      );
      await openMenu('settings');
      await pressKey(KEY.enter);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(puts).toEqual([]);
    });
  });

  describe('the rows in detail', () => {
    it('marks the quality in use with a white disc and a black check', async () => {
      await mount();
      await openMenu('settings');
      const rows = screen.getAllByRole('menuitemradio');
      const marks = rows.map((row) => within(row).queryByTestId('menu-selected'));
      expect(marks.map((mark) => mark !== null)).toEqual([true, false, false, false]);
      expect(marks[0]).toHaveClass('player-menu-disc-on');
      expect(marks[0]?.querySelector('svg')).not.toBeNull();
      const css = readFileSync('src/styles/player-menus.css', 'utf-8');
      const disc = /\.player-menu-disc-on \{([^}]*)\}/.exec(css)?.[1] ?? '';
      expect(disc).toContain('color: #000');
      expect(disc).toContain('background: #fff');
      expect(disc).toContain('border-radius: 50%');
    });

    it('writes the bitrate as 8 Mbps, 8.5 Mbps (8,5 in German) and 640 kbps', async () => {
      const rungs = [rung('a', 'A', 8000), rung('b', 'B', 8500), rung('c', 'C', 640)];
      await mount({
        start: [playableDecision(planOnStream(1, { available_qualities: rungs }))],
      });
      await openMenu('settings');
      expect(screen.getAllByTestId('menu-bitrate').map((el) => el.textContent)).toEqual([
        '8 Mbps',
        '8.5 Mbps',
        '640 kbps',
      ]);
      cleanup();
      await mount({
        lang: 'de',
        start: [playableDecision(planOnStream(1, { available_qualities: rungs }))],
      });
      await openMenu('settings');
      expect(screen.getAllByTestId('menu-bitrate').map((el) => el.textContent)).toEqual([
        '8 Mbps',
        '8,5 Mbps',
        '640 kbps',
      ]);
    });
  });
});

describe('chapters', () => {
  it('has a button only for a file with chapters', async () => {
    await mount();
    key(KEY.up);
    expect(screen.queryByRole('button', { name: 'Chapters' })).toBeNull();
    cleanup();
    await mount({ watch: withChapters() });
    key(KEY.up);
    expect(screen.getByRole('button', { name: 'Chapters' })).toBeInTheDocument();
  });

  it('lists one row per chapter with its start, an untitled one by its place, the playing one marked', async () => {
    await mount({ watch: withChapters() });
    await openMenu('chapters');
    const rows = screen.getAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Opening0:00',
      'Chapter 21:40',
      'Finale3:20',
    ]);
    // The playhead is at the start: the first chapter plays, and the focus starts on it.
    expect(rows.map((row) => row.getAttribute('data-current'))).toEqual(['true', 'false', 'false']);
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual(['true', null, null]);
    await focusOn('player-menu-chapter-0');
  });

  it('marks the chapter the playhead is in', async () => {
    const { state, video } = await mount({ watch: withChapters() });
    state.currentTime = 150;
    fireEvent.timeUpdate(video());
    await openMenu('chapters');
    expect(screen.getAllByRole('menuitem').map((row) => row.getAttribute('data-current'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    await focusOn('player-menu-chapter-1');
  });

  it('seeks to the chapter start on OK and closes the menu: focus on its button, the overlay stays', async () => {
    const { state } = await mount({ watch: withChapters() });
    await openMenu('chapters');
    await pressKey(KEY.down);
    await focusOn('player-menu-chapter-1');
    await pressKey(KEY.enter);
    await waitFor(() => expect(state.seeks.at(-1)).toBe(100));
    expect(menu('chapters')).toBeNull();
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('chapters')).toBe(true);
    expect(screen.getByRole('button', { name: 'Chapters' })).toHaveFocus();
  });
});

describe('the chapter thumbnails', () => {
  const PICTURED: S['WatchChapter'][] = [
    {
      index: 0,
      title: 'Opening',
      start_seconds: 0,
      end_seconds: 100,
      source: 'embedded',
      thumbnail_url: '/api/v2/artwork/chapter/0.jpg?sig=a',
    },
    { index: 1, title: 'Middle', start_seconds: 100, end_seconds: 200, source: 'embedded' },
    {
      index: 2,
      title: 'Finale',
      start_seconds: 200,
      end_seconds: 300,
      source: 'embedded',
      thumbnail_url: 'https://cdn.example.test/c/2.jpg?sig=b',
    },
  ];
  const open = async () => {
    await mount({ watch: watchDetail({ versions: [watchVersion({ chapters: PICTURED })] }) });
    await openMenu('chapters');
  };
  const thumb = (n: number) =>
    within(screen.getAllByRole('menuitem')[n]!).getByTestId('chapter-thumb');

  it("loads the picture from the chapter's thumbnail_url, as the server named it", async () => {
    await open();
    // A relative URL is made absolute against the server; an absolute one stays as it is. Nothing
    // is appended to either (no token, no size).
    expect(thumb(0).querySelector('img')).toHaveAttribute(
      'src',
      `${BASE_URL}/api/v2/artwork/chapter/0.jpg?sig=a`,
    );
    expect(thumb(2).querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.test/c/2.jpg?sig=b',
    );
  });

  it('shows a placeholder with a film glyph for a chapter without a picture', async () => {
    await open();
    expect(thumb(1)).toHaveClass('player-chapter-placeholder');
    expect(thumb(1).querySelector('img')).toBeNull();
    expect(thumb(1).querySelector('svg')).not.toBeNull();
    expect(thumb(0)).not.toHaveClass('player-chapter-placeholder');
  });

  it('falls back to the placeholder when the picture fails to load, for that chapter only', async () => {
    await open();
    fireEvent.error(thumb(0).querySelector('img')!);
    expect(thumb(0)).toHaveClass('player-chapter-placeholder');
    expect(thumb(0).querySelector('img')).toBeNull();
    expect(thumb(2).querySelector('img')).not.toBeNull();
  });

  it('draws the picture 128 by 77 px with a small radius', () => {
    const css = readFileSync('src/styles/player-menus.css', 'utf-8');
    const rule = /\.player-chapter-thumb \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('width: 128px');
    expect(rule).toContain('height: 77px');
    expect(rule).toMatch(/border-radius: \d+px/);
  });

  it('has the heading "Chapters" and the lighter row on the chapter that plays, with no check', async () => {
    await open();
    expect(
      screen.getByTestId('player-menu-chapters').querySelector('.player-menu-heading'),
    ).toHaveTextContent('Chapters');
    const rows = screen.getAllByRole('menuitem');
    expect(rows.map((row) => row.getAttribute('data-current'))).toEqual(['true', 'false', 'false']);
    expect(screen.queryByRole('menuitemradio')).toBeNull();
    const css = readFileSync('src/styles/player-menus.css', 'utf-8');
    expect(css).toMatch(
      /\.player-menu-chapter\[data-current='true'\] \{\s*color: #fff;\s*background: rgba\(255, 255, 255, 0\.14\)/,
    );
  });
});

describe('a chapter pick after the pointer hovered another button', () => {
  it('still returns the focus to the Chapters button', async () => {
    const { state } = await mount({ watch: withChapters() });
    await openMenu('chapters');
    fireEvent.mouseMove(screen.getByRole('button', { name: 'Info' }));
    await pressKey(KEY.down);
    await focusOn('player-menu-chapter-1');
    await pressKey(KEY.enter);
    await waitFor(() => expect(state.seeks.at(-1)).toBe(100));
    expect(osdFocused('chapters')).toBe(true);
    expect(osdFocused('info')).toBe(false);
    expect(screen.getByRole('button', { name: 'Chapters' })).toHaveFocus();
  });
});

describe('the clock under a popover', () => {
  const clock = () => screen.getByTestId('player-clock');

  it('is not drawn while a popover menu is open, and returns when it closes', async () => {
    await mount({ watch: withChapters() });
    expect(clock()).toHaveAttribute('data-hidden', 'false');
    await openMenu('chapters');
    expect(clock()).toHaveAttribute('data-hidden', 'true');
    key(KEY.back);
    await waitFor(() => expect(menu('chapters')).toBeNull());
    expect(clock()).toHaveAttribute('data-hidden', 'false');
  });

  it('stays drawn for the Info panel, which does not reach it', async () => {
    await mount();
    await openMenu('info');
    expect(clock()).toHaveAttribute('data-hidden', 'false');
  });

  it('hides by opacity, so the clock keeps its place', () => {
    const css = readFileSync('src/styles.css', 'utf-8');
    const rule = /\.player-osd-clock\[data-hidden='true'\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('opacity: 0');
    expect(rule).not.toMatch(/display|visibility|position/);
  });
});

describe('the clock in German', () => {
  const ends = () => screen.getByTestId('player-ends').textContent ?? '';

  it('writes a 24 h end time for auto under a German UI', async () => {
    await mount({ lang: 'de', settings: { values: { 'ui.time_format': 'auto' } } });
    key(KEY.up);
    expect(ends()).toMatch(/^Endet um \d{2}:\d{2}$/);
  });

  it('follows an explicit 24h and 12h profile value under a German UI', async () => {
    await mount({ lang: 'de', settings: { values: { 'ui.time_format': '12h' } } });
    key(KEY.up);
    expect(ends()).toMatch(/^Endet um \d{1,2}:\d{2} (AM|PM)$/);
    cleanup();
    await mount({ lang: 'de', settings: { values: { 'ui.time_format': '24h' } } });
    key(KEY.up);
    expect(ends()).toMatch(/^Endet um \d{2}:\d{2}$/);
  });
});

describe('info', () => {
  const EPISODE_INFO = watchDetail({
    title: 'The Pilot',
    type: 'episode',
    series_title: 'Some Show',
    versions: [
      watchVersion({
        resolution: '2160p',
        hdr: true,
        audio_tracks: [{ default: true, language: 'en', codec: 'eac3', channels: 6 }],
      }),
    ],
  });

  it('OK on its button shows the column and OK again hides it; the focus stays on the button', async () => {
    await mount();
    await openMenu('info');
    expect(info()).toHaveAttribute('aria-label', 'Playback info');
    expect(screen.getByRole('button', { name: 'Info' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Info' })).toHaveAttribute('aria-pressed', 'true');
    // No interactive rows inside.
    expect(within(info()!).queryAllByRole('button')).toHaveLength(0);
    key(KEY.enter);
    expect(info()).toBeNull();
    expect(osdFocused('info')).toBe(true);
  });

  it('keeps the overlay up while it is open, and Back closes only the column', async () => {
    const { onExit } = await mount();
    useClock();
    await openMenu('info');
    act(() => void vi.advanceTimersByTime(30_000));
    expect(overlayOpen()).toBe(true);
    expect(info()).not.toBeNull();
    key(KEY.back);
    expect(info()).toBeNull();
    expect(overlayOpen()).toBe(true);
    expect(osdFocused('info')).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('leaves the wheel alone while it is open: nothing moves', async () => {
    await mount();
    await openMenu('info');
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
    await act(async () => {
      window.dispatchEvent(wheel);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(wheel.defaultPrevented).toBe(false);
    expect(osdFocused('info')).toBe(true);
    expect(info()).not.toBeNull();
  });

  it('keeps the overlay up for the normal idle time after the blue key closes it', async () => {
    await mount();
    useClock();
    key(406);
    await screen.findByTestId('player-info');
    // Open Info holds the overlay as long as it is open.
    act(() => void vi.advanceTimersByTime(30_000));
    expect(overlayOpen()).toBe(true);
    key(406);
    expect(info()).toBeNull();
    act(() => void vi.advanceTimersByTime(4000));
    expect(overlayOpen()).toBe(true);
    act(() => void vi.advanceTimersByTime(1500));
    expect(overlayOpen()).toBe(false);
  });

  it('Left closes it and moves to the neighbouring button', async () => {
    await mount();
    await openMenu('info');
    key(KEY.left);
    expect(info()).toBeNull();
    expect(osdFocused('settings')).toBe(true);
    expect(menu('settings')).toBeNull();
  });

  it('Right at the end holds, and the column stays', async () => {
    await mount();
    await openMenu('info');
    key(KEY.right);
    expect(info()).not.toBeNull();
    expect(osdFocused('info')).toBe(true);
  });

  it('names the route, the stream, the sizes, the codecs and the source file', async () => {
    const { state } = await mount({ watch: EPISODE_INFO });
    state.videoWidth = 3840;
    state.videoHeight = 2160;
    await openMenu('info');
    const column = info()!;
    for (const text of [
      'Direct play',
      'Plays directly',
      'Built-in',
      'File (progressive)',
      '3840×2160',
      'H.264 · direct',
      'English · E-AC-3 · 5.1',
      'Off',
      'MP4 · 1 MB',
      '8 Mbit/s',
      'HDR',
    ]) {
      expect(column).toHaveTextContent(text);
    }
    expect(column).toHaveAttribute('aria-label', 'Playback info');
    expect(screen.getByTestId('player-info-now')).toBeInTheDocument();
    expect(screen.getByTestId('player-info-source')).toBeInTheDocument();
  });

  it('names HLS in TS segments, and the transcode, for an HLS transcode', async () => {
    await mount({
      start: [
        playableDecision(
          planOnStream(1, {
            delivery: 'server_transcode_hls',
            decision_reason: 'quality_fixed_rung',
            stream: {
              container: 'mp4',
              header_refresh: 'none',
              headers: {},
              protocol: 'hls',
              url: `/api/v2/stream/${SESSION_ID}/index.m3u8?st=signed-1`,
            },
            effective_recipe: {
              video_codec: 'h264',
              audio_codec: 'aac',
              segment_container: 'mpegts',
            },
          }),
        ),
      ],
      settings: { values: { 'playback.preferred_quality': '720p' } },
    });
    await openMenu('info');
    expect(info()).toHaveTextContent('Transcode');
    expect(info()).toHaveTextContent('HLS · TS segments');
    expect(info()).toHaveTextContent('Quality chosen: 720p');
    expect(info()).not.toHaveTextContent('File (progressive)');
  });

  it('stands inside the overlay, above its gradient', async () => {
    await mount();
    await openMenu('info');
    // The gradient is the overlay's own background: only a child of the overlay paints over it.
    expect(info()!.closest('[data-testid="player-osd"]')).not.toBeNull();
    // It is not a sibling of the overlay (which would put it under the gradient or over the card).
    expect(info()!.parentElement).toBe(screen.getByTestId('player-osd'));
  });

  it('leaves out the frames when the element cannot count them', async () => {
    await mount();
    await openMenu('info');
    expect(info()).not.toHaveTextContent('Frames');
  });

  it('shows the dropped frames from getVideoPlaybackQuality, refreshed while it is open', async () => {
    const { video } = await mount();
    let dropped = 3;
    Object.defineProperty(video(), 'getVideoPlaybackQuality', {
      configurable: true,
      value: () => ({ droppedVideoFrames: dropped, totalVideoFrames: 972 }),
    });
    await openMenu('info');
    expect(info()).toHaveTextContent('Frames3 of 972 dropped');
    dropped = 9;
    await waitFor(() => expect(info()).toHaveTextContent('Frames9 of 972 dropped'), {
      timeout: 2500,
    });
  });

  it('never shows the name or the path of the file, in the panel or anywhere in the player', async () => {
    await mount({
      watch: watchDetail({
        versions: [
          watchVersion({
            file_name: 'Secret Movie (2020).mkv',
            file_path: '/media/secret/Secret Movie (2020).mkv',
          }),
        ],
      }),
    });
    await openMenu('info');
    const everything = document.body.innerHTML;
    for (const text of ['Secret Movie', '/media/secret', '.mkv']) {
      expect(everything).not.toContain(text);
      expect(info()!.textContent).not.toContain(text);
    }
  });

  it('never shows a URL, a path or a token', async () => {
    await mount({ watch: EPISODE_INFO });
    await openMenu('info');
    expect(document.body.textContent).not.toContain(ACCESS_TOKEN);
    expect(document.body.textContent).not.toContain('signed-1');
    expect(document.body.textContent).not.toContain('/api/v2/stream');
    expect(document.body.textContent).not.toMatch(/https?:\/\//);
  });
});

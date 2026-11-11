// The hint after a quality change went back to the quality before it, on the real PlayerScreen:
// what the gear shows, that the hint takes no key or focus, and how it is drawn.
/// <reference types="node" />
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../api/session';
import type { components } from '../api/generated/schema';
import { account } from '../test/apiFixtures';
import { fakeVideo, installFakeMedia } from '../test/fakeVideo';
import { KEY, pressKey } from '../test/keys';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackPlan,
  servePlayback,
} from '../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../test/renderFlow';
import { serveSettings } from '../test/settingsFixtures';
import { PlayerScreen, QUALITY_NOTICE_MS } from './PlayerScreen';
import { clearInstallationCache } from './session/startSession';

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

const RUNGS: S['AvailableQualityV3'][] = [
  { label: '1080p', preserves_source: false, display_name: '1080p (8 Mbps)', bitrate_kbps: 8000 },
  { label: '720p', preserves_source: false, bitrate_kbps: 3500 },
];

const planOnStream = (n: number) =>
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
  });

const key = (keyCode: number) => fireEvent.keyDown(window, { keyCode });
const focusKey = () => document.activeElement?.getAttribute('data-focus-key');
const osdFocused = (name: string) =>
  document.querySelector(`[data-focus-key="${name}"]`)?.getAttribute('data-focused') === 'true';

/** Opens the gear's menu from the overlay's buttons, with the focus on one of its rows. */
async function reopenMenu() {
  key(KEY.up);
  key(KEY.down);
  for (let i = 0; i < 7 && !osdFocused('settings'); i += 1) key(KEY.right);
  key(KEY.enter);
  await screen.findByTestId('player-menu-settings');
  await waitFor(() => expect(focusKey()).toMatch(/^player-menu-/));
}

/** The gear's menu is open on a title that played its first frame; the clock is a fake one. */
async function openedMenu() {
  // A fake clock that also runs with real time, so the spatial navigation's waits still pass.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
  const calls = servePlayback(server, {
    start: [playableDecision(planOnStream(1))],
    // The picked quality loads; the way back is another stream.
    replan: [2, 3, 4, 5, 6].map((n) => playableDecision(planOnStream(n))),
  });
  serveSettings(server);
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const view = renderWithSilo(
    <PlayerScreen contentId="m1" title="First Title" onExit={vi.fn()} onEpisode={vi.fn()} />,
    {
      session,
    },
  );
  await screen.findByTestId('player');
  const video = () => view.container.querySelector('video')!;
  fakeVideo(video()).duration = 5400;
  fireEvent.playing(video());
  await screen.findByLabelText('10 seconds back');
  await reopenMenu();
  return { calls, video, view };
}

const ROWS = ['auto', '1080p', '720p'];

/** Walks the open menu's focus to the quality row `label`. */
async function moveTo(label: string) {
  await waitFor(() => expect(focusKey()).toMatch(/^player-menu-quality-/));
  for (let i = 0; i < 4 && focusKey() !== `player-menu-quality-${label}`; i += 1) {
    const at = ROWS.indexOf(focusKey()!.replace('player-menu-quality-', ''));
    await pressKey(at < ROWS.indexOf(label) ? KEY.down : KEY.up);
  }
  await waitFor(() => expect(focusKey()).toBe(`player-menu-quality-${label}`));
}

/**
 * Picks 720p, waits for its load (the pick closes the menu), and fails that load before its first
 * frame: the way back to the quality before loads and the hint shows.
 */
async function pickAndFail(ctx: Awaited<ReturnType<typeof openedMenu>>) {
  await waitFor(() => expect(focusKey()).toBe('player-menu-quality-auto'));
  await pressKey(KEY.down);
  await pressKey(KEY.down);
  await waitFor(() => expect(focusKey()).toBe('player-menu-quality-720p'));
  const before = ctx.video();
  await pressKey(KEY.enter);
  await waitFor(() => expect(ctx.video()).not.toBe(before));
  expect(screen.getByTestId('player-quality-label')).toHaveTextContent('720p');
  const failing = ctx.video();
  fakeVideo(failing).error = { code: 4, message: 'unsupported' };
  fireEvent.error(failing);
  await waitFor(() => expect(ctx.video()).not.toBe(failing));
}

describe('the hint after a quality fell back', () => {
  it('shows for 4 s, then goes; the gear and the checked row are the previous quality again', async () => {
    const ctx = await openedMenu();
    expect(QUALITY_NOTICE_MS).toBe(4000);
    await pickAndFail(ctx);
    expect(ctx.calls.replan.map((call) => call.body.operation)).toEqual([
      'quality_change',
      'quality_change',
    ]);
    expect(ctx.calls.replan[1]?.body).toMatchObject({ quality_preference: 'auto' });
    const hint = await screen.findByTestId('player-quality-notice');
    expect(hint).toHaveTextContent("This quality can't be used right now.");
    expect(hint).toHaveAttribute('role', 'status');
    // The pick had closed the menu; the gear shows the restored preference, and the checked row
    // of the menu, opened again, is that preference as well.
    expect(screen.queryByTestId('player-menu-settings')).toBeNull();
    await reopenMenu();
    // The Enter that opened it picks nothing: the navigation still holds the 720p row from the
    // menu before, and gives the focus back to it when the rows mount.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(ctx.calls.replan).toHaveLength(2);
    await waitFor(() => expect(focusKey()).toBe('player-menu-quality-auto'));
    expect(screen.getByRole('menuitemradio', { name: /Auto/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: /720p/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByTestId('player-quality-label')).toHaveTextContent('Auto');

    await act(async () => {
      // A second of slack on each side: this fake clock also follows real time, so a busy machine
      // must not push the hint over its 4 s (the exact 4000 ms is pinned by the timer test below).
      await vi.advanceTimersByTimeAsync(QUALITY_NOTICE_MS - 1000);
    });
    expect(screen.getByTestId('player-quality-notice')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByTestId('player-quality-notice')).toBeNull();
  });

  it('arms its timer for exactly 4000 ms', async () => {
    const delays: number[] = [];
    const real = window.setTimeout;
    const ctx = await openedMenu();
    const spy = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay !== undefined) delays.push(delay);
      return real(handler as () => void, delay, ...args);
    }) as typeof window.setTimeout);
    await pickAndFail(ctx);
    await screen.findByTestId('player-quality-notice');
    spy.mockRestore();
    expect(delays).toContain(4000);
    expect(delays).not.toContain(3999);
    expect(delays).not.toContain(4001);
  });

  it('does not show again for a later load of the same fallback count, and shows again for a second fallback', async () => {
    const ctx = await openedMenu();
    await pickAndFail(ctx);
    await screen.findByTestId('player-quality-notice');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUALITY_NOTICE_MS + 100);
    });
    expect(screen.queryByTestId('player-quality-notice')).toBeNull();

    // Another load that plays (a pick that sticks) mounts the playing view again: no hint.
    await reopenMenu();
    await moveTo('1080p');
    const before = ctx.video();
    await pressKey(KEY.enter);
    await waitFor(() => expect(ctx.video()).not.toBe(before));
    fireEvent.playing(ctx.video());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByTestId('player-quality-notice')).toBeNull();

    // A second fallback in the same session shows it again.
    await reopenMenu();
    await moveTo('720p');
    const second = ctx.video();
    await pressKey(KEY.enter);
    await waitFor(() => expect(ctx.video()).not.toBe(second));
    const failing = ctx.video();
    fakeVideo(failing).error = { code: 4, message: 'unsupported' };
    fireEvent.error(failing);
    expect(await screen.findByTestId('player-quality-notice')).toBeInTheDocument();
    expect(ctx.calls.replan.map((call) => call.body.operation)).toEqual([
      'quality_change',
      'quality_change',
      'quality_change',
      'quality_change',
      'quality_change',
    ]);
  });

  it('clears its timer when the screen goes while the hint shows', async () => {
    const ctx = await openedMenu();
    const hintTimers: unknown[] = [];
    const cleared: unknown[] = [];
    const realSet = window.setTimeout;
    const realClear = window.clearTimeout;
    const set = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      const handle = realSet(handler as () => void, delay, ...args);
      // Other code (the HTTP client) arms timers of its own; the hint's is the one set from the screen.
      if (delay === QUALITY_NOTICE_MS && new Error().stack?.includes('PlayerScreen.tsx')) {
        hintTimers.push(handle);
      }
      return handle;
    }) as typeof window.setTimeout);
    const clear = vi.spyOn(window, 'clearTimeout').mockImplementation(((handle?: number) => {
      cleared.push(handle);
      return realClear(handle);
    }) as typeof window.clearTimeout);
    await pickAndFail(ctx);
    await screen.findByTestId('player-quality-notice');
    ctx.view.unmount();
    set.mockRestore();
    clear.mockRestore();
    expect(hintTimers).toHaveLength(1);
    expect(cleared).toContain(hintTimers[0]);
  });

  it('takes no focus and no key', async () => {
    const ctx = await openedMenu();
    await pickAndFail(ctx);
    const hint = await screen.findByTestId('player-quality-notice');
    expect(hint).not.toHaveAttribute('tabindex');
    expect(hint.querySelector('button, a, input, [tabindex]')).toBeNull();
    expect(document.activeElement).not.toBe(hint);
    // Keys keep working while it shows: Up brings the overlay up with the focus on the scrubber.
    key(KEY.up);
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'true');
    expect(osdFocused('scrubber')).toBe(true);
    expect(screen.getByTestId('player-quality-notice')).toBeInTheDocument();
    // And Back hides it again, as without the hint.
    key(KEY.back);
    expect(screen.getByTestId('player-osd')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('player-quality-notice')).toBeInTheDocument();
  });
});

describe('the hint style', () => {
  const css = readFileSync('src/styles.css', 'utf-8');
  const start = css.indexOf('.player-notice {');
  const rule = css.slice(start, css.indexOf('}', start));

  it('is flat, with no blur or shadow, and its text is at least 20 px', () => {
    expect(start).toBeGreaterThan(-1);
    expect(rule).not.toMatch(/backdrop-filter|box-shadow|text-shadow|filter:/);
    const size = Number(/font-size: (\d+)px/.exec(rule)?.[1]);
    expect(size).toBeGreaterThanOrEqual(20);
  });

  it('lets pointer and keys through, stays inside the safe area and above the bar', () => {
    expect(rule).toContain('pointer-events: none');
    // Centred horizontally: the left edge at the middle, moved back by half its own width.
    expect(rule).toContain('left: 50%');
    expect(rule).toContain('transform: translateX(-50%)');
    expect(rule).toContain('max-width: calc(100% - 2 * var(--safe-x))');
    expect(rule).toContain('bottom: calc(var(--safe-y) + 250px)');
  });
});

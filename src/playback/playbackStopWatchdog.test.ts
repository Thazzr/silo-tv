// The controller's stop order (unload first, the stop 2 s later), its first-frame watchdog and its
// distrust of implausible positions, all on a stub client under fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../api/client';
import { Session } from '../api/session';
import { BASE_URL, account } from '../test/apiFixtures';
import { FakeEngine } from '../test/fakeEngine';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  playbackCapabilities,
  playbackPlan,
  watchDetail,
} from '../test/playbackFixtures';
import { memoryStorage } from '../test/renderFlow';
import { stopTiming } from './stopTiming';
import {
  METADATA_TIMEOUT_MS,
  PROGRESS_INTERVAL_MS,
  PlaybackController,
  STOP_AFTER_UNLOAD_MS,
  clearInstallationCache,
  type SessionState,
} from './usePlaybackSession';

type Json = Record<string, unknown>;
type Event =
  | { kind: 'release' }
  | { kind: 'progress'; body: Json }
  | { kind: 'replan'; body: Json }
  | { kind: 'stop'; body: Json };

const GARBAGE = 9223372036.854;

beforeEach(() => {
  vi.useFakeTimers();
  // These tests are about the real delay.
  stopTiming.delayMs = undefined;
  clearInstallationCache();
});
afterEach(() => {
  vi.useRealTimers();
  stopTiming.waiting = 0;
});

function signedIn() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return session;
}

const ok = (status = 200) => new Response(null, { status });

interface StubOptions {
  /** Holds the start answer back until it resolves. */
  startGate?: Promise<void>;
  /** What a replan answers; default is a playable plan with a key of its own. */
  replan?: () => Promise<unknown>;
}

/** Answers the calls a controller makes and records, in order, what matters for the order tests. */
function setup(options: StubOptions = {}) {
  const events: Event[] = [];
  const client = {
    GET: vi.fn((path: string) =>
      Promise.resolve(
        path.includes('capabilities')
          ? { data: playbackCapabilities(), response: ok() }
          : { data: watchDetail(), response: ok() },
      ),
    ),
    POST: vi.fn(async (path: string, init: { body: Json }) => {
      if (path.endsWith('/start')) {
        await options.startGate;
        return { data: playableDecision(playbackPlan(), SESSION_ID), response: ok(201) };
      }
      if (path.endsWith('/replan')) {
        events.push({ kind: 'replan', body: init.body });
        return (
          options.replan?.() ??
          Promise.resolve({
            data: playableDecision(
              playbackPlan({ plan_id: 'plan:2', plan_attempt_key: 'v3:key-2' }),
            ),
            response: ok(),
          })
        );
      }
      events.push({ kind: 'progress', body: init.body });
      return { response: ok() };
    }),
    DELETE: vi.fn((_path: string, init: { body: Json }) => {
      events.push({ kind: 'stop', body: init.body });
      return Promise.resolve({ response: ok(204) });
    }),
  };
  const states: SessionState[] = [];
  const onEnded = vi.fn();
  const controller = new PlaybackController({
    client: client as unknown as SiloClient,
    baseUrl: BASE_URL,
    session: signedIn(),
    contentId: 'm1',
    onState: (state) => states.push(state),
    onMediaError: () => undefined,
    onEnded,
  });
  const engine = new FakeEngine();
  // What unloading does to a real element: its position is gone.
  const release = engine.release.bind(engine);
  engine.release = () => {
    events.push({ kind: 'release' });
    engine.currentTime = 0;
    release();
  };
  const of = <K extends Event['kind']>(kind: K) =>
    events.filter((event): event is Extract<Event, { kind: K }> => event.kind === kind);
  return { controller, engine, events, states, onEnded, of };
}

/** Started, attached and playing at `position`. */
async function playing(options: StubOptions = {}, position = 77) {
  const ctx = setup(options);
  await ctx.controller.begin();
  ctx.controller.attachEngine(ctx.engine);
  ctx.engine.currentTime = position;
  ctx.engine.paused = false;
  ctx.controller.onPlaying();
  return ctx;
}

/** Started and attached, but no metadata yet: a load in progress. */
async function loading(options: StubOptions = {}) {
  const ctx = setup(options);
  await ctx.controller.begin();
  ctx.controller.attachEngine(ctx.engine);
  return ctx;
}

describe('stop order: unload first, the stop later', () => {
  it('unloads the video at once and sends the stop 2000 ms later with the reading from before the unload', async () => {
    const { controller, engine, events, of } = await playing();
    expect(STOP_AFTER_UNLOAD_MS).toBe(2000);

    const done = controller.stop();
    expect(engine.released).toBe(true);
    expect(events).toEqual([{ kind: 'release' }]);

    await vi.advanceTimersByTimeAsync(STOP_AFTER_UNLOAD_MS - 1);
    expect(of('stop')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(events.map((event) => event.kind)).toEqual(['release', 'stop']);
    expect(of('stop')[0]?.body).toMatchObject({ position: 77, sequence: 1, is_paused: false });
  });

  it('sends exactly one stop when stop() is called twice and the screen is disposed after', async () => {
    const { controller, of } = await playing();
    const first = controller.stop();
    const second = controller.stop();
    controller.dispose();
    await vi.advanceTimersByTimeAsync(STOP_AFTER_UNLOAD_MS * 5);
    await Promise.all([first, second]);
    expect(of('release')).toHaveLength(1);
    expect(of('stop')).toHaveLength(1);
  });

  it('follows the same order at the end of the stream, then hands over', async () => {
    const { controller, engine, onEnded, events, of } = await playing({}, 5400);
    engine.ended = true;
    engine.paused = true;
    controller.onEnded();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ kind: 'release' }]);
    await vi.advanceTimersByTimeAsync(STOP_AFTER_UNLOAD_MS);
    expect(events.map((event) => event.kind)).toEqual(['release', 'stop']);
    expect(of('stop')[0]?.body).toMatchObject({ position: 5400, is_paused: true });
  });

  it('follows the same order when the controller is only disposed', async () => {
    const { controller, events, of } = await playing();
    controller.dispose();
    expect(events).toEqual([{ kind: 'release' }]);
    await vi.advanceTimersByTimeAsync(STOP_AFTER_UNLOAD_MS);
    expect(events.map((event) => event.kind)).toEqual(['release', 'stop']);
    expect(of('stop')[0]?.body).toMatchObject({ position: 77 });
  });

  it('keeps the position when the screen unmounts its video after the stop', async () => {
    const { controller, engine, of } = await playing();
    void controller.stop();
    // The screen's cleanup: the last position, then the second unload of the same engine.
    controller.attachEngine(null);
    engine.release();
    await vi.advanceTimersByTimeAsync(STOP_AFTER_UNLOAD_MS);
    expect(of('stop')).toHaveLength(1);
    expect(of('stop')[0]?.body).toMatchObject({ position: 77 });
  });

  it('reports no progress after the stop, neither on the heartbeat nor on a late pause', async () => {
    const { controller, of } = await playing();
    void controller.stop();
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL_MS * 3);
    controller.onPause();
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL_MS);
    expect(of('progress')).toHaveLength(0);
    expect(of('stop')).toHaveLength(1);
  });

  it('stops a session whose start came back after the screen was left, also after the delay', async () => {
    let open!: () => void;
    const startGate = new Promise<void>((resolve) => (open = resolve));
    const { controller, events, of } = setup({ startGate });
    const begun = controller.begin();
    await vi.advanceTimersByTimeAsync(10);
    controller.dispose();
    open();
    await vi.advanceTimersByTimeAsync(STOP_AFTER_UNLOAD_MS - 1);
    expect(of('stop')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await begun;
    expect(events.map((event) => event.kind)).toEqual(['stop']);
  });
});

describe('first-frame watchdog', () => {
  it('replans as a transport stall when nothing arrives within 20 s and nothing is buffered', async () => {
    const { of } = await loading();
    expect(METADATA_TIMEOUT_MS).toBe(20_000);
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS - 1);
    expect(of('replan')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(of('replan')).toHaveLength(1);
    expect(of('replan')[0]?.body).toMatchObject({
      operation: 'failure_recovery',
      failure: { classification: 'transport_stall' },
    });
  });

  it('asks the server for another route, not a reconnect, when a load after the first frame hangs', async () => {
    const { controller, engine, of } = await playing();
    // A quality change after the first frame: a new load that never delivers metadata.
    await controller.qualityChange('480p');
    expect(of('replan')).toHaveLength(1);
    controller.attachEngine(null);
    controller.attachEngine(engine);
    // The controller counts the session as having played (the case that would reconnect).
    controller.onPlaying();
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
    expect(of('replan')).toHaveLength(2);
    expect(of('replan')[1]?.body).toMatchObject({
      operation: 'failure_recovery',
      failure: { classification: 'transport_stall' },
    });
    // A reconnect would have been a track_change after a 1 s wait.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(of('replan').filter((e) => e.body.operation === 'track_change')).toHaveLength(0);
  });

  it('replans as a decoder failure when data arrived but no metadata', async () => {
    const { engine, of } = await loading();
    engine.buffered = [{ start: 0, end: 4 }];
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
    expect(of('replan')).toHaveLength(1);
    expect(of('replan')[0]?.body).toMatchObject({
      operation: 'failure_recovery',
      failure: { classification: 'decoder_failure' },
    });
  });

  it('does nothing when the metadata arrives at 19 s', async () => {
    const { controller, of } = await loading();
    await vi.advanceTimersByTimeAsync(19_000);
    controller.onLoadedMetadata();
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS * 3);
    expect(of('replan')).toHaveLength(0);
  });

  it('starts over with a new source', async () => {
    const { controller, of } = await loading();
    await vi.advanceTimersByTimeAsync(10_000);
    // The next load mounts its own element: the old one goes, the new one is attached.
    controller.attachEngine(null);
    controller.attachEngine(new FakeEngine());
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS - 1);
    expect(of('replan')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(of('replan')).toHaveLength(1);
  });

  describe('while the page is hidden', () => {
    let visibility: 'visible' | 'hidden' = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    const change = (state: 'visible' | 'hidden') => {
      visibility = state;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    afterEach(() => {
      visibility = 'visible';
    });

    it('does not start for an element attached while the page is hidden, but runs in full once shown', async () => {
      const { controller, engine, of } = setup();
      await controller.begin();
      visibility = 'hidden';
      controller.attachEngine(engine);
      await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
      expect(of('replan')).toHaveLength(0);
      change('visible');
      await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS - 1);
      expect(of('replan')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(of('replan')).toHaveLength(1);
    });

    it('pauses, and starts over when the page is shown again', async () => {
      const { engine, of } = await loading();
      // A paused element is left alone by the background handling; the watchdog is what is tested.
      engine.paused = true;
      await vi.advanceTimersByTimeAsync(15_000);
      change('hidden');
      await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS * 3);
      expect(of('replan')).toHaveLength(0);
      change('visible');
      await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS - 1);
      expect(of('replan')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(of('replan')).toHaveLength(1);
    });
  });

  it('counts a media error before 20 s as the one failure', async () => {
    const { controller, of } = await loading();
    await vi.advanceTimersByTimeAsync(5_000);
    await controller.onMediaError({ code: 3, message: 'decode failed' });
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS * 3);
    expect(of('replan')).toHaveLength(1);
    expect(of('replan')[0]?.body).toMatchObject({
      failure: { classification: 'decoder_failure', message: 'decode failed' },
    });
  });

  it('does not recover a second time for an error that follows the watchdog', async () => {
    // The first recovery is refused, so the failed load is still the current one.
    const { controller, of } = await loading({
      replan: () => Promise.resolve({ error: {}, response: ok(400) }),
    });
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
    expect(of('replan')).toHaveLength(1);
    await controller.onMediaError({ code: 2, message: 'late' });
    await controller.onMediaError({ code: 3, message: 'later' });
    expect(of('replan')).toHaveLength(1);
  });

  it('does nothing after a stop before 20 s', async () => {
    const { controller, of } = await loading();
    await vi.advanceTimersByTimeAsync(10_000);
    void controller.stop();
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS * 3);
    expect(of('replan')).toHaveLength(0);
  });

  it('does nothing after dispose', async () => {
    const { controller, of } = await loading();
    controller.dispose();
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS * 3);
    expect(of('replan')).toHaveLength(0);
  });
});

describe('implausible positions', () => {
  it('does not take an unknown time at loadedmetadata for the container origin', async () => {
    const { controller, engine } = await loading();
    engine.currentTime = GARBAGE;
    controller.onLoadedMetadata();
    engine.currentTime = 120;
    engine.paused = false;
    controller.onPlaying();
    const offset = playbackPlan().timeline.timeline_offset_seconds;
    expect(controller.reading()?.position).toBe(120 + offset);
  });

  it.each([
    ['INT64_MAX nanoseconds (unknown)', GARBAGE],
    ['not a number', Number.NaN],
    ['negative', -1],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('keeps the last good reading when currentTime is %s', async (_name, bad) => {
    const { controller, engine } = await playing({}, 120);
    expect(controller.reading()?.position).toBe(120);
    engine.currentTime = bad;
    expect(controller.reading()?.position).toBe(120);
    // A sane time is taken again.
    engine.currentTime = 130;
    expect(controller.reading()?.position).toBe(130);
  });

  it('falls back to the start position when there is no good reading yet', async () => {
    const { controller, engine } = await playing({}, GARBAGE);
    expect(engine.currentTime).toBe(GARBAGE);
    expect(controller.reading()?.position).toBe(0);
  });

  it('sends the last good position in a progress report, never the garbage', async () => {
    const { controller, engine, of } = await playing({}, 120);
    expect(controller.reading()?.position).toBe(120);
    engine.currentTime = GARBAGE;
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL_MS);
    expect(of('progress')).toHaveLength(1);
    expect(of('progress')[0]?.body.position).toBe(120);
  });

  it('sends the last good position with the stop, never the garbage', async () => {
    const { controller, engine, of } = await playing({}, 120);
    expect(controller.reading()?.position).toBe(120);
    engine.currentTime = GARBAGE;
    void controller.stop();
    await vi.advanceTimersByTimeAsync(STOP_AFTER_UNLOAD_MS);
    expect(of('stop')[0]?.body.position).toBe(120);
  });

  it('also distrusts a position the screen binds itself', async () => {
    const { controller } = await playing({}, 120);
    expect(controller.reading()?.position).toBe(120);
    controller.bindPlayer(() => ({ position: GARBAGE, paused: false }));
    expect(controller.reading()?.position).toBe(120);
  });
});

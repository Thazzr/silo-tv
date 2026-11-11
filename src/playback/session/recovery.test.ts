import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FirstFrameWatchdog,
  METADATA_TIMEOUT_MS,
  RECONNECT_BUDGET_MS,
  Recovery,
  type RecoveryDeps,
  type WatchdogDeps,
} from './recovery';
import type { QualityLoad } from './replan';
import type {
  MediaFailure,
  Plan,
  PlayerReading,
  ReplanOperation,
  ReplanOptions,
  ReplanResult,
} from './types';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setVisibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}

// --- First-frame watchdog ------------------------------------------------------------------------

function makeWatchdog(over: Partial<WatchdogDeps> & { buffered?: number } = {}) {
  const { buffered = 0, ...rest } = over;
  const deps = {
    isStopped: vi.fn(() => false),
    engine: vi.fn(() => ({ buffered: { length: buffered } }) as never),
    onStall: vi.fn(),
    ...rest,
  };
  return { deps, dog: new FirstFrameWatchdog(deps) };
}

describe('FirstFrameWatchdog', () => {
  it('does not run before a load announced itself', () => {
    const { dog } = makeWatchdog();
    dog.arm();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fires exactly after the metadata timeout, naming the seconds', () => {
    const { deps, dog } = makeWatchdog();
    dog.expect(true);
    vi.advanceTimersByTime(METADATA_TIMEOUT_MS - 1);
    expect(deps.onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deps.onStall).toHaveBeenCalledTimes(1);
    expect(deps.onStall).toHaveBeenCalledWith(
      { code: 2, message: 'No metadata within 20 s' },
      'transport_stall',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('classifies buffered data without metadata as a decoder failure', () => {
    const { deps, dog } = makeWatchdog({ buffered: 1 });
    dog.expect(true);
    vi.advanceTimersByTime(METADATA_TIMEOUT_MS);
    expect(deps.onStall).toHaveBeenCalledWith(
      { code: 3, message: 'No metadata within 20 s' },
      'decoder_failure',
    );
  });

  it('fires only once per load', () => {
    const { deps, dog } = makeWatchdog();
    dog.expect(true);
    vi.advanceTimersByTime(METADATA_TIMEOUT_MS * 3);
    expect(deps.onStall).toHaveBeenCalledTimes(1);
  });

  it('does not run for a gone element', () => {
    const { dog } = makeWatchdog();
    dog.expect(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not run once the session is stopped', () => {
    const { dog } = makeWatchdog({ isStopped: () => true });
    dog.expect(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not run while the page is hidden, and arms again when it is visible', () => {
    const { deps, dog } = makeWatchdog();
    setVisibility('hidden');
    dog.expect(true);
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('visible');
    dog.arm();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(METADATA_TIMEOUT_MS);
    expect(deps.onStall).toHaveBeenCalledTimes(1);
  });

  it('arms with a visible page, a running session and a load in progress', () => {
    const { dog } = makeWatchdog();
    setVisibility('visible');
    dog.expect(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('restarts the countdown when armed again', () => {
    const { deps, dog } = makeWatchdog();
    dog.expect(true);
    vi.advanceTimersByTime(METADATA_TIMEOUT_MS - 1_000);
    dog.arm();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(METADATA_TIMEOUT_MS - 1);
    expect(deps.onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deps.onStall).toHaveBeenCalledTimes(1);
  });

  it('clear stops the countdown without forgetting the load', () => {
    const { deps, dog } = makeWatchdog();
    dog.expect(true);
    dog.clear();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(METADATA_TIMEOUT_MS * 2);
    expect(deps.onStall).not.toHaveBeenCalled();
    dog.arm();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('disarm stops the countdown and the next arm does nothing', () => {
    const { deps, dog } = makeWatchdog();
    dog.expect(true);
    dog.disarm();
    expect(vi.getTimerCount()).toBe(0);
    dog.arm();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(METADATA_TIMEOUT_MS * 2);
    expect(deps.onStall).not.toHaveBeenCalled();
  });

  describe('when the timeout fires', () => {
    // The timeout handler checks again what arm() checked, because the state may have changed
    // while the timer ran; it is called directly for the cases a clear() would prevent.
    const fire = (dog: FirstFrameWatchdog) =>
      (dog as unknown as { onTimeout: () => void }).onTimeout();

    it('stalls nothing without an engine', () => {
      const { deps, dog } = makeWatchdog({ engine: () => null });
      dog.expect(true);
      fire(dog);
      expect(deps.onStall).not.toHaveBeenCalled();
    });

    it('stalls nothing when no load is awaited any more', () => {
      const { deps, dog } = makeWatchdog();
      fire(dog);
      expect(deps.onStall).not.toHaveBeenCalled();
    });

    it('stalls nothing when the session stopped meanwhile', () => {
      let stopped = false;
      const { deps, dog } = makeWatchdog({ isStopped: () => stopped });
      dog.expect(true);
      stopped = true;
      fire(dog);
      expect(deps.onStall).not.toHaveBeenCalled();
    });

    it('stalls once, then no longer awaits the load', () => {
      const { deps, dog } = makeWatchdog();
      dog.expect(true);
      fire(dog);
      fire(dog);
      expect(deps.onStall).toHaveBeenCalledTimes(1);
    });
  });
});

// --- Recovery ------------------------------------------------------------------------------------

const PLAN = { selected_tracks: { audio_index: 1 } } as unknown as Plan;
const FAIL: MediaFailure = { code: 3, message: 'decode' };

interface Harness {
  deps: RecoveryDeps & {
    isStopped: ReturnType<typeof vi.fn>;
    isReplanning: ReturnType<typeof vi.fn>;
    ready: ReturnType<typeof vi.fn>;
    loadId: ReturnType<typeof vi.fn>;
    hasPlayed: ReturnType<typeof vi.fn>;
    viewerPaused: ReturnType<typeof vi.fn>;
    startPosition: ReturnType<typeof vi.fn>;
    reading: ReturnType<typeof vi.fn>;
    plan: ReturnType<typeof vi.fn>;
    reportFailure: ReturnType<typeof vi.fn>;
    markNotPlaying: ReturnType<typeof vi.fn>;
    disarmWatchdog: ReturnType<typeof vi.fn>;
    takeQualityLoad: ReturnType<typeof vi.fn>;
    replan: ReturnType<typeof vi.fn>;
    sendPausedProgress: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
    sessionGone: ReturnType<typeof vi.fn>;
    prepareRestart: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  rec: Recovery;
}

function make(over: Partial<Record<keyof RecoveryDeps, unknown>> = {}): Harness {
  const deps = {
    isStopped: vi.fn(() => false),
    isReplanning: vi.fn(() => false),
    ready: vi.fn(() => true),
    loadId: vi.fn(() => 1),
    hasPlayed: vi.fn(() => false),
    viewerPaused: vi.fn(() => false),
    startPosition: vi.fn(() => 11),
    reading: vi.fn((): PlayerReading | null => ({ position: 42, paused: false })),
    plan: vi.fn((): Plan | null => PLAN),
    reportFailure: vi.fn(),
    markNotPlaying: vi.fn(),
    disarmWatchdog: vi.fn(),
    takeQualityLoad: vi.fn((): QualityLoad | null => null),
    replan: vi.fn(async (...args: [ReplanOperation, ReplanOptions?]): Promise<ReplanResult> => {
      void args;
      return { kind: 'applied' };
    }),
    sendPausedProgress: vi.fn(),
    fail: vi.fn(),
    sessionGone: vi.fn(),
    prepareRestart: vi.fn(),
    start: vi.fn(async (...args: [number]) => void args),
    ...over,
  } as unknown as Harness['deps'];
  return { deps, rec: new Recovery(deps) };
}

const replanCalls = (h: Harness) => h.deps.replan.mock.calls as [ReplanOperation, ReplanOptions][];
const result = (kind: ReplanResult['kind'], extra: object = {}) =>
  vi.fn(async (): Promise<ReplanResult> => ({ kind, ...extra }) as ReplanResult);

describe('Recovery guards', () => {
  it('always tells the watchdog that the load has an answer, even when it then does nothing', async () => {
    const h = make({ isStopped: vi.fn(() => true) });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.disarmWatchdog).toHaveBeenCalledTimes(1);
    expect(h.deps.reportFailure).not.toHaveBeenCalled();
  });

  it.each([
    ['stopped', { isStopped: vi.fn(() => true) }],
    ['replanning', { isReplanning: vi.fn(() => true) }],
    ['not ready', { ready: vi.fn(() => false) }],
  ])('does nothing when the session is %s', async (_name, over) => {
    const h = make(over);
    await h.rec.onMediaError(FAIL);
    expect(h.deps.reportFailure).not.toHaveBeenCalled();
    expect(h.deps.markNotPlaying).not.toHaveBeenCalled();
    expect(h.deps.replan).not.toHaveBeenCalled();
  });

  it('recovers one load once, and a later load again', async () => {
    const h = make();
    await h.rec.onMediaError(FAIL);
    await h.rec.onMediaError(FAIL);
    expect(h.deps.reportFailure).toHaveBeenCalledTimes(1);
    expect(h.deps.replan).toHaveBeenCalledTimes(1);
    h.deps.loadId.mockReturnValue(2);
    await h.rec.onMediaError(FAIL);
    expect(h.deps.reportFailure).toHaveBeenCalledTimes(2);
    expect(h.deps.replan).toHaveBeenCalledTimes(2);
  });

  it('reports the failure and marks playback stopped before it replans', async () => {
    const h = make();
    await h.rec.onMediaError(FAIL);
    expect(h.deps.reportFailure).toHaveBeenCalledWith(FAIL);
    expect(h.deps.markNotPlaying).toHaveBeenCalledTimes(1);
    expect(h.deps.reportFailure.mock.invocationCallOrder[0]).toBeLessThan(
      h.deps.replan.mock.invocationCallOrder[0]!,
    );
  });

  it('ignores a second error while a reconnect runs, and is active meanwhile', async () => {
    const h = make({ hasPlayed: vi.fn(() => true), replan: result('transient') });
    expect(h.rec.active).toBe(false);
    const first = h.rec.onMediaError({ code: 2, message: 'net' });
    expect(h.rec.active).toBe(true);
    h.deps.loadId.mockReturnValue(2);
    await h.rec.onMediaError({ code: 2, message: 'net' });
    expect(h.deps.reportFailure).toHaveBeenCalledTimes(1);
    h.rec.cancelWait();
    h.deps.isStopped.mockReturnValue(true);
    await first;
  });

  it('ignores a second error while a restart runs, and is active meanwhile', async () => {
    let release = () => {};
    const h = make({
      start: vi.fn(() => new Promise<void>((r) => (release = r))),
    });
    expect(h.rec.active).toBe(false);
    const restart = h.rec.restartAt(5);
    expect(h.rec.active).toBe(true);
    await h.rec.onMediaError(FAIL);
    expect(h.deps.reportFailure).not.toHaveBeenCalled();
    expect(h.deps.replan).not.toHaveBeenCalled();
    release();
    await restart;
    expect(h.rec.active).toBe(false);
  });
});

describe('Recovery failure classification', () => {
  it.each([
    [1, 'transport_stall'],
    [2, 'transport_stall'],
    [3, 'decoder_failure'],
    [4, 'decoder_failure'],
    [5, 'transport_stall'],
  ])('sends media error code %i as %s', async (code, classification) => {
    const h = make();
    await h.rec.onMediaError({ code, message: 'm' });
    expect(replanCalls(h)).toEqual([
      ['failure_recovery', { failure: { classification, message: 'm' } }],
    ]);
  });

  it('lets a caller that names the classification decide it', async () => {
    const h = make();
    await h.rec.onMediaError({ code: 3, message: 'm' }, 'transport_stall');
    expect(replanCalls(h)[0]![1].failure?.classification).toBe('transport_stall');
  });

  it('cuts the message to 512 characters', async () => {
    const h = make();
    await h.rec.onMediaError({ code: 3, message: 'x'.repeat(600) });
    expect(replanCalls(h)[0]![1].failure?.message).toBe('x'.repeat(512));
  });
});

describe('Recovery quality fallback', () => {
  const pick = (loadId: number): QualityLoad => ({ loadId, previous: '720p' }) as QualityLoad;

  it('goes back to the quality before, at the position, with a forced reload', async () => {
    const h = make({ takeQualityLoad: vi.fn(() => pick(1)) });
    await h.rec.onMediaError(FAIL);
    expect(replanCalls(h)).toEqual([
      ['quality_change', { quality: '720p', position: 42, forceReload: true, fallback: true }],
    ]);
  });

  it('takes the start position when the player has not reported one', async () => {
    const h = make({ takeQualityLoad: vi.fn(() => pick(1)), reading: vi.fn(() => null) });
    await h.rec.onMediaError(FAIL);
    expect(replanCalls(h)[0]![1].position).toBe(11);
  });

  it('keeps a reported position of zero', async () => {
    const h = make({
      takeQualityLoad: vi.fn(() => pick(1)),
      reading: vi.fn(() => ({ position: 0, paused: false })),
    });
    await h.rec.onMediaError(FAIL);
    expect(replanCalls(h)[0]![1].position).toBe(0);
  });

  it('stops there when the fallback applied', async () => {
    const h = make({ takeQualityLoad: vi.fn(() => pick(1)) });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.replan).toHaveBeenCalledTimes(1);
    expect(h.deps.fail).not.toHaveBeenCalled();
  });

  it('runs the failure path when the fallback was not possible', async () => {
    const h = make({ takeQualityLoad: vi.fn(() => pick(1)) });
    h.deps.replan.mockResolvedValueOnce({ kind: 'refused' });
    await h.rec.onMediaError(FAIL);
    expect(replanCalls(h).map(([op]) => op)).toEqual(['quality_change', 'failure_recovery']);
  });

  it('does not continue when the session stopped during the fallback', async () => {
    const h = make({ takeQualityLoad: vi.fn(() => pick(1)) });
    h.deps.replan.mockImplementationOnce(async () => {
      h.deps.isStopped.mockReturnValue(true);
      return { kind: 'refused' };
    });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.replan).toHaveBeenCalledTimes(1);
  });

  it('ignores a quality pick of another load', async () => {
    const h = make({ takeQualityLoad: vi.fn(() => pick(9)) });
    await h.rec.onMediaError(FAIL);
    expect(replanCalls(h).map(([op]) => op)).toEqual(['failure_recovery']);
  });

  it('ignores the quality pick once the video has played', async () => {
    const h = make({ takeQualityLoad: vi.fn(() => pick(1)), hasPlayed: vi.fn(() => true) });
    await h.rec.onMediaError(FAIL);
    expect(replanCalls(h).map(([op]) => op)).toEqual(['failure_recovery']);
  });
});

describe('Recovery results of a failure recovery', () => {
  it.each([['applied'], ['busy']] as const)('%s ends the matter', async (kind) => {
    const h = make({ replan: result(kind) });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.fail).not.toHaveBeenCalled();
    expect(h.deps.sessionGone).not.toHaveBeenCalled();
    expect(h.deps.start).not.toHaveBeenCalled();
    expect(h.deps.replan).toHaveBeenCalledTimes(1);
  });

  it('shows a terminal answer with its message and reason', async () => {
    const h = make({ replan: result('terminal', { message: 'nope', reason: 'no_route' }) });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.fail).toHaveBeenCalledWith('terminal', 'nope', 'no_route');
    expect(h.deps.sessionGone).not.toHaveBeenCalled();
  });

  it('reports an ended session as gone', async () => {
    const h = make({ replan: result('ended') });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.sessionGone).toHaveBeenCalledTimes(1);
    expect(h.deps.fail).not.toHaveBeenCalled();
    expect(h.deps.start).not.toHaveBeenCalled();
  });

  it('restarts a session the server forgot at the reported position', async () => {
    const h = make({ replan: result('gone') });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.prepareRestart).toHaveBeenCalledTimes(1);
    expect(h.deps.start).toHaveBeenCalledWith(42);
    expect(h.deps.sessionGone).not.toHaveBeenCalled();
  });

  it('restarts at the start position when nothing was reported', async () => {
    const h = make({ replan: result('gone'), reading: vi.fn(() => null) });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.start).toHaveBeenCalledWith(11);
  });

  it('restarts at position zero when that is where the player is', async () => {
    const h = make({
      replan: result('gone'),
      reading: vi.fn(() => ({ position: 0, paused: false })),
    });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.start).toHaveBeenCalledWith(0);
  });

  it.each([['refused'], ['loop']] as const)('fails on %s without details', async (kind) => {
    const h = make({ replan: result(kind) });
    await h.rec.onMediaError(FAIL);
    expect(h.deps.fail).toHaveBeenCalledTimes(1);
    expect(h.deps.fail).toHaveBeenCalledWith('failed');
  });

  it('joins the reconnect on a transient answer', async () => {
    const h = make({ replan: result('transient') });
    const run = h.rec.onMediaError(FAIL);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(replanCalls(h).map(([op]) => op)).toEqual(['failure_recovery', 'track_change']);
    h.rec.cancelWait();
    h.deps.isStopped.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(RECONNECT_BUDGET_MS);
    await run;
  });
});

describe('Recovery reconnect', () => {
  const lost: MediaFailure = { code: 2, message: 'net' };

  /** A lost connection: a network error after the first frame. */
  function lostConnection(over: Partial<Record<keyof RecoveryDeps, unknown>> = {}) {
    return make({ hasPlayed: vi.fn(() => true), replan: result('transient'), ...over });
  }

  it('does not use the reconnect for a network error before the first frame', async () => {
    const h = make();
    await h.rec.onMediaError(lost);
    expect(replanCalls(h).map(([op]) => op)).toEqual(['failure_recovery']);
    expect(h.deps.sendPausedProgress).not.toHaveBeenCalled();
  });

  it('does not use the reconnect when the watchdog named the classification', async () => {
    const h = make({ hasPlayed: vi.fn(() => true) });
    await h.rec.onMediaError(lost, 'transport_stall');
    expect(replanCalls(h).map(([op]) => op)).toEqual(['failure_recovery']);
  });

  it('does not use the reconnect for another error after the first frame', async () => {
    const h = make({ hasPlayed: vi.fn(() => true) });
    await h.rec.onMediaError(FAIL);
    expect(replanCalls(h).map(([op]) => op)).toEqual(['failure_recovery']);
  });

  it('sends a paused progress first, then retries the track change after one second', async () => {
    const h = lostConnection({ replan: result('applied') });
    const run = h.rec.onMediaError(lost);
    expect(h.deps.sendPausedProgress).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.deps.replan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(replanCalls(h)).toEqual([
      [
        'track_change',
        { position: 42, tracks: PLAN.selected_tracks, forceReload: true, autoplay: true },
      ],
    ]);
    expect(h.rec.active).toBe(false);
  });

  it('keeps a paused viewer paused after the reload', async () => {
    const h = lostConnection({ replan: result('applied'), viewerPaused: vi.fn(() => true) });
    const run = h.rec.onMediaError(lost);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(replanCalls(h)[0]![1].autoplay).toBe(false);
  });

  it('uses the start position when the player reported none', async () => {
    const h = lostConnection({ replan: result('applied'), reading: vi.fn(() => null) });
    const run = h.rec.onMediaError(lost);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(replanCalls(h)[0]![1].position).toBe(11);
  });

  it('keeps the position seen when the reconnect began, and zero', async () => {
    const h = lostConnection({
      replan: result('applied'),
      reading: vi.fn(() => ({ position: 0, paused: false })),
    });
    const run = h.rec.onMediaError(lost);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(replanCalls(h)[0]![1].position).toBe(0);
  });

  it('does nothing without a plan', async () => {
    const h = lostConnection({ plan: vi.fn(() => null) });
    await h.rec.onMediaError(lost);
    expect(h.deps.sendPausedProgress).not.toHaveBeenCalled();
    expect(h.deps.replan).not.toHaveBeenCalled();
    expect(h.rec.active).toBe(false);
  });

  it('retries after 1, 2, 4, 8 and then every 15 seconds, and gives up after the budget', async () => {
    const h = lostConnection();
    const run = h.rec.onMediaError(lost);
    const attempts: number[] = [];
    const start = Date.now();
    h.deps.replan.mockImplementation(async () => {
      attempts.push(Date.now() - start);
      return { kind: 'transient' };
    });
    await vi.advanceTimersByTimeAsync(RECONNECT_BUDGET_MS);
    await run;
    expect(attempts).toEqual([
      1_000, 3_000, 7_000, 15_000, 30_000, 45_000, 60_000, 75_000, 90_000, 105_000, 120_000,
    ]);
    expect(h.deps.fail).toHaveBeenCalledTimes(1);
    expect(h.deps.fail).toHaveBeenCalledWith('failed');
    expect(h.rec.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails right at the budget, not before', async () => {
    const h = lostConnection();
    const run = h.rec.onMediaError(lost);
    await vi.advanceTimersByTimeAsync(RECONNECT_BUDGET_MS - 1);
    expect(h.deps.fail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(h.deps.fail).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the session stopped while waiting', async () => {
    const h = lostConnection();
    const run = h.rec.onMediaError(lost);
    h.deps.isStopped.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(h.deps.replan).not.toHaveBeenCalled();
    expect(h.deps.fail).not.toHaveBeenCalled();
    expect(h.rec.active).toBe(false);
  });

  it('drops the answer when the session stopped during the replan', async () => {
    const h = lostConnection();
    h.deps.replan.mockImplementation(async () => {
      h.deps.isStopped.mockReturnValue(true);
      return { kind: 'terminal', message: 'late' };
    });
    const run = h.rec.onMediaError(lost);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(h.deps.fail).not.toHaveBeenCalled();
    expect(h.deps.sessionGone).not.toHaveBeenCalled();
    expect(h.deps.start).not.toHaveBeenCalled();
  });

  it('a busy answer ends the reconnect quietly', async () => {
    const h = lostConnection({ replan: result('busy') });
    const run = h.rec.onMediaError(lost);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(h.deps.replan).toHaveBeenCalledTimes(1);
    expect(h.deps.fail).not.toHaveBeenCalled();
    expect(h.deps.start).not.toHaveBeenCalled();
    expect(h.rec.active).toBe(false);
  });

  it('shows a terminal answer', async () => {
    const h = lostConnection({ replan: result('terminal', { message: 'm', reason: 'r' }) });
    const run = h.rec.onMediaError(lost);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(h.deps.fail).toHaveBeenCalledWith('terminal', 'm', 'r');
    expect(h.deps.start).not.toHaveBeenCalled();
    expect(h.rec.active).toBe(false);
  });

  it('reports an ended session as gone', async () => {
    const h = lostConnection({ replan: result('ended') });
    const run = h.rec.onMediaError(lost);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(h.deps.sessionGone).toHaveBeenCalledTimes(1);
    expect(h.deps.start).not.toHaveBeenCalled();
    expect(h.deps.fail).not.toHaveBeenCalled();
  });

  it.each([['gone'], ['refused'], ['loop']] as const)(
    'restarts at the saved position when the answer is %s',
    async (kind) => {
      const h = lostConnection({ replan: result(kind) });
      const run = h.rec.onMediaError(lost);
      await vi.advanceTimersByTimeAsync(1_000);
      await run;
      expect(h.deps.prepareRestart).toHaveBeenCalledTimes(1);
      expect(h.deps.start).toHaveBeenCalledWith(42);
      expect(h.deps.fail).not.toHaveBeenCalled();
      expect(h.rec.active).toBe(false);
    },
  );

  it('a restart after a reconnect is a restart like any other and counts against the limit', async () => {
    const h = lostConnection({ replan: result('gone') });
    for (let load = 1; load <= 4; load++) {
      h.deps.loadId.mockReturnValue(load);
      const run = h.rec.onMediaError(lost);
      await vi.advanceTimersByTimeAsync(1_000);
      await run;
    }
    expect(h.deps.start).toHaveBeenCalledTimes(3);
    expect(h.deps.sessionGone).toHaveBeenCalledTimes(1);
  });

  it('cancelWait ends the wait at once and leaves no timer behind', async () => {
    const h = lostConnection();
    const run = h.rec.onMediaError(lost);
    expect(vi.getTimerCount()).toBe(1);
    h.deps.isStopped.mockReturnValue(true);
    h.rec.cancelWait();
    await run;
    expect(vi.getTimerCount()).toBe(0);
    expect(h.deps.replan).not.toHaveBeenCalled();
  });

  it('cancelWait without a wait, or twice, does nothing', () => {
    const h = make();
    expect(() => {
      h.rec.cancelWait();
      h.rec.cancelWait();
    }).not.toThrow();
  });
});

describe('Recovery restartAt', () => {
  it('prepares, then starts at the position', async () => {
    const h = make();
    await h.rec.restartAt(7);
    expect(h.deps.prepareRestart).toHaveBeenCalledTimes(1);
    expect(h.deps.start).toHaveBeenCalledWith(7);
    expect(h.deps.prepareRestart.mock.invocationCallOrder[0]).toBeLessThan(
      h.deps.start.mock.invocationCallOrder[0]!,
    );
    expect(h.deps.sessionGone).not.toHaveBeenCalled();
  });

  it('does nothing once the session is stopped', async () => {
    const h = make({ isStopped: vi.fn(() => true) });
    await h.rec.restartAt(7);
    expect(h.deps.prepareRestart).not.toHaveBeenCalled();
    expect(h.deps.start).not.toHaveBeenCalled();
    expect(h.deps.sessionGone).not.toHaveBeenCalled();
  });

  it('allows three restarts, then calls the session gone', async () => {
    const h = make();
    await h.rec.restartAt(1);
    await h.rec.restartAt(2);
    await h.rec.restartAt(3);
    expect(h.deps.start).toHaveBeenCalledTimes(3);
    expect(h.deps.sessionGone).not.toHaveBeenCalled();
    await h.rec.restartAt(4);
    expect(h.deps.start).toHaveBeenCalledTimes(3);
    expect(h.deps.prepareRestart).toHaveBeenCalledTimes(3);
    expect(h.deps.sessionGone).toHaveBeenCalledTimes(1);
  });

  it('ignores a second restart while one runs', async () => {
    let release = () => {};
    const h = make({ start: vi.fn(() => new Promise<void>((r) => (release = r))) });
    const first = h.rec.restartAt(1);
    await h.rec.restartAt(2);
    expect(h.deps.prepareRestart).toHaveBeenCalledTimes(1);
    expect(h.deps.start).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('is not stuck after a start that threw', async () => {
    const h = make();
    h.deps.start.mockRejectedValueOnce(new Error('boom'));
    await expect(h.rec.restartAt(1)).rejects.toThrow('boom');
    expect(h.rec.active).toBe(false);
    await h.rec.restartAt(2);
    expect(h.deps.start).toHaveBeenLastCalledWith(2);
  });
});

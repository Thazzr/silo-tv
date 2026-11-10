// A quality change that does not play goes back to the quality before it: the controller's side,
// on a stub client under fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../api/client';
import type { components } from '../api/generated/schema';
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
import type { StartIntent } from './resume';
import { stopTiming } from './stopTiming';
import {
  METADATA_TIMEOUT_MS,
  PlaybackController,
  clearInstallationCache,
  type SessionState,
} from './usePlaybackSession';

type S = components['schemas'];
type Json = Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  stopTiming.delayMs = 0;
  clearInstallationCache();
});
afterEach(() => {
  vi.useRealTimers();
  stopTiming.delayMs = undefined;
  stopTiming.waiting = 0;
});

const ok = (status = 200) => new Response(null, { status });

/** A plan on a stream of its own, so adopting it loads the video again. */
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
  });

/** What a replan answers: a plan, or a refusal (400) when the entry is `'refused'`. */
type Answer = S['PlaybackDecision'] | 'refused' | (() => Promise<S['PlaybackDecision']>);

function setup(answers: Answer[], intent?: StartIntent) {
  const replans: Json[] = [];
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
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
        return { data: playableDecision(planOnStream(1), SESSION_ID), response: ok(201) };
      }
      if (path.endsWith('/replan')) {
        replans.push(init.body);
        const answer = answers[Math.min(replans.length - 1, answers.length - 1)]!;
        if (typeof answer === 'function') return { data: await answer(), response: ok() };
        return answer === 'refused'
          ? {
              error: { type: 'about:blank', title: 'Bad Request', status: 400, code: 'x' },
              response: ok(400),
            }
          : { data: answer, response: ok() };
      }
      return { response: ok() };
    }),
    DELETE: vi.fn(() => Promise.resolve({ response: ok(204) })),
  };
  const states: SessionState[] = [];
  const controller = new PlaybackController({
    client: client as unknown as SiloClient,
    baseUrl: BASE_URL,
    session,
    contentId: 'm1',
    intent,
    onState: (state) => states.push(state),
    onMediaError: () => undefined,
    onEnded: () => undefined,
  });
  const ready = () => {
    const last = states.filter((state) => state.kind === 'ready').at(-1);
    if (last?.kind !== 'ready') throw new Error('not ready');
    return last;
  };
  return { controller, replans, states, ready };
}

/** Playing at 77 s on the first stream, then a pick of 480p that is applied: its load starts. */
async function pickedQuality(answers: Answer[], intent?: StartIntent, pick = '480p') {
  const ctx = setup(answers, intent);
  await ctx.controller.begin();
  const first = new FakeEngine();
  ctx.controller.attachEngine(first);
  first.currentTime = 77;
  first.paused = false;
  ctx.controller.onPlaying();
  expect(await ctx.controller.qualityChange(pick)).toEqual({ kind: 'applied' });
  // The new load mounts its own element.
  ctx.controller.attachEngine(null);
  const second = new FakeEngine();
  ctx.controller.attachEngine(second);
  return { ...ctx, second };
}

const failure = { code: 4, message: 'unsupported' };
const operations = (replans: Json[]) => replans.map((body) => body.operation);

describe('a quality load that fails before its first frame', () => {
  it('goes back to the previous quality at the start position after a media error', async () => {
    const { controller, replans, ready } = await pickedQuality([
      playableDecision(planOnStream(2)),
      playableDecision(planOnStream(3)),
    ]);
    expect(ready().quality).toBe('480p');
    await controller.onMediaError(failure);
    expect(operations(replans)).toEqual(['quality_change', 'quality_change']);
    expect(replans[1]).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
      position_seconds: 77,
    });
    expect(replans[1]).not.toHaveProperty('failure');
    expect(ready().quality).toBe('auto');
    expect(ready().qualityFallbacks).toBe(1);
    expect(ready().loadId).toBe(3);
  });

  it('does the same when the watchdog fires after 20 s', async () => {
    const { replans, ready } = await pickedQuality([
      playableDecision(planOnStream(2)),
      playableDecision(planOnStream(3)),
    ]);
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
    expect(operations(replans)).toEqual(['quality_change', 'quality_change']);
    expect(replans[1]).toMatchObject({ quality_preference: 'auto', position_seconds: 77 });
    expect(ready().quality).toBe('auto');
    expect(ready().qualityFallbacks).toBe(1);
  });

  it('recovers normally, with no second fallback, when the fallback load fails too', async () => {
    const { controller, replans, ready } = await pickedQuality([
      playableDecision(planOnStream(2)),
      playableDecision(planOnStream(3)),
      playableDecision(planOnStream(4)),
      playableDecision(planOnStream(5)),
    ]);
    await controller.onMediaError(failure);
    controller.attachEngine(null);
    controller.attachEngine(new FakeEngine());
    await controller.onMediaError(failure);
    expect(operations(replans)).toEqual(['quality_change', 'quality_change', 'failure_recovery']);
    expect(ready().qualityFallbacks).toBe(1);
    // Nothing goes back again: a further failure recovers again.
    controller.attachEngine(null);
    controller.attachEngine(new FakeEngine());
    await controller.onMediaError(failure);
    expect(operations(replans)).toEqual([
      'quality_change',
      'quality_change',
      'failure_recovery',
      'failure_recovery',
    ]);
  });

  it('takes the failure path when the fallback replan is refused', async () => {
    const { controller, replans, ready } = await pickedQuality([
      playableDecision(planOnStream(2)),
      'refused',
      playableDecision(planOnStream(4)),
    ]);
    await controller.onMediaError(failure);
    expect(operations(replans)).toEqual(['quality_change', 'quality_change', 'failure_recovery']);
    expect(ready().qualityFallbacks).toBe(0);
  });
});

describe('a quality load that failed after its first frame', () => {
  it('takes the normal failure path, with no fallback', async () => {
    const { controller, second, replans, ready } = await pickedQuality([
      playableDecision(planOnStream(2)),
      playableDecision(planOnStream(3)),
    ]);
    second.currentTime = 10;
    second.paused = false;
    controller.onPlaying();
    await controller.onMediaError(failure);
    expect(operations(replans)).toEqual(['quality_change', 'failure_recovery']);
    expect(ready().qualityFallbacks).toBe(0);
    expect(ready().quality).toBe('480p');
  });
});

describe('what the fallback restores and when it does not run', () => {
  it('restores the exact previous preference, not just auto', async () => {
    const { controller, replans, ready } = await pickedQuality(
      [playableDecision(planOnStream(2)), playableDecision(planOnStream(3))],
      { kind: 'beginning', quality: '1080p' },
      '720p-high',
    );
    expect(ready().quality).toBe('720p-high');
    await controller.onMediaError(failure);
    expect(replans[0]).toMatchObject({ quality_preference: '720p-high' });
    expect(replans[1]).toMatchObject({ operation: 'quality_change', quality_preference: '1080p' });
    expect(ready().quality).toBe('1080p');
  });

  it('starts no quality load for a pick whose plan stays on the same stream', async () => {
    const ctx = setup([
      // The same URL as the first plan: the video does not load again.
      { ...playableDecision({ ...planOnStream(1), plan_attempt_key: 'v3:key-9' }) },
      playableDecision(planOnStream(4)),
    ]);
    await ctx.controller.begin();
    const engine = new FakeEngine();
    ctx.controller.attachEngine(engine);
    expect(await ctx.controller.qualityChange('480p')).toEqual({ kind: 'applied' });
    expect(ctx.ready().loadId).toBe(1);
    expect(ctx.ready().quality).toBe('480p');
    // Nothing has played yet, so only the quality load rule could send this back.
    await ctx.controller.onMediaError(failure);
    expect(operations(ctx.replans)).toEqual(['quality_change', 'failure_recovery']);
    expect(ctx.ready().qualityFallbacks).toBe(0);
  });

  it('gives a quality load one fallback: a repeated report of the failure sends nothing more', async () => {
    // Clearing the remembered load on use is redundant with the load id check (the fallback
    // brings a new load, and the same load's second report is dropped), so this pins the outcome.
    const { controller, replans } = await pickedQuality([
      playableDecision(planOnStream(2)),
      playableDecision(planOnStream(3)),
      playableDecision(planOnStream(4)),
    ]);
    await Promise.all([controller.onMediaError(failure), controller.onMediaError(failure)]);
    expect(operations(replans)).toEqual(['quality_change', 'quality_change']);
  });

  it('starts no fallback after stop()', async () => {
    const { controller, replans } = await pickedQuality([
      playableDecision(planOnStream(2)),
      playableDecision(planOnStream(3)),
    ]);
    const stopped = controller.stop();
    await vi.advanceTimersByTimeAsync(10);
    await stopped;
    await controller.onMediaError(failure);
    expect(operations(replans)).toEqual(['quality_change']);
  });

  it('stops cleanly when the session ends while the fallback is in flight', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { controller, replans, states } = await pickedQuality([
      playableDecision(planOnStream(2)),
      async () => {
        await held;
        return playableDecision(planOnStream(3));
      },
      playableDecision(planOnStream(4)),
    ]);
    const failing = controller.onMediaError(failure);
    await vi.advanceTimersByTimeAsync(0);
    expect(operations(replans)).toEqual(['quality_change', 'quality_change']);
    void controller.stop();
    release?.();
    await failing;
    // No failure recovery after the stop, and no error screen.
    expect(operations(replans)).toEqual(['quality_change', 'quality_change']);
    expect(states.some((state) => state.kind === 'error')).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
  });

  it('loads the fallback again even when its stream URL is the failed one', async () => {
    const { controller, ready } = await pickedQuality([
      playableDecision(planOnStream(2)),
      // The same URL as the failed load, another plan key.
      playableDecision({ ...planOnStream(2), plan_attempt_key: 'v3:key-9' }),
    ]);
    expect(ready().loadId).toBe(2);
    await controller.onMediaError(failure);
    expect(ready().loadId).toBe(3);
    expect(ready().qualityFallbacks).toBe(1);
  });
});

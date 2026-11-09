// The controller's seek, replan, reconnect, restart, background, end and stop behaviour, driven
// through a FakeEngine. The request/response side runs against MSW; the reconnect schedule runs
// against a stub client so fake timers cannot starve the network mock.
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSiloClient, type SiloClient } from '../api/client';
import type { components } from '../api/generated/schema';
import { Session } from '../api/session';
import { currentTransport } from '../api/transport';
import { BASE_URL, account } from '../test/apiFixtures';
import { FakeEngine } from '../test/fakeEngine';
import {
  ACCESS_TOKEN,
  LOWER_UUID,
  SESSION_ID,
  playableDecision,
  playbackCapabilities,
  playbackPlan,
  servePlayback,
  until,
  watchDetail,
  watchUserData,
  type PlaybackServerOptions,
} from '../test/playbackFixtures';
import { memoryStorage, testDevice } from '../test/renderFlow';
import type { StartIntent } from './resume';
import {
  MAX_ATTEMPTED_KEYS,
  MAX_RECOVERIES,
  PROGRESS_INTERVAL_MS,
  PlaybackController,
  clearInstallationCache,
  type SessionState,
} from './usePlaybackSession';

type S = components['schemas'];
type Json = Record<string, unknown>;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
const controllers: PlaybackController[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const controller of controllers.splice(0)) controller.dispose();
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.resetHandlers();
});
afterAll(() => server.close());
beforeEach(() => {
  window.localStorage.clear();
  clearInstallationCache();
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

function build(client: SiloClient, session: Session, intent?: StartIntent) {
  const states: SessionState[] = [];
  const onEnded = vi.fn();
  const controller = new PlaybackController({
    client,
    baseUrl: BASE_URL,
    session,
    contentId: 'm1',
    intent,
    onState: (state) => states.push(state),
    onMediaError: () => undefined,
    onEnded,
  });
  controllers.push(controller);
  const engine = new FakeEngine();
  const ready = () => {
    const state = states.at(-1);
    if (state?.kind !== 'ready') throw new Error(`not ready: ${state?.kind}`);
    return state;
  };
  return { controller, engine, states, onEnded, ready };
}

function make(options: { intent?: StartIntent; serve?: PlaybackServerOptions } = {}) {
  const calls = servePlayback(server, options.serve);
  const session = signedIn();
  const client = createSiloClient({
    baseUrl: BASE_URL,
    transport: currentTransport,
    session,
    device: testDevice,
  });
  return { calls, ...build(client, session, options.intent) };
}

/** Started, attached to the fake engine and playing. */
async function playing(options: Parameters<typeof make>[0] = {}) {
  const ctx = make(options);
  await ctx.controller.begin();
  ctx.controller.attachEngine(ctx.engine);
  ctx.engine.paused = false;
  ctx.controller.onPlaying();
  return ctx;
}

function timeline(overrides: Partial<S['TimelineV3']> = {}): S['TimelineV3'] {
  return { ...playbackPlan().timeline, ...overrides };
}

const stuckTimeline = timeline({
  can_seek_anywhere: false,
  seek_restoration: 'source_position',
});

const RECONNECT_TOTAL = 120_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('seekTo', () => {
  it('seeks the engine by itself where the plan can seek anywhere, on the container timeline', async () => {
    const { controller, engine, calls } = await playing({
      serve: {
        start: [
          playableDecision(playbackPlan({ timeline: timeline({ timeline_offset_seconds: 600 }) })),
        ],
      },
    });
    // Matroska in Chromium starts at its first timestamp.
    engine.currentTime = 7;
    controller.onLoadedMetadata();
    await controller.seekTo(650);
    expect(engine.seeks.at(-1)).toBe(57);
    // Before the start: the container origin. After the end: the engine's duration.
    await controller.seekTo(0);
    expect(engine.seeks.at(-1)).toBe(7);
    engine.duration = 100;
    await controller.seekTo(10_000);
    expect(engine.seeks.at(-1)).toBe(100);
    expect(calls.replan).toHaveLength(0);
  });

  it('seeks by itself to a target inside the seekable range, without the server', async () => {
    const { controller, engine, calls } = await playing({
      serve: { start: [playableDecision(playbackPlan({ timeline: stuckTimeline }))] },
    });
    engine.seekable = [{ start: 0, end: 30 }];
    await controller.seekTo(20);
    expect(engine.seeks).toEqual([20]);
    expect(calls.replan).toHaveLength(0);
  });

  it('sends a seek_reanchor outside the seekable range and loads the new plan at the position', async () => {
    const moved = playbackPlan({
      plan_id: 'plan:2',
      plan_attempt_key: 'v3:key-2',
      delivery: 'server_remux_hls',
      stream: {
        header_refresh: 'none',
        headers: {},
        protocol: 'hls',
        url: `/api/v2/playback/transcode/${SESSION_ID}/master.m3u8`,
      },
      timeline: timeline({
        can_seek_anywhere: false,
        seek_restoration: 'source_position',
        source_start_seconds: 900,
        stream_origin_seconds: 900,
        timeline_offset_seconds: 900,
      }),
    });
    const { controller, engine, calls, ready } = await playing({
      serve: {
        start: [playableDecision(playbackPlan({ timeline: stuckTimeline }))],
        replan: [playableDecision(moved)],
      },
    });
    engine.seekable = [{ start: 0, end: 30 }];
    const before = ready().loadId;
    await controller.seekTo(900);

    expect(engine.seeks).toEqual([]);
    expect(calls.replan).toHaveLength(1);
    const { body } = calls.replan[0]!;
    expect(body).toMatchObject({
      operation: 'seek_reanchor',
      position_seconds: 900,
      failed_plan_id: 'plan:1',
      attempted_plan_keys: ['v3:key-1'],
      quality_preference: 'auto',
    });
    expect(body).not.toHaveProperty('failure');
    expect(body.replan_request_id).toMatch(LOWER_UUID);
    const state = ready();
    expect(state.plan.plan_id).toBe('plan:2');
    // A new stream URL and timeline: the video loads again, and the offset applies to readings.
    expect(state.loadId).toBe(before + 1);
    engine.currentTime = 20;
    controller.onPlaying();
    expect(controller.reading()?.position).toBe(920);
  });

  it('keeps a reanchor inside the source: not before 0, not past the runtime', async () => {
    const stuck = (extra: Partial<S['PlaybackPlan']> = {}) =>
      playbackPlan({ timeline: stuckTimeline, ...extra });
    const { controller, engine, calls } = await playing({
      serve: {
        start: [playableDecision(stuck())],
        replan: [playableDecision(stuck({ plan_id: 'plan:2', plan_attempt_key: 'v3:key-2' }))],
      },
    });
    engine.seekable = [];
    await controller.seekTo(-5);
    await controller.seekTo(99_999);
    expect(calls.replan.map((c) => c.body.position_seconds)).toEqual([0, 5400]);
  });
});

describe('replan', () => {
  const FAILURE = { classification: 'decoder_failure', message: 'decode' };
  const keys = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      playableDecision(
        playbackPlan({ plan_id: `plan:${i + 2}`, plan_attempt_key: `v3:key-${i + 2}` }),
      ),
    );

  it.each([
    ['failure_recovery', true],
    ['seek_failure_recovery', true],
    ['seek_reanchor', false],
    ['track_change', false],
    ['quality_change', false],
    ['output_change', false],
  ] as const)('%s sends its operation with a fresh request id', async (operation, failure) => {
    const { controller, calls } = await playing();
    await controller.replan(operation, {
      ...(failure ? { failure: FAILURE } : {}),
      ...(operation === 'quality_change' ? { quality: '720p' } : {}),
    });
    expect(calls.replan).toHaveLength(1);
    const { body } = calls.replan[0]!;
    expect(body).toMatchObject({ operation, protocol_version: 3, attempt_count: 1 });
    expect(body.replan_request_id).toMatch(LOWER_UUID);
    if (failure) expect(body.failure).toEqual(FAILURE);
    else expect(body).not.toHaveProperty('failure');
    expect(body.quality_preference).toBe(operation === 'quality_change' ? '720p' : 'auto');
    await controller.replan('track_change');
    expect(calls.replan[1]?.body.replan_request_id).not.toBe(body.replan_request_id);
  });

  it('counts failure recoveries as attempt_count and stops after 8 without asking again', async () => {
    const { controller, calls } = await playing({ serve: { replan: keys(12) } });
    for (let i = 0; i < MAX_RECOVERIES; i += 1) {
      expect(await controller.replan('failure_recovery', { failure: FAILURE })).toEqual({
        kind: 'applied',
      });
    }
    expect(calls.replan.map((c) => c.body.attempt_count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(calls.replan[7]?.body.attempted_plan_keys).toHaveLength(8);
    expect(await controller.replan('failure_recovery', { failure: FAILURE })).toEqual({
      kind: 'loop',
    });
    expect(calls.replan).toHaveLength(8);
  });

  it('remembers only the last 16 attempted plan keys', async () => {
    const { controller, calls } = await playing({ serve: { replan: keys(20) } });
    for (let i = 0; i < 19; i += 1) await controller.replan('track_change');
    const sent = calls.replan.at(-1)?.body.attempted_plan_keys as string[];
    expect(sent).toHaveLength(MAX_ATTEMPTED_KEYS);
    // The newest keys stay, the oldest fall away.
    expect(sent.at(-1)).toBe('v3:key-19');
    expect(sent).not.toContain('v3:key-1');
  });

  it('treats a plan already tried as a loop after a failure, but not after a track or quality change', async () => {
    // The default answer is plan:2 with key-2 every time.
    const { controller } = await playing();
    expect(await controller.trackChange({ audio: { id: 'file:1:audio:1', index: 1 } })).toEqual({
      kind: 'applied',
    });
    expect(await controller.qualityChange('720p')).toEqual({ kind: 'applied' });
    expect(await controller.replan('failure_recovery', { failure: FAILURE })).toEqual({
      kind: 'loop',
    });
  });

  it('trackChange sends exactly the picked tracks; qualityChange keeps its label for later replans', async () => {
    const { controller, calls } = await playing();
    await controller.trackChange({ audio: { id: 'file:1:audio:1', index: 1 } });
    expect(calls.replan[0]?.body.selected_tracks).toEqual({
      audio: { id: 'file:1:audio:1', index: 1 },
    });
    expect(calls.replan[0]?.body.operation).toBe('track_change');
    await controller.qualityChange('720p');
    expect(calls.replan[1]?.body).toMatchObject({
      operation: 'quality_change',
      quality_preference: '720p',
    });
    await controller.trackChange({ audio: { id: 'file:1:audio:0', index: 0 } });
    expect(calls.replan[2]?.body.quality_preference).toBe('720p');
  });

  it('keeps the video loaded when the new plan is on the same stream, and reloads for another URL', async () => {
    const other = playableDecision(
      playbackPlan({
        plan_id: 'plan:3',
        plan_attempt_key: 'v3:key-3',
        stream: {
          header_refresh: 'none',
          headers: {},
          protocol: 'hls',
          url: `/api/v2/playback/transcode/${SESSION_ID}/master.m3u8`,
        },
      }),
    );
    const same = playableDecision(
      playbackPlan({ plan_id: 'plan:2', plan_attempt_key: 'v3:key-2' }),
    );
    const { controller, ready, states } = await playing({ serve: { replan: [same, other] } });
    const first = ready().loadId;
    await controller.trackChange({ audio: { id: 'file:1:audio:1', index: 1 } });
    expect(ready().plan.plan_id).toBe('plan:2');
    expect(ready().loadId).toBe(first);
    const count = states.length;
    await controller.qualityChange('480p');
    expect(ready().plan.plan_id).toBe('plan:3');
    expect(ready().loadId).toBe(first + 1);
    expect(states.length).toBeGreaterThan(count);
  });

  it('reloads after a failure recovery even when the stream URL is unchanged', async () => {
    const { controller, ready } = await playing();
    const first = ready().loadId;
    await controller.replan('failure_recovery', { failure: FAILURE });
    expect(ready().loadId).toBe(first + 1);
  });

  it('shows a terminal answer to a seek, track or quality change as the error screen', async () => {
    const { controller, states } = await playing({
      serve: {
        replan: [
          {
            outcome: 'adaptation_unavailable',
            protocol_version: 3,
            server_features: [],
            terminal: {
              message: 'No audio route.',
              reason: 'adaptation_exhausted',
              retryable: false,
            },
          },
        ],
      },
    });
    await controller.trackChange({ audio: { id: 'x', index: 9 } });
    expect(states.at(-1)).toMatchObject({
      kind: 'error',
      reason: 'terminal',
      message: 'No audio route.',
    });
  });
});

describe('progress answers', () => {
  const gone = (status: number, code: string) =>
    http.post(`${BASE_URL}/api/v2/playback/:sessionId/progress`, () =>
      HttpResponse.json({ type: `x/${code}`, title: code, status }, { status }),
    );

  it('starts a new attempt at the last position on a 404, with the tracks that were playing', async () => {
    const second = playableDecision(
      playbackPlan({ plan_id: 'plan:9', session_id: 'session-2' }),
      'session-2',
    );
    const { controller, engine, calls, states, ready } = await playing({
      serve: { start: [playableDecision(), second] },
    });
    server.use(gone(404, 'playback_session_not_found'));
    engine.currentTime = 80;
    controller.onPause();
    await until(() => calls.start.length === 2);
    await until(() => states.at(-1)?.kind === 'ready' && ready().sessionId === 'session-2');

    expect(states.some((s) => s.kind === 'error')).toBe(false);
    expect(calls.start[1]?.body).toMatchObject({
      start_position: 80,
      audio_track_id: 'file:1:audio:0',
      audio_track_index: 0,
    });
    expect(calls.start[1]?.body.playback_attempt_id).not.toBe(
      calls.start[0]?.body.playback_attempt_id,
    );
    // The old session is gone on the server: it gets no stop, and the new one counts from 1.
    expect(calls.stop).toHaveLength(0);
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/progress`, async ({ request, params }) => {
        calls.progress.push({
          sessionId: String(params.sessionId),
          body: (await request.json()) as Json,
        });
        return HttpResponse.json({ outcome: 'applied' });
      }),
    );
    controller.onPlaying();
    engine.currentTime = 90;
    controller.onPause();
    await until(() => calls.progress.some((c) => c.sessionId === 'session-2'));
    expect(calls.progress.find((c) => c.sessionId === 'session-2')?.body).toMatchObject({
      sequence: 1,
      position: 90,
    });
  });

  it('gives up with the error screen when the server keeps dropping the new session', async () => {
    const { controller, engine, calls, states } = await playing();
    server.use(gone(404, 'playback_session_not_found'));
    for (let round = 0; round < 3; round += 1) {
      controller.onPlaying();
      controller.onPause();
      await until(() => calls.start.length === round + 2 && states.at(-1)?.kind === 'ready');
      engine.currentTime += 1;
    }
    controller.onPlaying();
    controller.onPause();
    await until(() => states.at(-1)?.kind === 'error');
    expect(states.at(-1)).toMatchObject({ kind: 'error', reason: 'sessionEnded' });
    expect(calls.start).toHaveLength(4);
  });

  it('does not restart for a 404 that only says the profile is wrong', async () => {
    const { controller, calls, states } = await playing();
    server.use(gone(404, 'not_found'));
    controller.onPause();
    await sleep(80);
    expect(calls.start).toHaveLength(1);
    expect(states.at(-1)?.kind).toBe('ready');
  });

  it('ends the session on a 410, with no new attempt', async () => {
    const { controller, calls, states } = await playing();
    server.use(gone(410, 'playback_session_ended'));
    controller.onPause();
    await until(() => states.at(-1)?.kind === 'error');
    expect(states.at(-1)).toMatchObject({ kind: 'error', reason: 'sessionEnded' });
    expect(calls.start).toHaveLength(1);
  });

  it('takes a stale_sample or replayed answer as harmless', async () => {
    const { controller, calls, states } = await playing();
    for (const outcome of ['stale_sample', 'replayed']) {
      server.use(
        http.post(`${BASE_URL}/api/v2/playback/:sessionId/progress`, () =>
          HttpResponse.json({ outcome }),
        ),
      );
      controller.onPlaying();
      controller.onPause();
      await sleep(40);
    }
    expect(calls.start).toHaveLength(1);
    expect(states.at(-1)?.kind).toBe('ready');
  });
});

describe('background', () => {
  let visibility: 'visible' | 'hidden' = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  const change = (state: 'visible' | 'hidden') => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => {
    visibility = 'visible';
  });

  it('pauses and reports the position at once when the document becomes hidden', async () => {
    const { controller, engine, calls } = await playing();
    engine.currentTime = 33;
    change('hidden');
    expect(engine.pause).toHaveBeenCalledTimes(1);
    await until(() => calls.progress.length === 1);
    expect(calls.progress[0]?.body).toMatchObject({ position: 33, is_paused: true });
    // The element's own pause event follows: still one report.
    controller.onPause();
    await sleep(40);
    expect(calls.progress).toHaveLength(1);
  });

  it('leaves a document that becomes visible, or a player that is already paused, alone', async () => {
    const { engine, calls } = await playing();
    change('visible');
    expect(engine.pause).not.toHaveBeenCalled();
    engine.paused = true;
    change('hidden');
    expect(engine.pause).not.toHaveBeenCalled();
    await sleep(40);
    expect(calls.progress).toHaveLength(0);
  });

  it('stops listening once disposed', async () => {
    const { controller, engine } = await playing();
    controller.dispose();
    change('hidden');
    expect(engine.pause).not.toHaveBeenCalled();
  });
});

describe('end of stream', () => {
  it('stops with the end position, then calls onEnded once', async () => {
    const { controller, engine, calls, onEnded } = await playing();
    engine.currentTime = 5400;
    engine.paused = true;
    engine.ended = true;
    controller.onEnded();
    expect(onEnded).toHaveBeenCalledTimes(1);
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.body).toMatchObject({ position: 5400, is_paused: true });
    // Leaving afterwards sends nothing more.
    controller.onEnded();
    controller.dispose();
    await sleep(40);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(calls.stop).toHaveLength(1);
  });
});

describe('position before the first frame', () => {
  const resumable = watchDetail({ user_data: watchUserData({ position_seconds: 2700 }) });

  async function started(options: Parameters<typeof make>[0]) {
    const ctx = make(options);
    await ctx.controller.begin();
    ctx.controller.attachEngine(ctx.engine);
    // The element sits at its own 0 until a frame plays.
    ctx.engine.currentTime = 0;
    return ctx;
  }

  it('stops with the resume position when leaving before the first frame', async () => {
    const { controller, calls } = await started({
      intent: { kind: 'resume' },
      serve: { watch: resumable },
    });
    await controller.stop();
    expect(calls.start[0]?.body.start_position).toBe(2693);
    expect(calls.stop[0]?.body).toMatchObject({ position: 2693 });
  });

  it('stops with 0 on a start from the beginning', async () => {
    const { controller, calls } = await started({
      intent: { kind: 'beginning' },
      serve: { watch: resumable },
    });
    await controller.stop();
    expect(calls.stop[0]?.body).toMatchObject({ position: 0 });
  });

  it('reports the attempt start after a restart that has no frame yet', async () => {
    const { controller, engine, calls } = await playing();
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/progress`, () =>
        HttpResponse.json({ type: 'x/playback_session_not_found', status: 404 }, { status: 404 }),
      ),
    );
    engine.currentTime = 80;
    controller.onPause();
    await until(() => calls.start.length === 2);
    await sleep(40);
    engine.currentTime = 0;
    await controller.stop();
    expect(calls.stop.at(-1)?.body).toMatchObject({ position: 80 });
  });

  describe('after a reanchor reload that has no frame yet', () => {
    async function reanchored() {
      const moved = playbackPlan({
        plan_id: 'plan:2',
        plan_attempt_key: 'v3:key-2',
        stream: {
          header_refresh: 'none',
          headers: {},
          protocol: 'hls',
          url: `/api/v2/playback/transcode/${SESSION_ID}/master.m3u8`,
        },
        timeline: timeline({
          can_seek_anywhere: false,
          seek_restoration: 'source_position',
          timeline_offset_seconds: 900,
          stream_origin_seconds: 900,
        }),
      });
      const ctx = await playing({
        serve: {
          start: [playableDecision(playbackPlan({ timeline: stuckTimeline }))],
          replan: [playableDecision(moved)],
        },
      });
      ctx.engine.currentTime = 30;
      ctx.engine.seekable = [{ start: 0, end: 30 }];
      await ctx.controller.seekTo(900);
      // The new load has not played yet and the element is back at its own 0.
      ctx.engine.currentTime = 0;
      return ctx;
    }

    it('stops with the position the reanchor asked for', async () => {
      const { controller, calls } = await reanchored();
      await controller.stop();
      expect(calls.stop[0]?.body).toMatchObject({ position: 900 });
    });

    it('reports a pause with that position too', async () => {
      const { controller, calls } = await reanchored();
      controller.onPause();
      await until(() => calls.progress.length === 1);
      expect(calls.progress[0]?.body).toMatchObject({ position: 900, is_paused: true });
    });
  });

  it('uses the real position once the first frame has played', async () => {
    const { controller, engine, calls } = await started({
      intent: { kind: 'resume' },
      serve: { watch: resumable },
    });
    engine.currentTime = 2750;
    controller.onPlaying();
    await controller.stop();
    expect(calls.stop[0]?.body).toMatchObject({ position: 2750 });
  });
});

describe('start request fields', () => {
  it('leaves the file, track and quality choices out when nothing was picked', async () => {
    const { calls } = await playing();
    const body = calls.start[0]!.body;
    for (const key of [
      'allow_alternate_versions',
      'audio_track_id',
      'audio_track_index',
      'subtitle_track_id',
      'subtitle_track_index',
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body.quality_preference).toBe('auto');
  });

  it('carries the picked file, tracks and quality, and pins the file', async () => {
    const { calls } = await playing({
      intent: {
        kind: 'beginning',
        fileId: 'file-b',
        audio: { id: 'file:2:audio:3', index: 3 },
        subtitle: { id: 'file:2:sub:1' },
        quality: '720p',
      },
      serve: {
        watch: watchDetail({
          versions: [
            { ...watchDetail().versions[0]!, file_id: 'file-a' },
            { ...watchDetail().versions[0]!, file_id: 'file-b' },
          ],
          user_data: watchUserData({ last_file_id: 'file-a' }),
        }),
      },
    });
    const body = calls.start[0]!.body;
    expect(body).toMatchObject({
      file_id: 'file-b',
      allow_alternate_versions: false,
      audio_track_id: 'file:2:audio:3',
      audio_track_index: 3,
      subtitle_track_id: 'file:2:sub:1',
      quality_preference: '720p',
    });
    expect(body).not.toHaveProperty('subtitle_track_index');
  });
});

describe('stop retries', () => {
  it('retries a stop that got no answer with the same stop_id and the same final sample', async () => {
    const { controller, engine } = await playing();
    const bodies: Json[] = [];
    server.use(
      http.delete(`${BASE_URL}/api/v2/playback/:sessionId`, async ({ request }) => {
        bodies.push((await request.json()) as Json);
        if (bodies.length === 1) return HttpResponse.error();
        return new HttpResponse(null, { status: bodies.length === 2 ? 503 : 204 });
      }),
    );
    engine.currentTime = 61;
    await controller.stop();
    expect(bodies).toHaveLength(3);
    const ids = new Set(bodies.map((b) => b.stop_id));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(LOWER_UUID);
    // The same final sample each time: one sequence number, not three.
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(bodies[0]).toMatchObject({ position: 61, sequence: 1 });
  }, 10_000);

  it('does not retry a stop the server answered, even with an error', async () => {
    const { controller } = await playing();
    let tries = 0;
    server.use(
      http.delete(`${BASE_URL}/api/v2/playback/:sessionId`, () => {
        tries += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );
    await controller.stop();
    expect(tries).toBe(1);
  });
});

describe('lost connection (reconnect)', () => {
  const NETWORK = { code: 2, message: 'network' };
  const ok = (status = 200) => new Response(null, { status });

  /** A client that answers the calls a controller makes; `replan` decides the replan answers. */
  function stub(replan: (call: number) => Promise<unknown>) {
    const log = { replan: [] as { at: number; body: Json }[], start: [] as Json[], stop: 0 };
    const client = {
      GET: vi.fn((path: string) =>
        Promise.resolve(
          path.includes('capabilities')
            ? { data: playbackCapabilities(), response: ok() }
            : { data: watchDetail(), response: ok() },
        ),
      ),
      POST: vi.fn((path: string, init: { body: Json }) => {
        if (path.endsWith('/start')) {
          log.start.push(init.body);
          const id = log.start.length === 1 ? SESSION_ID : 'session-2';
          return Promise.resolve({
            data: playableDecision(playbackPlan({ session_id: id }), id),
            response: ok(201),
          });
        }
        if (path.endsWith('/replan')) {
          log.replan.push({ at: Date.now(), body: init.body });
          return replan(log.replan.length);
        }
        return Promise.resolve({ response: ok() });
      }),
      DELETE: vi.fn(() => {
        log.stop += 1;
        return Promise.resolve({ response: ok(204) });
      }),
    };
    return { log, post: client.POST, client: client as unknown as SiloClient };
  }

  async function connected(replan: (call: number) => Promise<unknown>) {
    vi.useFakeTimers();
    const { log, post, client } = stub(replan);
    const ctx = build(client, signedIn());
    await ctx.controller.begin();
    ctx.controller.attachEngine(ctx.engine);
    ctx.engine.currentTime = 70;
    ctx.engine.paused = false;
    ctx.controller.onPlaying();
    return { log, post, ...ctx };
  }

  it('retries an unchanged track_change at 1 s doubling to 15 s for about two minutes, then fails', async () => {
    const { log, controller, states } = await connected(() => Promise.reject(new Error('offline')));
    const t0 = Date.now();
    void controller.onMediaError(NETWORK);
    await vi.advanceTimersByTimeAsync(RECONNECT_TOTAL + 60_000);

    expect(log.replan.map((c) => (c.at - t0) / 1000)).toEqual([
      1, 3, 7, 15, 30, 45, 60, 75, 90, 105, 120,
    ]);
    expect(states.at(-1)).toMatchObject({ kind: 'error', reason: 'failed' });
    const first = log.replan[0]!.body;
    for (const { body } of log.replan) {
      // The route did not fail: no failure_recovery, no failure, the same tracks and position.
      expect(body).toMatchObject({
        operation: 'track_change',
        position_seconds: 70,
        selected_tracks: { audio: { id: 'file:1:audio:0', index: 0 } },
      });
      expect(body).not.toHaveProperty('failure');
    }
    expect(new Set(log.replan.map((c) => c.body.replan_request_id)).size).toBe(11);
    expect(first.attempt_count).toBe(1);
  });

  it('loads the plan the first answered retry brings, playing again', async () => {
    const { log, controller, states, ready } = await connected((call) =>
      call < 3
        ? Promise.resolve({ error: {}, response: ok(503) })
        : Promise.resolve({
            data: playableDecision(
              playbackPlan({ plan_id: 'plan:2', plan_attempt_key: 'v3:key-2' }),
            ),
            response: ok(),
          }),
    );
    const before = ready().loadId;
    void controller.onMediaError(NETWORK);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log.replan).toHaveLength(3);
    expect(states.at(-1)).toMatchObject({ kind: 'ready', autoplay: true });
    // The dead transport is replaced even though the URL did not change.
    expect(ready().loadId).toBe(before + 1);
  });

  it('does not start playing again after the reconnect when the viewer had paused', async () => {
    const { controller, engine, states } = await connected(() =>
      Promise.resolve({
        data: playableDecision(playbackPlan({ plan_id: 'plan:2', plan_attempt_key: 'v3:key-2' })),
        response: ok(),
      }),
    );
    engine.paused = true;
    controller.onPause();
    void controller.onMediaError(NETWORK);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(states.at(-1)).toMatchObject({ kind: 'ready', autoplay: false });
  });

  it('starts a new attempt at the saved position when the session did not survive (404)', async () => {
    const { log, controller, states, ready } = await connected(() =>
      Promise.resolve({
        error: { type: 'x/playback_session_not_found', status: 404 },
        response: ok(404),
      }),
    );
    void controller.onMediaError(NETWORK);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(log.replan).toHaveLength(1);
    expect(log.start).toHaveLength(2);
    expect(log.start[1]).toMatchObject({ start_position: 70, audio_track_id: 'file:1:audio:0' });
    expect(states.some((s) => s.kind === 'error')).toBe(false);
    expect(ready().sessionId).toBe('session-2');
  });

  it('stops retrying once the session is stopped', async () => {
    const { log, controller } = await connected(() => Promise.reject(new Error('offline')));
    void controller.onMediaError(NETWORK);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(log.replan).toHaveLength(2);
    void controller.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log.replan).toHaveLength(2);
  });

  it('does not count a network error before the first frame as a lost connection', async () => {
    vi.useFakeTimers();
    const { log, client } = stub(() => Promise.reject(new Error('offline')));
    const ctx = build(client, signedIn());
    await ctx.controller.begin();
    ctx.controller.attachEngine(ctx.engine);
    void ctx.controller.onMediaError(NETWORK);
    await vi.advanceTimersByTimeAsync(0);
    // The ordinary failure path asks at once; the reconnect would have waited 1 s.
    expect(log.replan).toHaveLength(1);
    expect(log.replan[0]?.body.operation).toBe('failure_recovery');
  });

  it('keeps the heartbeat going while reconnecting', async () => {
    const { controller, post } = await connected(() => Promise.reject(new Error('offline')));
    void controller.onMediaError(NETWORK);
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL_MS * 2);
    const progress = (post.mock.calls as unknown as [string, { body: Json }][]).filter(([path]) =>
      path.endsWith('/progress'),
    );
    // One paused report when the connection broke, one per 10 s after.
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress.every(([, init]) => init.body.is_paused === true)).toBe(true);
  });
});

describe('heading', () => {
  it('carries the title and, for an episode, the series and its numbers into the ready state', async () => {
    const { ready } = await playing({
      serve: {
        watch: watchDetail({
          title: 'The Pilot',
          type: 'episode',
          series_title: 'Some Show',
          season_number: 1,
          episode_number: 2,
        }),
      },
    });
    expect(ready().heading).toEqual({
      title: 'The Pilot',
      seriesTitle: 'Some Show',
      seasonNumber: 1,
      episodeNumber: 2,
    });
  });

  it('names only the title for a movie', async () => {
    const { ready } = await playing();
    expect(ready().heading).toEqual({ title: 'First Title' });
  });
});

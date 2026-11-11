// The buffering controller through the playback controller: what a stall sequence does in each
// mode, on Auto and on a quality the viewer picked, and what the start and replan bodies carry.
// A stub client and a fake clock keep it exact; the pure rules have their own tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import { FakeEngine } from '../../test/fakeEngine';
import {
  ACCESS_TOKEN,
  SESSION_ID,
  playableDecision,
  terminalDecision,
  playbackCapabilities,
  playbackPlan,
  watchDetail,
} from '../../test/playbackFixtures';
import { memoryStorage } from '../../test/renderFlow';
import type { StartIntent } from '../resume';
import {
  LONG_STALL_MS,
  NO_LOWER_COOLDOWN_MS,
  REARM_AFTER_UNADOPTED_MS,
  REOFFER_MIN_MS,
  STARTUP_GRACE_MS,
  type BufferingMode,
} from './bufferingQuality';
import type { BufferingView } from './BufferingManager';
import type { SessionState } from './types';
import { PlaybackController } from './PlaybackController';
import { clearInstallationCache } from './startSession';

type S = components['schemas'];
type Json = Record<string, unknown>;

const RUNGS: S['AvailableQualityV3'][] = [
  { label: '1080p', preserves_source: false, bitrate_kbps: 8000 },
  { label: '720p', preserves_source: false, bitrate_kbps: 4000 },
  { label: '480p', preserves_source: false, bitrate_kbps: 1500 },
];

/** A plan on its own stream (a new plan is a new load); `kbps` is the delivered bitrate. */
function plan(n: number, kbps?: number, extra: Partial<S['PlaybackPlan']> = {}) {
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
    ...extra,
  });
}

const ok = (status = 200) => new Response(null, { status });

interface Options {
  mode?: BufferingMode;
  /** The server's settings know the key (the buffering request fields are allowed). */
  feature?: boolean;
  intent?: StartIntent;
  /** The plan the start answers with; default 10 Mbit/s on Auto. */
  start?: S['PlaybackPlan'];
  /** The plans the replans answer with, in order; the last one repeats. */
  replans?: S['PlaybackPlan'][];
  /** The replan answers with this status instead. */
  replanFails?: number;
  /** The profile's bitrate cap in kbit/s. */
  cap?: number | null;
  /** The engine reports media data every second (default); false: no `data` events at all. */
  data?: boolean;
  /** Replans (1-based call number) the server answers with a session that is gone, ended or terminal. */
  replanKinds?: Record<number, 'gone' | 'ended' | 'terminal' | 'refused' | 'transient'>;
  /** The controller is built without the buffering dependency (its defaults apply). */
  noBufferingDep?: boolean;
}

async function setup(options: Options = {}) {
  vi.useFakeTimers();
  const log = { start: [] as Json[], replan: [] as Json[] };
  const settings = { mode: options.mode ?? 'always', feature: options.feature ?? true };
  const replans = options.replans ?? [plan(2, 6000)];
  /** The next replan answers only when this resolves (a replan in flight). */
  const hold: { next: Promise<void> | null } = { next: null };
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
        return Promise.resolve({
          data: playableDecision(options.start ?? plan(1, 10_000)),
          response: ok(201),
        });
      }
      if (path.endsWith('/replan')) {
        log.replan.push(init.body);
        if (options.replanFails) {
          return Promise.resolve({ error: {}, response: ok(options.replanFails) });
        }
        const answer = replans[Math.min(log.replan.length - 1, replans.length - 1)]!;
        const kind = options.replanKinds?.[log.replan.length];
        const gate = hold.next ?? Promise.resolve();
        hold.next = null;
        if (kind === 'gone') {
          return gate.then(() => ({
            error: { type: 'x/playback_session_not_found', status: 404 },
            response: ok(404),
          }));
        }
        if (kind === 'transient') return gate.then(() => ({ error: {}, response: ok(503) }));
        if (kind === 'refused') return gate.then(() => ({ error: {}, response: ok(400) }));
        if (kind === 'ended') return gate.then(() => ({ error: {}, response: ok(410) }));
        if (kind === 'terminal') {
          return gate.then(() => ({ data: terminalDecision(), response: ok() }));
        }
        return gate.then(() => ({ data: playableDecision(answer), response: ok() }));
      }
      return Promise.resolve({ response: ok() });
    }),
    DELETE: vi.fn(() => Promise.resolve({ response: ok(204) })),
  } as unknown as SiloClient;
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
    user: account,
    profileId: 'p1',
  });
  const views: BufferingView[] = [];
  const states: SessionState[] = [];
  const controller = new PlaybackController({
    client,
    baseUrl: BASE_URL,
    session,
    contentId: 'm1',
    intent: options.intent ?? { kind: 'beginning' },
    buffering: options.noBufferingDep ? undefined : () => settings,
    bandwidthCap: () => options.cap ?? null,
    onBuffering: (view) => views.push(view),
    onState: (state) => states.push(state),
    onMediaError: () => undefined,
    onEnded: () => undefined,
  });
  const engine = new FakeEngine();
  await controller.begin();
  controller.attachEngine(engine);
  // The metadata arrived: the first-frame watchdog has nothing to say.
  controller.onLoadedMetadata();
  engine.paused = false;
  controller.onPlaying();
  // Media data keeps arriving (a quiet link), until a test stops it.
  const data = options.data === false ? null : setInterval(() => engine.emit('data'), 1000);
  await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS + 1);
  const ctx = {
    controller,
    engine,
    hold,
    states,
    stopData: () => {
      if (data) clearInterval(data);
    },
    log,
    settings,
    views,
    view: () => views.at(-1) ?? { offer: null, notice: null },
    /** The player waits for `ms` of media, then a frame plays. */
    async stall(ms: number) {
      controller.onWaiting();
      await vi.advanceTimersByTimeAsync(ms);
      controller.onPlaying();
      await vi.advanceTimersByTimeAsync(1);
    },
    /** Two counted stalls: what triggers. */
    async twoStalls() {
      await ctx.stall(1500);
      await vi.advanceTimersByTimeAsync(1000);
      await ctx.stall(1500);
    },
    async wait(ms: number) {
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
  return ctx;
}

beforeEach(() => {
  window.localStorage.clear();
  clearInstallationCache();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('always, on Auto', () => {
  it('lowers at once on two counted stalls with the step-down estimate, and offers the undo', async () => {
    const ctx = await setup({ feature: true });
    ctx.engine.bandwidthEstimate = 4_000_000;
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(1);
    expect(ctx.log.replan[0]).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
      bandwidth_estimate_kbps: 7000,
      bandwidth_estimate_source: 'observed_rebuffer',
      observed_throughput_kbps: 4000,
      client_features: ['playback_plan_v3', 'buffering_quality_v1'],
    });
    expect(ctx.log.replan[0]).not.toHaveProperty('learned_limit');
    expect(ctx.view().offer?.kind).toBe('undo');
    expect(ctx.view().notice).toBeNull();
  });

  it('lowers at 6 s of one stall while it still lasts, not before', async () => {
    const ctx = await setup();
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS - 1);
    expect(ctx.log.replan).toHaveLength(0);
    await ctx.wait(1);
    expect(ctx.log.replan).toHaveLength(1);
    expect(ctx.log.replan[0]).toMatchObject({ bandwidth_estimate_kbps: 7000 });
    expect(ctx.view().offer?.kind).toBe('undo');
  });

  it('omits the observed throughput when the engine has no measurement', async () => {
    const ctx = await setup();
    await ctx.twoStalls();
    expect(ctx.log.replan[0]).toMatchObject({ bandwidth_estimate_source: 'observed_rebuffer' });
    expect(ctx.log.replan[0]).not.toHaveProperty('observed_throughput_kbps');
  });

  it('sends only the estimate, no source, throughput or feature, when the server does not know the setting', async () => {
    const ctx = await setup({ feature: false, mode: 'never' });
    // Behaves as `always` toward the server's older fields: the mode is whatever the screen says.
    ctx.settings.mode = 'always';
    ctx.engine.bandwidthEstimate = 4_000_000;
    await ctx.twoStalls();
    const body = ctx.log.replan[0]!;
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
    expect(ctx.log.start[0]).toMatchObject({ client_features: ['playback_plan_v3'] });
    expect(ctx.log.start[0]).not.toHaveProperty('learned_limit');
  });

  it('keeps the bitrate cap on the start, the lowering and the undo', async () => {
    const ctx = await setup({ cap: 5000 });
    await ctx.twoStalls();
    ctx.controller.bufferingAnswer('restore');
    await ctx.wait(1);
    expect(ctx.log.start[0]).toMatchObject({ bandwidth_cap_kbps: 5000 });
    expect(ctx.log.replan).toHaveLength(2);
    for (const body of ctx.log.replan) expect(body).toMatchObject({ bandwidth_cap_kbps: 5000 });
  });

  it('sends no cap when there is none', async () => {
    const ctx = await setup();
    await ctx.twoStalls();
    expect(ctx.log.replan[0]).not.toHaveProperty('bandwidth_cap_kbps');
  });

  it('does not lower twice while the undo pill shows, and watches the next plan fresh', async () => {
    const ctx = await setup();
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(1);
    // The undo pill is up: more stalls change nothing.
    await ctx.wait(STARTUP_GRACE_MS + 1);
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(1);
  });

  it("shows the can't-go-lower notice once per title when there is no delivered bitrate, and sends nothing", async () => {
    const ctx = await setup({ start: plan(1) });
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(0);
    expect(ctx.view().notice?.kind).toBe('cantLower');
    const first = ctx.view().notice;
    // Left alone for 300 s; then once more triggers nothing visible.
    await ctx.wait(NO_LOWER_COOLDOWN_MS - 5000);
    await ctx.twoStalls();
    expect(ctx.view().notice).toBe(first);
    await ctx.wait(NO_LOWER_COOLDOWN_MS);
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(0);
    expect(ctx.view().notice).toBe(first);
  });

  it('says there is nothing lower when the estimate would be below 100 kbps', async () => {
    const ctx = await setup({ start: plan(1, 142) });
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(0);
    expect(ctx.view().notice?.kind).toBe('cantLower');
  });

  it('says so, on every such adoption, when the lowered plan is no lower', async () => {
    const ctx = await setup({ replans: [plan(2, 10_000)] });
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(1);
    expect(ctx.view().offer).toBeNull();
    expect(ctx.view().notice?.kind).toBe('cantLower');
  });

  it('keeps playing and watches again after a minute when the replan fails', async () => {
    const ctx = await setup({ replanFails: 503 });
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(1);
    expect(ctx.view().offer).toBeNull();
    // Within the minute nothing is sent again...
    await ctx.wait(REARM_AFTER_UNADOPTED_MS - 5000);
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(1);
    await ctx.wait(10_000);
    // ...and after it the history starts fresh: one stall is not two.
    await ctx.stall(1500);
    expect(ctx.log.replan).toHaveLength(1);
    await ctx.wait(1000);
    await ctx.stall(1500);
    expect(ctx.log.replan).toHaveLength(2);
  });
});

describe('what is not a stall', () => {
  it('counts neither a seek, a pause nor the end', async () => {
    const ctx = await setup();
    for (let i = 0; i < 3; i += 1) {
      ctx.controller.onSeeking();
      await ctx.stall(8000);
      await ctx.wait(1000);
    }
    ctx.engine.paused = true;
    ctx.controller.onWaiting();
    await ctx.wait(10_000);
    ctx.engine.paused = false;
    ctx.controller.onPlaying();
    expect(ctx.log.replan).toHaveLength(0);
    expect(ctx.view().offer).toBeNull();
  });

  it('does not count a wait while the media buffered ahead is more than a second', async () => {
    const ctx = await setup();
    ctx.engine.currentTime = 100;
    ctx.engine.buffered = [{ start: 0, end: 102 }];
    await ctx.stall(LONG_STALL_MS + 1000);
    await ctx.stall(LONG_STALL_MS + 1000);
    expect(ctx.log.replan).toHaveLength(0);
  });

  it('does not count a wait in a reconnect, or after a media error', async () => {
    const ctx = await setup();
    void ctx.controller.onMediaError({ code: 2, message: 'network' });
    ctx.controller.onWaiting();
    await ctx.wait(8000);
    expect(ctx.log.replan.filter((b) => b.operation === 'quality_change')).toHaveLength(0);
  });

  it('needs a measured throughput below the delivered bitrate before the first frame', async () => {
    const run = async (measured: number | null) => {
      vi.useFakeTimers();
      const ctx = await setupUnplayed();
      ctx.engine.bandwidthEstimate = measured;
      ctx.controller.onWaiting();
      await ctx.wait(STARTUP_GRACE_MS + LONG_STALL_MS + 1000);
      return ctx.log.replan.filter((b) => b.operation === 'quality_change').length;
    };
    expect(await run(null)).toBe(0);
    // 10 Mbit/s is not below the 10 Mbit/s delivered; 2 Mbit/s is.
    expect(await run(10_000_000)).toBe(0);
    expect(await run(2_000_000)).toBe(1);
  });
});

/** A started plan that has not shown a frame. */
async function setupUnplayed() {
  vi.useFakeTimers();
  const log = { replan: [] as Json[] };
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
        return Promise.resolve({ data: playableDecision(plan(1, 10_000)), response: ok(201) });
      }
      if (path.endsWith('/replan')) {
        log.replan.push(init.body);
        return Promise.resolve({ data: playableDecision(plan(2, 6000)), response: ok() });
      }
      return Promise.resolve({ response: ok() });
    }),
    DELETE: vi.fn(() => Promise.resolve({ response: ok(204) })),
  } as unknown as SiloClient;
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
    user: account,
    profileId: 'p1',
  });
  const controller = new PlaybackController({
    client,
    baseUrl: BASE_URL,
    session,
    contentId: 'm1',
    intent: { kind: 'beginning' },
    buffering: () => ({ mode: 'always', feature: true }),
    onState: () => undefined,
    onMediaError: () => undefined,
    onEnded: () => undefined,
  });
  const engine = new FakeEngine();
  await controller.begin();
  controller.attachEngine(engine);
  controller.onLoadedMetadata();
  engine.paused = false;
  setInterval(() => engine.emit('data'), 1000);
  return {
    controller,
    engine,
    log,
    wait: (ms: number) => vi.advanceTimersByTimeAsync(ms),
  };
}

describe('ask, on Auto', () => {
  it('shows the prompt and sends nothing until the viewer answers', async () => {
    const ctx = await setup({ mode: 'ask' });
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(0);
    expect(ctx.view().offer?.kind).toBe('prompt');
  });

  it('Lower sends the same replan as always, then offers the undo', async () => {
    const ctx = await setup({ mode: 'ask' });
    ctx.engine.bandwidthEstimate = 4_000_000;
    await ctx.twoStalls();
    ctx.controller.bufferingAnswer('lower');
    await ctx.wait(1);
    expect(ctx.log.replan).toHaveLength(1);
    expect(ctx.log.replan[0]).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
      bandwidth_estimate_kbps: 7000,
      bandwidth_estimate_source: 'observed_rebuffer',
      observed_throughput_kbps: 4000,
    });
    expect(ctx.view().offer?.kind).toBe('undo');
  });

  it('Keep answers the title: no more prompts until the quality changes', async () => {
    const ctx = await setup({ mode: 'ask' });
    await ctx.twoStalls();
    ctx.controller.bufferingAnswer('keep');
    expect(ctx.view().offer).toBeNull();
    await ctx.wait(REOFFER_MIN_MS * 3);
    await ctx.twoStalls();
    expect(ctx.view().offer).toBeNull();
    expect(ctx.log.replan).toHaveLength(0);
    // A pick from the menu changes the quality, and with it the answer.
    await ctx.controller.qualityChange('720p');
    await ctx.wait(STARTUP_GRACE_MS + 1);
    ctx.controller.onPlaying();
    await ctx.wait(STARTUP_GRACE_MS + 1);
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('prompt');
  });

  it('a timeout starts over and offers again no sooner than 120 s after the prompt first showed', async () => {
    const ctx = await setup({ mode: 'ask' });
    await ctx.twoStalls();
    const id = ctx.view().offer!.id;
    ctx.controller.bufferingShown(id);
    await ctx.wait(15_000);
    ctx.controller.bufferingAnswer('expire');
    expect(ctx.view().offer).toBeNull();
    // History is gone: two more stalls inside the wait do nothing.
    await ctx.twoStalls();
    expect(ctx.view().offer).toBeNull();
    await ctx.wait(REOFFER_MIN_MS);
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('prompt');
  });

  it('a prompt that was not answered does not come back while it still shows', async () => {
    const ctx = await setup({ mode: 'ask' });
    await ctx.twoStalls();
    const first = ctx.view().offer;
    await ctx.wait(STARTUP_GRACE_MS);
    await ctx.twoStalls();
    expect(ctx.view().offer).toBe(first);
  });
});

describe('never', () => {
  it('only detects: no prompt, no replan, and the learned limit is ignored on start and replans', async () => {
    const ctx = await setup({ mode: 'never', feature: true });
    await ctx.twoStalls();
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS * 2);
    expect(ctx.view().offer).toBeNull();
    expect(ctx.log.replan).toHaveLength(0);
    expect(ctx.log.start[0]).toMatchObject({ learned_limit: 'ignore' });
    ctx.controller.onPlaying();
    await ctx.controller.trackChange({ audio: { id: 'file:1:audio:0', index: 0 } });
    expect(ctx.log.replan[0]).toMatchObject({ learned_limit: 'ignore' });
  });

  it('sends no learned-limit control without the feature', async () => {
    const ctx = await setup({ mode: 'never', feature: false });
    await ctx.controller.trackChange({ audio: { id: 'file:1:audio:0', index: 0 } });
    expect(ctx.log.start[0]).not.toHaveProperty('learned_limit');
    expect(ctx.log.replan[0]).not.toHaveProperty('learned_limit');
  });

  it('sends no learned-limit control in the other modes', async () => {
    for (const mode of ['always', 'ask'] as const) {
      const ctx = await setup({ mode });
      expect(ctx.log.start[0]).not.toHaveProperty('learned_limit');
      expect(ctx.log.start[0]).toMatchObject({
        client_features: ['playback_plan_v3', 'buffering_quality_v1'],
      });
    }
  });
});

describe('on a quality the viewer picked', () => {
  const picked: StartIntent = { kind: 'beginning', quality: '1080p' };

  it('asks first even in always mode, and Lower sends the next lower entry without an estimate', async () => {
    const ctx = await setup({
      intent: picked,
      mode: 'always',
      start: plan(1, 8000),
      replans: [plan(2, 4000)],
    });
    ctx.engine.bandwidthEstimate = 4_000_000;
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(0);
    expect(ctx.view().offer?.kind).toBe('prompt');
    ctx.controller.bufferingAnswer('lower');
    await ctx.wait(1);
    expect(ctx.log.replan).toHaveLength(1);
    expect(ctx.log.replan[0]).toMatchObject({
      operation: 'quality_change',
      quality_preference: '720p',
    });
    for (const field of [
      'bandwidth_estimate_kbps',
      'bandwidth_estimate_source',
      'observed_throughput_kbps',
      'learned_limit',
    ]) {
      expect(ctx.log.replan[0]).not.toHaveProperty(field);
    }
    // Nothing was learned and nothing needs undoing: a notice, no undo pill.
    expect(ctx.view().offer).toBeNull();
    expect(ctx.view().notice?.kind).toBe('lowered');
  });

  it('asks in ask mode too, and says nothing is lower when the pick is the lowest rung', async () => {
    const ctx = await setup({
      intent: { kind: 'beginning', quality: '480p' },
      mode: 'ask',
      start: plan(1, 1500),
    });
    await ctx.twoStalls();
    expect(ctx.view().offer).toBeNull();
    expect(ctx.view().notice?.kind).toBe('cantLower');
    expect(ctx.log.replan).toHaveLength(0);
  });

  it('does not lower silently when the mode is never', async () => {
    const ctx = await setup({ intent: picked, mode: 'never', start: plan(1, 8000) });
    await ctx.twoStalls();
    expect(ctx.view().offer).toBeNull();
    expect(ctx.log.replan).toHaveLength(0);
  });
});

describe('Restore quality', () => {
  it('goes back to Auto with no estimate and clears the learned limit, and answers the title', async () => {
    const ctx = await setup({ feature: true });
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('undo');
    ctx.controller.bufferingAnswer('restore');
    await ctx.wait(1);
    expect(ctx.log.replan).toHaveLength(2);
    expect(ctx.log.replan[1]).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
      learned_limit: 'clear',
    });
    for (const field of ['bandwidth_estimate_kbps', 'bandwidth_estimate_source']) {
      expect(ctx.log.replan[1]).not.toHaveProperty(field);
    }
    expect(ctx.view().offer).toBeNull();
    // The title is answered: more stalls lower nothing.
    await ctx.wait(STARTUP_GRACE_MS + 1);
    ctx.controller.onPlaying();
    await ctx.wait(STARTUP_GRACE_MS + 1);
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(2);
  });

  it('sends no learned-limit control without the feature', async () => {
    const ctx = await setup({ feature: false });
    await ctx.twoStalls();
    ctx.controller.bufferingAnswer('restore');
    await ctx.wait(1);
    expect(ctx.log.replan[1]).not.toHaveProperty('learned_limit');
  });

  it('hiding the undo pill (Back or the timer) does not answer the title', async () => {
    const ctx = await setup();
    await ctx.twoStalls();
    ctx.controller.bufferingAnswer('hide');
    expect(ctx.view().offer).toBeNull();
    // The lowered plan keeps buffering: it lowers again from its own bitrate.
    await ctx.wait(STARTUP_GRACE_MS + 1);
    ctx.controller.onPlaying();
    await ctx.wait(STARTUP_GRACE_MS + 1);
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(2);
    expect(ctx.log.replan[1]).toMatchObject({ bandwidth_estimate_kbps: 4200 });
  });
});

describe('the kept estimate', () => {
  const track = { audio: { id: 'file:1:audio:0', index: 0 } };

  it('is repeated by later Auto replans without a source', async () => {
    const ctx = await setup({ feature: true });
    await ctx.twoStalls();
    await ctx.controller.trackChange(track);
    expect(ctx.log.replan[1]).toMatchObject({
      operation: 'track_change',
      bandwidth_estimate_kbps: 7000,
    });
    expect(ctx.log.replan[1]).not.toHaveProperty('bandwidth_estimate_source');
    expect(ctx.log.replan[1]).not.toHaveProperty('observed_throughput_kbps');
    // A replan the controller did not send took the undo pill away.
    expect(ctx.view().offer).toBeNull();
  });

  it('is dropped by Restore', async () => {
    const ctx = await setup({ feature: true });
    await ctx.twoStalls();
    ctx.controller.bufferingAnswer('restore');
    await ctx.wait(1);
    await ctx.controller.trackChange(track);
    expect(ctx.log.replan.at(-1)).toMatchObject({ operation: 'track_change' });
    expect(ctx.log.replan.at(-1)).not.toHaveProperty('bandwidth_estimate_kbps');
  });

  it('is dropped by a quality the viewer picks, and a later Auto does not bring it back', async () => {
    const ctx = await setup();
    await ctx.twoStalls();
    await ctx.controller.qualityChange('720p');
    expect(ctx.log.replan[1]).not.toHaveProperty('bandwidth_estimate_kbps');
    await ctx.controller.qualityChange('auto');
    expect(ctx.log.replan[2]).not.toHaveProperty('bandwidth_estimate_kbps');
  });

  it('is not repeated on a picked quality', async () => {
    const ctx = await setup();
    await ctx.twoStalls();
    // A track change while the preference is no longer Auto carries no estimate.
    await ctx.controller.qualityChange('720p');
    await ctx.controller.trackChange(track);
    expect(ctx.log.replan.at(-1)).not.toHaveProperty('bandwidth_estimate_kbps');
  });

  it('is dropped by a new start', async () => {
    const ctx = await setup({ replans: [plan(2, 6000)] });
    await ctx.twoStalls();
    await ctx.controller.start(0);
    expect(ctx.log.start[1]).not.toHaveProperty('bandwidth_estimate_kbps');
    await ctx.controller.trackChange(track);
    expect(ctx.log.replan.at(-1)).not.toHaveProperty('bandwidth_estimate_kbps');
  });

  it('is dropped when the stepped-down plan does not play and the quality falls back', async () => {
    const ctx = await setup({ replans: [plan(2, 6000), plan(3, 6000)] });
    await ctx.twoStalls();
    // The lowered plan loaded anew and fails before its first frame: back to the quality before.
    await ctx.controller.onMediaError({ code: 3, message: 'decode' });
    const back = ctx.log.replan[1]!;
    expect(back).toMatchObject({ operation: 'quality_change', quality_preference: 'auto' });
    expect(back).not.toHaveProperty('bandwidth_estimate_kbps');
    await ctx.controller.trackChange(track);
    expect(ctx.log.replan.at(-1)).not.toHaveProperty('bandwidth_estimate_kbps');
  });
});

describe('the bodies without any buffering event', () => {
  it('a start on Auto carries no buffering fields besides the feature', async () => {
    const ctx = await setup({ feature: true });
    const start = ctx.log.start[0]!;
    for (const field of [
      'bandwidth_estimate_kbps',
      'bandwidth_estimate_source',
      'observed_throughput_kbps',
      'learned_limit',
    ]) {
      expect(start).not.toHaveProperty(field);
    }
    expect(start).toMatchObject({ client_features: ['playback_plan_v3', 'buffering_quality_v1'] });
  });
});

describe('the end of a seek', () => {
  it('counts the stalls after a seek into buffered data that raised no playing', async () => {
    const ctx = await setup();
    ctx.controller.onSeeking();
    ctx.engine.emit('seeked');
    await ctx.twoStalls();
    expect(ctx.log.replan).toHaveLength(1);
  });

  it('keeps the seek exemption at seeked while paused or without data for the next frame', async () => {
    const ctx = await setup();
    ctx.engine.hasFutureData = false;
    ctx.controller.onSeeking();
    ctx.engine.emit('seeked');
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS + 1000);
    expect(ctx.log.replan).toHaveLength(0);
    ctx.engine.hasFutureData = true;
    ctx.engine.paused = true;
    ctx.controller.onSeeking();
    ctx.engine.emit('seeked');
    ctx.engine.paused = false;
    ctx.controller.onPlaying();
    // paused at seeked: the exemption ended at the frame, so this wait counts, but only once.
    await ctx.stall(1500);
    expect(ctx.log.replan).toHaveLength(0);
  });
});

describe('an outage', () => {
  it('does not lower for a link that has gone silent, on direct play', async () => {
    const ctx = await setup();
    ctx.stopData();
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS + 2000);
    expect(ctx.log.replan).toHaveLength(0);
  });

  it('lowers when data keeps arriving during the wait', async () => {
    const ctx = await setup();
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS);
    expect(ctx.log.replan).toHaveLength(1);
  });

  it('times the wait again from the data that ends an outage', async () => {
    const ctx = await setup();
    ctx.stopData();
    ctx.controller.onWaiting();
    await ctx.wait(5000);
    ctx.engine.emit('data');
    // The link works again: data keeps arriving.
    setInterval(() => ctx.engine.emit('data'), 1000);
    await ctx.wait(LONG_STALL_MS - 1);
    expect(ctx.log.replan).toHaveLength(0);
    await ctx.wait(1);
    expect(ctx.log.replan).toHaveLength(1);
  });

  it('allows 15 s of silence on HLS before it is an outage', async () => {
    const ctx = await setup();
    ctx.stopData();
    ctx.engine.decoder = 'hlsjs';
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS);
    expect(ctx.log.replan).toHaveLength(1);
  });
});

describe('a renderer wait', () => {
  it('turns into a stall when the buffer runs down, and lowers 6 s after that', async () => {
    const ctx = await setup();
    ctx.engine.currentTime = 100;
    ctx.engine.buffered = [{ start: 0, end: 103 }];
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS * 2);
    expect(ctx.log.replan).toHaveLength(0);
    ctx.engine.buffered = [{ start: 0, end: 100.5 }];
    await ctx.wait(500);
    expect(ctx.log.replan).toHaveLength(0);
    await ctx.wait(LONG_STALL_MS - 1);
    expect(ctx.log.replan).toHaveLength(0);
    await ctx.wait(1);
    expect(ctx.log.replan).toHaveLength(1);
  });
});

describe('a lowering that goes wrong', () => {
  it('takes a plan without degradation warnings as a lowering', async () => {
    const answer = {
      ...plan(2, 6000),
      degradation_warnings: undefined,
    } as unknown as S['PlaybackPlan'];
    const ctx = await setup({ replans: [answer] });
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('undo');
  });
});

describe('a growing buffered end is media data', () => {
  /** A direct-play wait at the end of the buffer; `grow` seconds are added every 500 ms. */
  async function waitAtBufferEnd(grow: number, options: Options = {}) {
    const ctx = await setup({ data: false, ...options });
    // Playing: the buffer's end is noted, then it grows up to the playhead (data the element never
    // announced) before the wait begins.
    ctx.engine.currentTime = 98;
    ctx.engine.buffered = [{ start: 0, end: 99 }];
    ctx.controller.onPlaying();
    await ctx.wait(1000);
    ctx.engine.currentTime = 100;
    let end = 100;
    ctx.engine.buffered = [{ start: 0, end }];
    ctx.controller.onWaiting();
    const timer = setInterval(() => {
      end += grow;
      ctx.engine.buffered = [{ start: 0, end }];
    }, 500);
    return { ctx, timer, end: () => end };
  }

  it('lowers at 6 s when the buffer grows slowly, with no data events at all', async () => {
    const { ctx, timer } = await waitAtBufferEnd(0.05);
    await ctx.wait(LONG_STALL_MS - 1);
    expect(ctx.log.replan).toHaveLength(0);
    await ctx.wait(1);
    expect(ctx.log.replan).toHaveLength(1);
    clearInterval(timer);
  });

  it('is an outage at 4 s when the buffered end is frozen: nothing is lowered', async () => {
    const { ctx, timer } = await waitAtBufferEnd(0);
    await ctx.wait(LONG_STALL_MS + 3000);
    expect(ctx.log.replan).toHaveLength(0);
    clearInterval(timer);
  });

  /** Plays and stalls once at 100 s (a sample of the buffered end), then the playhead jumps. */
  async function sampledThenJumped() {
    const ctx = await setup({ data: false });
    ctx.engine.currentTime = 100;
    ctx.engine.buffered = [{ start: 0, end: 100.2 }];
    await ctx.stall(1500);
    ctx.engine.currentTime = 500;
    ctx.engine.buffered = [
      { start: 0, end: 100.2 },
      { start: 450, end: 500.2 },
    ];
    return ctx;
  }

  it('does not take the jump of the buffered end after a seek for data', async () => {
    const ctx = await sampledThenJumped();
    ctx.controller.onSeeking();
    ctx.engine.emit('seeked');
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS + 3000);
    expect(ctx.log.replan).toHaveLength(0);
  });

  it('does not take the jump of the buffered end under a new plan for data', async () => {
    const ctx = await sampledThenJumped();
    await ctx.controller.trackChange({ audio: { id: 'file:1:audio:0', index: 0 } });
    ctx.controller.onPlaying();
    ctx.engine.currentTime = 500;
    ctx.controller.onWaiting();
    await ctx.wait(LONG_STALL_MS + 3000);
    expect(ctx.log.replan.filter((b) => b.operation === 'quality_change')).toHaveLength(0);
  });

  it('stops sampling once playback runs again', async () => {
    const ctx = await setup({ data: false });
    ctx.engine.currentTime = 100;
    ctx.engine.buffered = [{ start: 0, end: 100.2 }];
    const idle = vi.getTimerCount();
    ctx.controller.onWaiting();
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    ctx.controller.onPlaying();
    expect(vi.getTimerCount()).toBe(idle);
  });
});

describe('a Restore that meets a replan in flight', () => {
  const track = { audio: { id: 'file:1:audio:0', index: 0 } };
  const replans = [plan(2, 6000), plan(3, 6000), plan(4, 6000)];

  /** A track change is in flight, the undo pill is up and Restore is pressed. */
  async function pressed(options: Options = {}) {
    const ctx = await setup({ replans, ...options });
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('undo');
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    const change = ctx.controller.trackChange(track);
    await ctx.wait(1);
    ctx.controller.bufferingAnswer('restore');
    await ctx.wait(1);
    return { ctx, release, change };
  }

  it('is sent once the replan has ended, as the only quality_change after the lowering', async () => {
    const { ctx, release, change } = await pressed();
    expect(ctx.log.replan).toHaveLength(2);
    release();
    await change;
    await ctx.wait(1);
    expect(ctx.log.replan).toHaveLength(3);
    const restore = ctx.log.replan[2]!;
    expect(restore).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
      learned_limit: 'clear',
    });
    expect(restore).not.toHaveProperty('bandwidth_estimate_kbps');
    await ctx.wait(5000);
    expect(ctx.log.replan).toHaveLength(3);
  });

  it('is sent without learned_limit, still on Auto, when the server lacks the feature', async () => {
    const { ctx, release, change } = await pressed({ feature: false });
    release();
    await change;
    await ctx.wait(1);
    expect(ctx.log.replan[2]).toMatchObject({
      operation: 'quality_change',
      quality_preference: 'auto',
    });
    expect(ctx.log.replan[2]).not.toHaveProperty('learned_limit');
  });

  it('waits for the seek that is owed to the load the replan started, then sends after it', async () => {
    const { ctx, release, change } = await pressed();
    ctx.engine.duration = 5400;
    await ctx.controller.seekTo(1234);
    release();
    await change;
    await ctx.wait(1);
    // The Restore would null the owed seek: it waits for the load's metadata.
    expect(ctx.log.replan).toHaveLength(2);
    ctx.engine.seeks.length = 0;
    ctx.controller.onLoadedMetadata();
    await ctx.wait(1);
    expect(ctx.engine.seeks).toEqual([1234]);
    expect(ctx.log.replan.map((b) => b.operation)).toEqual([
      'quality_change',
      'track_change',
      'quality_change',
    ]);
    expect(ctx.log.replan[2]).toMatchObject({ quality_preference: 'auto', learned_limit: 'clear' });
  });

  it('is not sent when the session was stopped meanwhile', async () => {
    const { ctx, release, change } = await pressed();
    void ctx.controller.stop();
    release();
    await change;
    await ctx.wait(5000);
    expect(ctx.log.replan).toHaveLength(2);
  });
});

describe('a pending Restore when the replan in flight ends without a session', () => {
  const track = { audio: { id: 'file:1:audio:0', index: 0 } };

  async function pendingOver(kind: 'gone' | 'ended' | 'terminal') {
    // Call 1 is the lowering, call 2 the track change that ends badly.
    const ctx = await setup({ replans: [plan(2, 6000)], replanKinds: { 2: kind } });
    await ctx.twoStalls();
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    const change = ctx.controller.trackChange(track);
    await ctx.wait(1);
    ctx.controller.bufferingAnswer('restore');
    await ctx.wait(1);
    release();
    await change;
    await ctx.wait(1000);
    return ctx;
  }

  it('gone: the session restarts once and no Restore is sent', async () => {
    const ctx = await pendingOver('gone');
    expect(ctx.log.replan).toHaveLength(2);
    expect(ctx.log.start).toHaveLength(2);
  });

  it('ended: the session ends once and no Restore is sent', async () => {
    const ctx = await pendingOver('ended');
    expect(ctx.log.replan).toHaveLength(2);
    expect(ctx.states.filter((state) => state.kind === 'error')).toHaveLength(1);
  });

  it('terminal: the screen fails once and no Restore is sent', async () => {
    const ctx = await pendingOver('terminal');
    expect(ctx.log.replan).toHaveLength(2);
    expect(ctx.states.filter((state) => state.kind === 'error')).toHaveLength(1);
  });
});

describe('the controller around the buffering controller', () => {
  it('a pause during a wait counts nothing and leaves no buffering timer', async () => {
    const ctx = await setup();
    const idle = vi.getTimerCount();
    ctx.controller.onWaiting();
    expect(vi.getTimerCount()).toBeGreaterThan(idle);
    ctx.engine.paused = true;
    ctx.controller.onPause();
    await ctx.wait(8000);
    expect(ctx.log.replan).toHaveLength(0);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(idle);
  });

  it('a media error ends the wait it came in: the wait after the recovery is no stall', async () => {
    const ctx = await setup();
    ctx.controller.onWaiting();
    await ctx.controller.onMediaError({ code: 3, message: 'decode' });
    await ctx.wait(8000);
    expect(ctx.log.replan.filter((b) => b.operation === 'quality_change')).toHaveLength(0);
  });

  it('stop leaves no timer behind, and later media data and waits arm nothing', async () => {
    const ctx = await setup();
    ctx.stopData();
    ctx.controller.onWaiting();
    void ctx.controller.stop();
    ctx.engine.emit('data');
    ctx.controller.onWaiting();
    await ctx.wait(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.log.replan).toHaveLength(0);
  });

  it('a pick takes the offer away at once; an applied pick answers the title anew, a failed one does not', async () => {
    const ctx = await setup({ mode: 'ask', replanKinds: { 1: 'refused' } });
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('prompt');
    ctx.controller.bufferingAnswer('keep');
    // A failed pick (refused): the answer stays, and nothing is offered again.
    await ctx.controller.qualityChange('720p');
    await ctx.wait(10_001);
    await ctx.twoStalls();
    expect(ctx.view().offer).toBeNull();
    // An applied pick starts over: the prompt can come back.
    await ctx.controller.qualityChange('1080p');
    await ctx.wait(10_001);
    ctx.controller.onPlaying();
    await ctx.wait(10_001);
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('prompt');
  });

  it('a pick sent clears the offer before its answer arrives', async () => {
    const ctx = await setup({ mode: 'ask' });
    await ctx.twoStalls();
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    const pick = ctx.controller.qualityChange('720p');
    await ctx.wait(1);
    expect(ctx.view().offer).toBeNull();
    release();
    await pick;
  });

  it('tells the screen nothing after the session was disposed', async () => {
    const ctx = await setup();
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    await ctx.twoStalls();
    const shown = ctx.views.length;
    ctx.controller.dispose();
    release();
    await ctx.wait(1000);
    expect(ctx.views).toHaveLength(shown);
  });

  it('without a buffering dependency it runs always and does not claim the feature', async () => {
    const ctx = await setup({ noBufferingDep: true });
    expect(ctx.log.start[0]).toMatchObject({ client_features: ['playback_plan_v3'] });
    expect(ctx.log.start[0]).not.toHaveProperty('learned_limit');
    await ctx.twoStalls();
    expect(ctx.log.replan[0]).toMatchObject({ bandwidth_estimate_kbps: 7000 });
    expect(ctx.log.replan[0]).not.toHaveProperty('bandwidth_estimate_source');
  });
});

describe('a pending Restore, by how the replan in flight ends', () => {
  const track = { audio: { id: 'file:1:audio:0', index: 0 } };

  /** The undo pill is up, a track change is held, Restore is pressed; the held replan is returned. */
  async function pressed(options: Options = {}) {
    const ctx = await setup(options);
    await ctx.twoStalls();
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    const change = ctx.controller.trackChange(track);
    await ctx.wait(1);
    ctx.controller.bufferingAnswer('restore');
    await ctx.wait(1);
    return { ctx, release, change };
  }
  const restores = (ctx: Awaited<ReturnType<typeof setup>>) =>
    ctx.log.replan.filter((b) => b.operation === 'quality_change' && b.learned_limit === 'clear');

  it.each(['refused', 'transient'] as const)(
    'is still sent once behind a replan that ended %s',
    async (kind) => {
      const { ctx, release, change } = await pressed({
        replans: [plan(2, 6000), plan(3, 6000)],
        replanKinds: { 2: kind },
      });
      release();
      await change;
      await ctx.wait(1000);
      expect(restores(ctx)).toHaveLength(1);
      expect(ctx.log.replan).toHaveLength(3);
    },
  );

  it('is not sent behind a replan that ended in a loop', async () => {
    // Plan 1 was the start's: bringing it back for a failure recovery is a loop.
    const ctx = await setup({ replans: [plan(2, 6000), plan(1, 10_000)] });
    await ctx.twoStalls();
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    const recovery = ctx.controller.replan('failure_recovery', {
      failure: { classification: 'transport_stall' },
    });
    await ctx.wait(1);
    ctx.controller.bufferingAnswer('restore');
    await ctx.wait(1);
    release();
    expect((await recovery).kind).toBe('loop');
    await ctx.wait(1000);
    expect(restores(ctx)).toHaveLength(0);
  });

  it('is dropped by a new start, and not sent when the replan then ends', async () => {
    const { ctx, release, change } = await pressed();
    await ctx.controller.start(0);
    release();
    await change;
    await ctx.wait(1000);
    expect(restores(ctx)).toHaveLength(0);
  });

  it('a lowering that meets a running replan is busy and queues nothing', async () => {
    const ctx = await setup();
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    const change = ctx.controller.trackChange(track);
    await ctx.wait(1);
    const replanner = (
      ctx.controller as unknown as {
        replanner: {
          qualityChange(
            label: string,
            extra: { lowering: { estimateKbps: number; observedKbps: null } },
          ): Promise<{ kind: string }>;
        };
      }
    ).replanner;
    const answer = await replanner.qualityChange('auto', {
      lowering: { estimateKbps: 7000, observedKbps: null },
    });
    expect(answer.kind).toBe('busy');
    release();
    await change;
    await ctx.wait(1000);
    expect(ctx.log.replan.map((b) => b.operation)).toEqual(['track_change']);
  });
});

describe('the controller, with its real manager, in the hard cases', () => {
  const track = { audio: { id: 'file:1:audio:0', index: 0 } };
  const ops = (ctx: Awaited<ReturnType<typeof setup>>) => ctx.log.replan.map((b) => b.operation);
  /** `ms` of waiting with media data arriving every second. */
  async function feed(ctx: Awaited<ReturnType<typeof setup>>, ms: number) {
    for (let left = ms; left > 0; left -= 1000) {
      ctx.engine.emit('data');
      await ctx.wait(Math.min(1000, left));
    }
  }

  it('a failed pick leaves a long stall to the check at its end: the lowering follows at once', async () => {
    const ctx = await setup({ replanKinds: { 1: 'refused' } });
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    const pick = ctx.controller.qualityChange('720p');
    await ctx.wait(1);
    ctx.controller.onWaiting();
    await feed(ctx, 7000);
    expect(ops(ctx)).toEqual(['quality_change']);
    release();
    await pick;
    await ctx.wait(1);
    expect(ops(ctx)).toEqual(['quality_change', 'quality_change']);
    expect(ctx.log.replan[1]).toMatchObject({
      quality_preference: 'auto',
      bandwidth_estimate_kbps: 7000,
    });
  });

  it('a trigger during another replan is held, and the history is still there afterwards', async () => {
    const ctx = await setup();
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    const change = ctx.controller.trackChange(track);
    await ctx.wait(1);
    await ctx.twoStalls();
    expect(ops(ctx)).toEqual(['track_change']);
    release();
    await change;
    // The replan's plan started over: its frame, its grace, and then a fresh pair of stalls.
    ctx.controller.onPlaying();
    await ctx.wait(10_001);
    await ctx.twoStalls();
    expect(ops(ctx)).toEqual(['track_change', 'quality_change']);
  });

  it('stalls during a reconnect do not count, and do not pair with one after it', async () => {
    const ctx = await setup({ replanKinds: { 1: 'transient' } });
    let release = () => {};
    // The reconnect's first retry (after 1 s) is held: the reconnect runs meanwhile.
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    void ctx.controller.onMediaError({ code: 2, message: 'network' });
    await ctx.wait(1500);
    await ctx.twoStalls();
    release();
    await ctx.wait(10_000);
    // The retry was transient, the next one applies: the reconnect is over.
    await ctx.stall(1500);
    expect(ops(ctx).filter((o) => o === 'quality_change')).toHaveLength(0);
  });

  it('stalls in the pause between two retries of a reconnect are not counted', async () => {
    const ctx = await setup({ replanKinds: { 1: 'transient', 2: 'transient' } });
    void ctx.controller.onMediaError({ code: 2, message: 'network' });
    // Retries at 1 s and 3 s answer transient; the next is at 7 s. Three stalls fit between:
    // the media error's interruption absorbs the first, so two more are a pair.
    await ctx.wait(3100);
    for (let i = 0; i < 3; i += 1) {
      await ctx.stall(1000);
      await ctx.wait(200);
    }
    expect(ops(ctx).filter((o) => o === 'quality_change')).toHaveLength(0);
  });

  it('a lost connection in the middle of a stall does not leave the stall to be counted', async () => {
    const ctx = await setup({
      replanKinds: { 1: 'transient', 2: 'transient', 3: 'transient' },
    });
    ctx.controller.onWaiting();
    await feed(ctx, 500);
    void ctx.controller.onMediaError({ code: 2, message: 'network' });
    // Retries at 1, 3 and 7 s fail; a frame plays after 7 s of waiting.
    await feed(ctx, 7000);
    ctx.controller.onPlaying();
    await ctx.wait(1);
    await ctx.stall(1500);
    await ctx.wait(30_000);
    expect(ops(ctx).filter((o) => o === 'quality_change')).toHaveLength(0);
  });

  it('a lowering that finishes after stop() shows nothing', async () => {
    const ctx = await setup();
    let release = () => {};
    ctx.hold.next = new Promise<void>((resolve) => (release = resolve));
    await ctx.twoStalls();
    const shown = ctx.views.length;
    void ctx.controller.stop();
    release();
    await ctx.wait(1000);
    expect(ctx.views).toHaveLength(shown);
  });

  it('an answer after dispose tells the screen nothing', async () => {
    const ctx = await setup({ mode: 'ask' });
    await ctx.twoStalls();
    expect(ctx.view().offer?.kind).toBe('prompt');
    const shown = ctx.views.length;
    ctx.controller.dispose();
    ctx.controller.bufferingAnswer('keep');
    expect(ctx.views).toHaveLength(shown);
  });
});

// Replans on a stub client and a small fake deps object, without the controller. What needs the
// whole controller to be meaningful (the recovery chain's callers, the reload after adopt) stays
// with the controller tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { problem } from '../../test/apiFixtures';
import { playableDecision, playbackPlan, terminalDecision } from '../../test/playbackFixtures';
import type { ClientCapabilities, PlaybackContext } from '../deviceProfile';
import type { PlayerEngine } from '../engine/PlayerEngine';
import { CLIENT_FEATURES } from '../deviceProfile';
import { MAX_RECOVERIES, Replanner, classifyRefusal, type ReplanState } from './replan';
import type { Plan, PlayerReading } from './types';

type Decision = components['schemas']['PlaybackDecision'];
type Json = Record<string, unknown>;
type AdoptOptions = { forceReload?: boolean; autoplay?: boolean };

/** What the stub answers: a decision, a refusal by status and code, or a thrown network error. */
type Answer = Decision | { status: number; code?: string } | 'throw';

const capabilities = { marker: 'caps' } as unknown as ClientCapabilities;
const context = { marker: 'context' } as unknown as PlaybackContext;

const planN = (n: number): Plan =>
  playbackPlan({ plan_id: `plan:${n}`, plan_attempt_key: `k${n}` });

function setup(answers: Answer[] = [], overrides: { engine?: PlayerEngine | null } = {}) {
  const queue = [...answers];
  const bodies: Json[] = [];
  const paths: string[] = [];
  const post = vi.fn(async (_path: string, init: { body: Json; params: { path: Json } }) => {
    bodies.push(init.body);
    paths.push(JSON.stringify(init.params.path));
    const next = queue.shift() ?? playableDecision(planN(bodies.length + 1));
    if (next === 'throw') throw new TypeError('network');
    if ('status' in next) {
      return {
        data: undefined,
        error: problem(next.code ?? 'bad', next.status),
        response: new Response(null, { status: next.status }),
      };
    }
    return { data: next, error: undefined, response: new Response(null, { status: 200 }) };
  });

  const world = {
    stopped: false,
    plan: planN(1) as Plan | null,
    recoveryActive: false,
    /** Whether adopting a plan starts a new load (the load id moves). */
    adoptReloads: false,
    capabilities: capabilities as ClientCapabilities | null,
    context: context as PlaybackContext | null,
    origin: 0,
    reading: { position: 100, paused: false } as PlayerReading | null,
    state: {
      sessionId: 'session-1',
      installationId: 'install-1',
      attemptId: 'attempt-1',
      planAttemptId: 'pa-1',
      attemptedKeys: ['k1'],
      quality: null,
      startPosition: 30,
      hasPlayed: true,
      loadId: 1,
    } as ReplanState,
  };
  const calls = {
    fail: vi.fn(),
    sessionGone: vi.fn(),
    restartAt: vi.fn<(position: number) => Promise<void>>(async () => undefined),
    setStartPosition: vi.fn(),
    setQuality: vi.fn(),
    refreshProfile: vi.fn(async () => ({ capabilities, context })),
  };
  // Adopting a plan loads it: the load id moves unless the test says the stream stayed.
  const adopt = vi.fn<(plan: Plan, session: string, options: AdoptOptions) => void>(() => {
    world.state = { ...world.state, loadId: world.state.loadId + (world.adoptReloads ? 1 : 0) };
  });
  const replanner = new Replanner({
    client: { POST: post } as unknown as SiloClient,
    header: () => ({ 'X-Profile-Id': 'p1' }),
    isStopped: () => world.stopped,
    plan: () => world.plan,
    capabilities: () => world.capabilities,
    context: () => world.context,
    state: () => world.state,
    reading: () => world.reading,
    refreshProfile: calls.refreshProfile,
    setStartPosition: calls.setStartPosition,
    setQuality: (quality) => {
      calls.setQuality(quality);
      world.state = { ...world.state, quality };
    },
    adopt,
    engine: () => (overrides.engine === undefined ? null : overrides.engine),
    origin: () => world.origin,
    recoveryActive: () => world.recoveryActive,
    fail: calls.fail,
    sessionGone: calls.sessionGone,
    restartAt: calls.restartAt,
  });
  return { replanner, world, post, bodies, paths, adopt, ...calls };
}

beforeEach(() => vi.clearAllMocks());

describe('classifyRefusal', () => {
  it.each([
    [410, 'anything', 'ended'],
    [410, 'not_found', 'ended'],
    [404, 'session_not_found', 'gone'],
    [404, '', 'gone'],
    [404, 'not_found', 'refused'],
    [500, '', 'transient'],
    [503, 'unavailable', 'transient'],
    [408, '', 'transient'],
    [429, '', 'transient'],
    [409, 'replan_in_progress', 'transient'],
    [400, 'replan_in_progress', 'transient'],
    [400, 'bad_request', 'refused'],
    [403, '', 'refused'],
    [422, 'invalid', 'refused'],
  ])('maps %i %s to %s', (status, code, kind) => {
    expect(classifyRefusal(status, code)).toEqual({ kind });
  });
});

describe('Replanner.replan', () => {
  it('sends nothing and answers busy without a plan, while stopped, and while another replan runs', async () => {
    const noPlan = setup();
    noPlan.world.plan = null;
    expect(await noPlan.replanner.replan('track_change')).toEqual({ kind: 'busy' });
    expect(noPlan.post).not.toHaveBeenCalled();

    const stopped = setup();
    stopped.world.stopped = true;
    expect(await stopped.replanner.replan('track_change')).toEqual({ kind: 'busy' });
    expect(stopped.post).not.toHaveBeenCalled();

    const running = setup();
    const first = running.replanner.replan('track_change');
    expect(running.replanner.isReplanning).toBe(true);
    expect(await running.replanner.replan('quality_change', { quality: '720p' })).toEqual({
      kind: 'busy',
    });
    await first;
    expect(running.post).toHaveBeenCalledTimes(1);
    expect(running.replanner.isReplanning).toBe(false);
  });

  it('builds the request from the plan, the state and the device profile', async () => {
    const t = setup();
    await t.replanner.replan('track_change', { tracks: { audio: { id: 'a2', index: 1 } } });
    expect(t.bodies[0]).toMatchObject({
      installation_id: 'install-1',
      protocol_version: 3,
      operation: 'track_change',
      playback_attempt_id: 'attempt-1',
      failed_plan_id: 'plan:1',
      plan_attempt_id: 'pa-1',
      plan_attempt_key: 'k1',
      attempted_plan_keys: ['k1'],
      attempt_count: 1,
      quality_preference: 'auto',
      position_seconds: 100,
      selected_tracks: { audio: { id: 'a2', index: 1 } },
      client_capabilities: capabilities,
      client_playback_context: context,
    });
    expect(t.bodies[0]).not.toHaveProperty('failure');
  });

  it('uses a fresh request id for every replan', async () => {
    const t = setup();
    await t.replanner.replan('track_change');
    await t.replanner.replan('track_change');
    expect(t.bodies[0]!.replan_request_id).toBeTruthy();
    expect(t.bodies[0]!.replan_request_id).not.toBe(t.bodies[1]!.replan_request_id);
  });

  it('reports the start position before the first frame, the reading after it, an explicit position first', async () => {
    const before = setup();
    before.world.state = { ...before.world.state, hasPlayed: false };
    await before.replanner.replan('track_change');
    expect(before.bodies[0]!.position_seconds).toBe(30);

    const played = setup();
    played.world.reading = null;
    await played.replanner.replan('track_change');
    expect(played.bodies[0]!.position_seconds).toBe(30);

    const explicit = setup();
    await explicit.replanner.replan('seek_reanchor', { position: 0 });
    expect(explicit.bodies[0]!.position_seconds).toBe(0);
    expect(explicit.setStartPosition).toHaveBeenCalledWith(0);
  });

  it('sends the failure and the quality preference the options name', async () => {
    const t = setup();
    t.world.state = { ...t.world.state, quality: '1080p' };
    await t.replanner.replan('failure_recovery', {
      failure: { classification: 'media_error', message: 'boom' },
    });
    expect(t.bodies[0]).toMatchObject({
      failure: { classification: 'media_error', message: 'boom' },
      quality_preference: '1080p',
    });
    await t.replanner.replan('quality_change', { quality: '480p' });
    expect(t.bodies[1]!.quality_preference).toBe('480p');
  });

  it('reads the device profile again on an output change and sends the new one', async () => {
    const t = setup();
    const fresh = { capabilities: { marker: 'new' }, context: { marker: 'newctx' } };
    t.refreshProfile.mockResolvedValueOnce(fresh as never);
    await t.replanner.replan('output_change');
    expect(t.refreshProfile).toHaveBeenCalledTimes(1);
    expect(t.bodies[0]).toMatchObject({
      client_capabilities: fresh.capabilities,
      client_playback_context: fresh.context,
    });
    await t.replanner.replan('track_change');
    expect(t.refreshProfile).toHaveBeenCalledTimes(1);
  });

  it('adopts a playable plan with the session id from the answer and reports applied', async () => {
    const t = setup([{ ...playableDecision(planN(2), 'session-2') }]);
    expect(await t.replanner.replan('track_change')).toEqual({ kind: 'applied' });
    expect(t.adopt).toHaveBeenCalledWith(
      planN(2),
      'session-2',
      expect.objectContaining({ forceReload: false }),
    );
  });

  it('forces the reload after a failure recovery, not after other operations', async () => {
    const t = setup();
    await t.replanner.replan('failure_recovery');
    await t.replanner.replan('track_change');
    expect(t.adopt.mock.calls[0]![2]).toMatchObject({ forceReload: true });
    expect(t.adopt.mock.calls[1]![2]).toMatchObject({ forceReload: false });
  });

  it('hands back a terminal answer with its message and reason, and adopts nothing', async () => {
    const t = setup([terminalDecision('Nothing fits.')]);
    expect(await t.replanner.replan('track_change')).toEqual({
      kind: 'terminal',
      message: 'Nothing fits.',
      reason: 'adaptation_exhausted',
    });
    expect(t.adopt).not.toHaveBeenCalled();
  });

  it('maps a refused request through classifyRefusal, and a thrown error to transient', async () => {
    const t = setup([{ status: 410 }, { status: 503 }, 'throw', { status: 400 }]);
    expect(await t.replanner.replan('track_change')).toEqual({ kind: 'ended' });
    expect(await t.replanner.replan('track_change')).toEqual({ kind: 'transient' });
    expect(await t.replanner.replan('track_change')).toEqual({ kind: 'transient' });
    expect(await t.replanner.replan('track_change')).toEqual({ kind: 'refused' });
    // the replanning flag is released every time
    expect(t.replanner.isReplanning).toBe(false);
  });

  it('answers busy, not transient, when the session stopped while the request was out', async () => {
    const t = setup(['throw']);
    const pending = t.replanner.replan('track_change');
    t.world.stopped = true;
    expect(await pending).toEqual({ kind: 'busy' });

    const ok = setup();
    const done = ok.replanner.replan('track_change');
    ok.world.stopped = true;
    expect(await done).toEqual({ kind: 'busy' });
    expect(ok.adopt).not.toHaveBeenCalled();
  });
});

describe('Replanner recovery budget', () => {
  it('allows MAX_RECOVERIES failure recoveries, then answers loop without sending', async () => {
    const t = setup();
    for (let i = 1; i <= MAX_RECOVERIES; i += 1) {
      // every answer brings a plan not tried before
      t.world.state = { ...t.world.state, attemptedKeys: ['k1'] };
      expect(await t.replanner.replan('failure_recovery')).toEqual({ kind: 'applied' });
      expect(t.bodies[i - 1]!.attempt_count).toBe(i);
    }
    expect(await t.replanner.replan('failure_recovery')).toEqual({ kind: 'loop' });
    expect(await t.replanner.replan('seek_failure_recovery')).toEqual({ kind: 'loop' });
    expect(t.post).toHaveBeenCalledTimes(MAX_RECOVERIES);
  });

  it('counts a recovery that came back refused, and a seek recovery too', async () => {
    const t = setup([{ status: 503 }]);
    await t.replanner.replan('failure_recovery');
    await t.replanner.replan('seek_failure_recovery');
    expect(t.bodies[1]!.attempt_count).toBe(2);
  });

  it('does not count track, quality or seek replans against the budget', async () => {
    const t = setup();
    for (let i = 0; i < MAX_RECOVERIES + 2; i += 1) {
      expect(await t.replanner.replan('track_change')).toEqual({ kind: 'applied' });
    }
    expect(t.bodies.every((body) => body.attempt_count === 1)).toBe(true);
    expect(await t.replanner.replan('failure_recovery')).toEqual({ kind: 'applied' });
  });

  it('starts over after resetRecoveries', async () => {
    const t = setup();
    for (let i = 0; i < MAX_RECOVERIES; i += 1) {
      t.world.state = { ...t.world.state, attemptedKeys: [] };
      await t.replanner.replan('failure_recovery');
    }
    t.replanner.resetRecoveries();
    t.world.state = { ...t.world.state, attemptedKeys: [] };
    expect(await t.replanner.replan('failure_recovery')).toEqual({ kind: 'applied' });
    expect(t.bodies.at(-1)!.attempt_count).toBe(1);
  });

  it('calls a recovery plan that was already tried a loop, but not a track change', async () => {
    const t = setup([playableDecision(planN(1)), playableDecision(planN(1))]);
    expect(await t.replanner.replan('failure_recovery')).toEqual({ kind: 'loop' });
    expect(t.adopt).not.toHaveBeenCalled();
    expect(await t.replanner.replan('track_change')).toEqual({ kind: 'applied' });
    expect(t.adopt).toHaveBeenCalledTimes(1);
  });
});

describe('Replanner quality changes', () => {
  it('takes the pick as the preference and remembers the one before for a new load', async () => {
    const t = setup();
    t.world.adoptReloads = true;
    t.world.state = { ...t.world.state, quality: '1080p' };
    expect(await t.replanner.qualityChange('480p')).toEqual({ kind: 'applied' });
    expect(t.setQuality).toHaveBeenCalledWith('480p');
    expect(t.replanner.takeQualityLoad()).toEqual({ loadId: 2, previous: '1080p' });
    // taken once: a second take finds nothing
    expect(t.replanner.takeQualityLoad()).toBeNull();
  });

  it('names auto as the previous quality when none was decided', async () => {
    const t = setup();
    t.world.adoptReloads = true;
    await t.replanner.qualityChange('720p');
    expect(t.replanner.takeQualityLoad()).toMatchObject({ previous: 'auto' });
  });

  it('has no way back when the new plan did not start a new load', async () => {
    const t = setup();
    await t.replanner.qualityChange('720p');
    expect(t.setQuality).toHaveBeenCalledWith('720p');
    expect(t.replanner.takeQualityLoad()).toBeNull();
  });

  it('counts a fallback, and the way back itself has no way back', async () => {
    const t = setup();
    t.world.adoptReloads = true;
    expect(t.replanner.qualityFallbacks).toBe(0);
    await t.replanner.replan('quality_change', { quality: '1080p', fallback: true });
    expect(t.replanner.qualityFallbacks).toBe(1);
    expect(t.replanner.takeQualityLoad()).toBeNull();
    await t.replanner.replan('quality_change', { quality: 'auto', fallback: true });
    expect(t.replanner.qualityFallbacks).toBe(2);
  });

  it('does not count a fallback flag on another operation, and clears a stale load on a non-pick', async () => {
    const t = setup();
    t.world.adoptReloads = true;
    await t.replanner.qualityChange('480p');
    await t.replanner.replan('track_change', { fallback: true });
    expect(t.replanner.qualityFallbacks).toBe(0);
    expect(t.replanner.takeQualityLoad()).toBeNull();
  });

  it('leaves the preference alone when the answer is refused', async () => {
    const t = setup([{ status: 400 }]);
    t.world.adoptReloads = true;
    expect(await t.replanner.qualityChange('480p')).toEqual({ kind: 'refused' });
    expect(t.setQuality).not.toHaveBeenCalled();
    expect(t.replanner.takeQualityLoad()).toBeNull();
  });
});

describe('Replanner settle (viewer-asked replans)', () => {
  it('fails the session on a terminal answer, with the reason as the code', async () => {
    const t = setup([terminalDecision('Nothing fits.')]);
    await t.replanner.trackChange({});
    expect(t.fail).toHaveBeenCalledWith('terminal', 'Nothing fits.', 'adaptation_exhausted');
  });

  it('reports the session gone on a 410', async () => {
    const t = setup([{ status: 410 }]);
    await t.replanner.qualityChange('480p');
    expect(t.sessionGone).toHaveBeenCalledTimes(1);
  });

  it('restarts at the playing position when the server does not know the session', async () => {
    const t = setup([{ status: 404, code: 'session_not_found' }]);
    expect(await t.replanner.trackChange({})).toEqual({ kind: 'gone' });
    expect(t.restartAt).toHaveBeenCalledWith(100);
  });

  it('restarts at the start position when the player has no reading', async () => {
    const t = setup([{ status: 404, code: 'session_not_found' }]);
    t.world.reading = null;
    await t.replanner.qualityChange('480p');
    expect(t.restartAt).toHaveBeenCalledWith(30);
  });

  it.each([
    ['transient', { status: 503 }],
    ['refused', { status: 400 }],
  ] as const)('drops the request after a %s result and does nothing else', async (kind, answer) => {
    const t = setup([answer]);
    expect(await t.replanner.trackChange({})).toEqual({ kind });
    expect(t.fail).not.toHaveBeenCalled();
    expect(t.sessionGone).not.toHaveBeenCalled();
    expect(t.restartAt).not.toHaveBeenCalled();
  });

  it('does nothing after an applied replan', async () => {
    const t = setup();
    await t.replanner.trackChange({});
    expect(t.fail).not.toHaveBeenCalled();
    expect(t.sessionGone).not.toHaveBeenCalled();
    expect(t.restartAt).not.toHaveBeenCalled();
  });

  it('sends the track change with the selected tracks the viewer picked', async () => {
    const t = setup();
    await t.replanner.trackChange({ audio: { id: 'a2', index: 1 } });
    expect(t.bodies[0]).toMatchObject({
      operation: 'track_change',
      selected_tracks: { audio: { id: 'a2', index: 1 } },
    });
  });
});

describe('Replanner.seekTo', () => {
  function engine(seekable: { start: number; end: number }[], duration = 5400) {
    return { seek: vi.fn(), duration, seekable } as unknown as PlayerEngine & {
      seek: ReturnType<typeof vi.fn>;
    };
  }
  const plan = (anywhere: boolean, offset = 0) =>
    playbackPlan({
      timeline: {
        can_seek_anywhere: anywhere,
        player_start_seconds: 0,
        seek_restoration: 'player_position',
        source_start_seconds: 0,
        stream_origin_seconds: 0,
        timeline_offset_seconds: offset,
      },
    });

  it('seeks the player directly where the plan lets it, clamped to the ends', async () => {
    const e = engine([]);
    const t = setup([], { engine: e });
    t.world.plan = plan(true, 10);
    await t.replanner.seekTo(100);
    expect(e.seek).toHaveBeenLastCalledWith(90);
    await t.replanner.seekTo(-50);
    expect(e.seek).toHaveBeenLastCalledWith(0);
    await t.replanner.seekTo(99_999);
    expect(e.seek).toHaveBeenLastCalledWith(5400);
    expect(t.post).not.toHaveBeenCalled();
  });

  it('seeks the player inside the seekable range and asks the server outside it', async () => {
    const e = engine([{ start: 0, end: 600 }]);
    const t = setup([], { engine: e });
    t.world.plan = plan(false);
    await t.replanner.seekTo(300);
    expect(e.seek).toHaveBeenCalledWith(300);
    expect(t.post).not.toHaveBeenCalled();
    await t.replanner.seekTo(2000);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.bodies[0]).toMatchObject({ operation: 'seek_reanchor', position_seconds: 2000 });
  });

  it('clamps a reanchor position to the source runtime, and restarts there when the session is gone', async () => {
    const e = engine([]);
    const t = setup([{ status: 404, code: 'session_not_found' }], { engine: e });
    t.world.plan = plan(false);
    await t.replanner.seekTo(99_999);
    expect(t.bodies[0]!.position_seconds).toBe(5400);
    expect(t.restartAt).toHaveBeenCalledWith(5400);
  });

  it('drops the seek while a reconnect runs, while stopped, and without a plan or engine', async () => {
    const e = engine([]);
    const active = setup([], { engine: e });
    active.world.plan = plan(true);
    active.world.recoveryActive = true;
    await active.replanner.seekTo(10);

    const stopped = setup([], { engine: e });
    stopped.world.plan = plan(true);
    stopped.world.stopped = true;
    await stopped.replanner.seekTo(10);

    const noEngine = setup([], { engine: null });
    noEngine.world.plan = plan(true);
    await noEngine.replanner.seekTo(10);

    const noPlan = setup([], { engine: e });
    noPlan.world.plan = null;
    await noPlan.replanner.seekTo(10);

    expect(e.seek).not.toHaveBeenCalled();
    expect(active.post).not.toHaveBeenCalled();
  });
});

describe('Replanner request contract', () => {
  it('allows exactly 8 failure recoveries (protocol section 6)', () => {
    expect(MAX_RECOVERIES).toBe(8);
  });

  it('carries the client features and the session id in the path', async () => {
    const t = setup();
    await t.replanner.replan('track_change');
    expect(t.bodies[0]!.client_features).toEqual(CLIENT_FEATURES);
    expect(t.bodies[0]!.client_features).not.toEqual([]);
    expect(JSON.parse(t.paths[0]!)).toEqual({ session_id: 'session-1' });
  });

  it('answers busy and sends nothing without the capabilities, and without the context', async () => {
    const noCaps = setup();
    noCaps.world.capabilities = null;
    expect(await noCaps.replanner.replan('track_change')).toEqual({ kind: 'busy' });
    expect(noCaps.post).not.toHaveBeenCalled();
    const noContext = setup();
    noContext.world.context = null;
    expect(await noContext.replanner.replan('track_change')).toEqual({ kind: 'busy' });
    expect(noContext.post).not.toHaveBeenCalled();
  });

  it('takes no quality preference from a quality change without one, or from another operation', async () => {
    const t = setup();
    t.world.adoptReloads = true;
    await t.replanner.replan('quality_change', {});
    expect(t.setQuality).not.toHaveBeenCalled();
    expect(t.replanner.takeQualityLoad()).toBeNull();
    await t.replanner.replan('track_change', { quality: 'x' });
    expect(t.setQuality).not.toHaveBeenCalled();
    expect(t.bodies[1]!.quality_preference).toBe('x');
  });

  it('passes the caller forceReload and autoplay on to adopt for a non-recovery operation', async () => {
    const t = setup();
    await t.replanner.replan('track_change', { forceReload: true, autoplay: false });
    expect(t.adopt.mock.calls[0]![2]).toEqual({ forceReload: true, autoplay: false });
  });

  it('keeps no quality load for a track change, even when its adopt starts a new load', async () => {
    const t = setup();
    t.world.adoptReloads = true;
    await t.replanner.replan('track_change');
    expect(t.replanner.takeQualityLoad()).toBeNull();
  });

  it('is terminal, not applied, when a non-playable outcome still carries a plan', async () => {
    const decision = { ...terminalDecision('No.'), playback_plan: planN(2) };
    const t = setup([decision]);
    expect(await t.replanner.replan('track_change')).toEqual({
      kind: 'terminal',
      message: 'No.',
      reason: 'adaptation_exhausted',
    });
    expect(t.adopt).not.toHaveBeenCalled();
  });

  it('restarts at the reading position after a quality change that ends gone', async () => {
    const t = setup([{ status: 404, code: 'session_not_found' }]);
    expect(await t.replanner.qualityChange('480p')).toEqual({ kind: 'gone' });
    expect(t.restartAt).toHaveBeenCalledWith(100);
  });
});

describe('Replanner.seekTo arithmetic and guards', () => {
  const timeline = (anywhere: boolean, offset: number) =>
    playbackPlan({
      timeline: {
        can_seek_anywhere: anywhere,
        player_start_seconds: 0,
        seek_restoration: 'player_position',
        source_start_seconds: 0,
        stream_origin_seconds: 0,
        timeline_offset_seconds: offset,
      },
    });
  const engineOf = (duration: number, seekable: { start: number; end: number }[] = []) =>
    ({ seek: vi.fn(), duration, seekable }) as unknown as PlayerEngine & {
      seek: ReturnType<typeof vi.fn>;
    };

  it('does not seek while a slow replan runs', async () => {
    const e = engineOf(5400);
    const t = setup([], { engine: e });
    t.world.plan = timeline(true, 0);
    const slow = t.replanner.replan('track_change');
    await t.replanner.seekTo(10);
    await slow;
    expect(e.seek).not.toHaveBeenCalled();
  });

  it('adds the origin and subtracts the offset for a direct seek, and clamps at the origin and the duration', async () => {
    const e = engineOf(5000);
    const t = setup([], { engine: e });
    t.world.plan = timeline(true, 10);
    t.world.origin = 100;
    await t.replanner.seekTo(200);
    expect(e.seek).toHaveBeenLastCalledWith(290);
    await t.replanner.seekTo(0);
    expect(e.seek).toHaveBeenLastCalledWith(100);
    await t.replanner.seekTo(99_999);
    expect(e.seek).toHaveBeenLastCalledWith(5000);
  });

  it('checks the seekable range on the engine timeline (origin and offset applied)', async () => {
    const e = engineOf(5000, [{ start: 150, end: 400 }]);
    const t = setup([], { engine: e });
    t.world.plan = timeline(false, 10);
    t.world.origin = 100;
    await t.replanner.seekTo(250);
    expect(e.seek).toHaveBeenCalledWith(340);
    expect(t.post).not.toHaveBeenCalled();
    // 100 + 20 - 10 = 110 is outside the range: the server moves the timeline
    await t.replanner.seekTo(20);
    expect(t.post).toHaveBeenCalledTimes(1);
  });

  it.each([Number.NaN, Infinity])(
    'clamps to the source runtime when the engine duration is %s',
    async (duration) => {
      const e = engineOf(duration);
      const t = setup([], { engine: e });
      t.world.plan = timeline(true, 10);
      t.world.origin = 100;
      await t.replanner.seekTo(99_999);
      // origin + runtime (5400) - offset
      expect(e.seek).toHaveBeenCalledWith(5490);
    },
  );

  it('does not clamp at all when neither the engine nor the plan knows a length', async () => {
    const e = engineOf(Infinity);
    const t = setup([], { engine: e });
    const p = timeline(true, 0);
    p.source = { ...p.source, duration_seconds: undefined };
    t.world.plan = p;
    await t.replanner.seekTo(99_999);
    expect(e.seek).toHaveBeenCalledWith(99_999);
  });

  it('sends position 0 for a negative seek that goes through the server', async () => {
    const t = setup([], { engine: engineOf(5400) });
    t.world.plan = timeline(false, 0);
    await t.replanner.seekTo(-5);
    expect(t.bodies[0]).toMatchObject({ operation: 'seek_reanchor', position_seconds: 0 });
  });
});

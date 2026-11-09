import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../api/session';
import { SiloProvider } from '../app/SiloContext';
import { BASE_URL, account } from '../test/apiFixtures';
import {
  ACCESS_TOKEN,
  INSTALLATION_ID,
  LOWER_UUID,
  SESSION_ID,
  playableDecision,
  playbackCapabilities,
  playbackPlan,
  servePlayback,
  terminalDecision,
  until,
  watchDetail,
  watchUserData,
} from '../test/playbackFixtures';
import { memoryStorage, testDevice } from '../test/renderFlow';
import { setResumeRewind } from './resumeRewind';
import type { StartIntent } from './resume';
import {
  PROGRESS_INTERVAL_MS,
  clearInstallationCache,
  usePlaybackSession,
  type PlayerReading,
} from './usePlaybackSession';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
const hooks: { unmount(): void }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  // Leaving a screen stops its session; let that request finish before the next test.
  for (const hook of hooks.splice(0)) hook.unmount();
  await new Promise((resolve) => setTimeout(resolve, 50));
  server.resetHandlers();
});
afterAll(() => server.close());
beforeEach(() => {
  // The rewind setting lives in the device storage; every test starts on its default (7 s).
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

function setup(intent?: StartIntent) {
  const session = signedIn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
      {children}
    </SiloProvider>
  );
  const hook = renderHook(() => usePlaybackSession('m1', intent), { wrapper });
  hooks.push(hook);
  return hook;
}

async function ready(hook: ReturnType<typeof setup>) {
  await waitFor(() => expect(hook.result.current.state.kind).toBe('ready'));
}

/** A player that reports a settable position. */
function player(position = 42) {
  const reading: PlayerReading = { position, paused: false };
  return { reading, read: () => ({ ...reading }) };
}

describe('capabilities gate', () => {
  it.each([
    ['protocol 3 is missing', playbackCapabilities({ protocol_versions: [2] })],
    ['sequenced progress is missing', playbackCapabilities({ features: ['playback_plan_v3'] })],
    ['playback is not allowed', playbackCapabilities({ allowed: false })],
    ['the state is not available', playbackCapabilities({ state: 'not_configured' })],
  ])('refuses the server when %s, and starts nothing', async (_name, capabilities) => {
    const calls = servePlayback(server, { capabilities });
    const hook = setup();
    await waitFor(() => expect(hook.result.current.state.kind).toBe('error'));
    expect(hook.result.current.state).toMatchObject({ reason: 'unsupported' });
    expect(calls.start).toHaveLength(0);
  });

  it('reads the capabilities once per server and keeps the installation id', async () => {
    const calls = servePlayback(server);
    const first = setup();
    await ready(first);
    first.unmount();
    const second = setup();
    await ready(second);
    expect(calls.capabilities).toBe(1);
    expect(calls.start[1]?.body.installation_id).toBe(INSTALLATION_ID);
  });
});

describe('start', () => {
  it('sends the v3 start request with the chosen file, defaults and the device profile', async () => {
    const calls = servePlayback(server, {
      watch: watchDetail({
        versions: [
          { ...watchDetail().versions[0]!, file_id: 'file-a' },
          { ...watchDetail().versions[0]!, file_id: 'file-b' },
        ],
        user_data: watchUserData({ last_file_id: 'file-b' }),
      }),
    });
    const hook = setup();
    await ready(hook);
    expect(calls.start).toHaveLength(1);
    const { body, headers } = calls.start[0]!;
    expect(body).toMatchObject({
      installation_id: INSTALLATION_ID,
      protocol_version: 3,
      client_features: ['playback_plan_v3'],
      file_id: 'file-b',
      profile_id: 'p1',
      quality_preference: 'auto',
      subtitle_fidelity_preference: 'compatible',
      start_position: 0,
    });
    expect(body.playback_attempt_id).toMatch(LOWER_UUID);
    expect(body.client_capabilities).toMatchObject({
      video_evidence: 'declared',
      audio_evidence: 'declared',
    });
    expect(body.client_playback_context).toMatchObject({ protocol_version: 3, form_factor: 'tv' });
    expect(headers.get('X-Profile-Id')).toBe('p1');
    expect(headers.get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('uses a fresh attempt id for every start', async () => {
    const calls = servePlayback(server);
    const first = setup();
    await ready(first);
    first.unmount();
    const second = setup();
    await ready(second);
    expect(calls.start[0]?.body.playback_attempt_id).not.toBe(
      calls.start[1]?.body.playback_attempt_id,
    );
  });

  it('starts from the beginning without a prompt when there is nothing to resume', async () => {
    for (const userData of [
      undefined,
      watchUserData({ position_seconds: 0 }),
      watchUserData({ position_seconds: 20 }),
      watchUserData({ position_seconds: 3511, duration_seconds: 3514 }),
    ]) {
      const calls = servePlayback(server, { watch: watchDetail({ user_data: userData }) });
      const hook = setup();
      await ready(hook);
      expect(calls.start.at(-1)?.body.start_position).toBe(0);
      hook.unmount();
    }
  });

  describe('one resume rule', () => {
    // The TV finding: the server keeps position and duration of an episode that counts as played.
    const rewatch = {
      watch: watchDetail({
        user_data: watchUserData({
          position_seconds: 362.464,
          played: true,
          duration_seconds: 3514,
        }),
      }),
    };

    it('asks for a played rewatch with a position, then resumes rewound', async () => {
      setResumeRewind(15);
      const calls = servePlayback(server, rewatch);
      const hook = setup();
      await waitFor(() => expect(hook.result.current.state.kind).toBe('prompt'));
      expect(hook.result.current.state).toMatchObject({ positionSeconds: 362 });
      expect(calls.start).toHaveLength(0);
      act(() => hook.result.current.resume());
      await ready(hook);
      expect(calls.start[0]?.body.start_position).toBe(347);
    });

    it('the prompt resumes at the saved point when the rewind is off, and starts over at 0', async () => {
      setResumeRewind(0);
      const calls = servePlayback(server, rewatch);
      const hook = setup();
      await waitFor(() => expect(hook.result.current.state.kind).toBe('prompt'));
      act(() => hook.result.current.resume());
      await ready(hook);
      expect(calls.start[0]?.body.start_position).toBe(362);
      hook.unmount();
      const again = setup();
      await waitFor(() => expect(again.result.current.state.kind).toBe('prompt'));
      act(() => again.result.current.choose(0));
      await waitFor(() => expect(calls.start).toHaveLength(2));
      expect(calls.start[1]?.body.start_position).toBe(0);
    });

    it('the intent resume starts rewound without a prompt', async () => {
      setResumeRewind(15);
      const calls = servePlayback(server, rewatch);
      const hook = setup({ kind: 'resume' });
      await ready(hook);
      expect(calls.start).toHaveLength(1);
      expect(calls.start[0]?.body.start_position).toBe(347);
    });

    it('the intent resume applies the default rewind of 7 s, never going below 0', async () => {
      const calls = servePlayback(server, rewatch);
      const hook = setup({ kind: 'resume' });
      await ready(hook);
      expect(calls.start[0]?.body.start_position).toBe(355);
    });

    it('the intent beginning starts at 0 without a prompt', async () => {
      const calls = servePlayback(server, rewatch);
      const hook = setup({ kind: 'beginning' });
      await ready(hook);
      expect(calls.start[0]?.body.start_position).toBe(0);
    });

    it.each([
      ['a position of 20 s', watchUserData({ position_seconds: 20 })],
      [
        'a position within 5 s of the end',
        watchUserData({ position_seconds: 3511, duration_seconds: 3514 }),
      ],
    ])('the intent resume starts at 0 for %s', async (_name, userData) => {
      const calls = servePlayback(server, { watch: watchDetail({ user_data: userData }) });
      const hook = setup({ kind: 'resume' });
      await ready(hook);
      expect(calls.start[0]?.body.start_position).toBe(0);
    });

    it('measures the end by the file duration when the watch state has none', async () => {
      const calls = servePlayback(server, {
        watch: watchDetail({ user_data: watchUserData({ position_seconds: 5398 }) }),
      });
      const hook = setup({ kind: 'resume' });
      await ready(hook);
      expect(calls.start[0]?.body.start_position).toBe(0);
    });
  });

  it('asks before resuming, and starts at the chosen position', async () => {
    const calls = servePlayback(server, {
      watch: watchDetail({ user_data: watchUserData({ position_seconds: 1234.5 }) }),
    });
    const hook = setup();
    await waitFor(() => expect(hook.result.current.state.kind).toBe('prompt'));
    expect(hook.result.current.state).toMatchObject({ positionSeconds: 1234 });
    expect(calls.start).toHaveLength(0);
    act(() => hook.result.current.choose(1234.5));
    await ready(hook);
    expect(calls.start[0]?.body.start_position).toBe(1234.5);
  });

  it('turns the plan URL into a media URL: the token only on the server origin', async () => {
    servePlayback(server);
    const own = setup();
    await ready(own);
    const state = own.result.current.state;
    expect(state.kind === 'ready' && state.mediaUrl).toBe(
      `${BASE_URL}/api/v2/stream/${SESSION_ID}?st=signed-1&token=${ACCESS_TOKEN}`,
    );
    own.unmount();

    const proxy = 'https://proxy.example.test/stream/v3/s1/master.m3u8';
    servePlayback(server, {
      start: [
        playableDecision(
          playbackPlan({
            stream: { header_refresh: 'none', headers: {}, protocol: 'hls', url: proxy },
          }),
        ),
      ],
    });
    const other = setup();
    await ready(other);
    const otherState = other.result.current.state;
    expect(otherState.kind === 'ready' && otherState.mediaUrl).toBe(proxy);
  });

  it('shows the terminal message of a refused plan, with no media', async () => {
    servePlayback(server, { start: [terminalDecision('No route fits.')] });
    const hook = setup();
    await waitFor(() => expect(hook.result.current.state.kind).toBe('error'));
    expect(hook.result.current.state).toMatchObject({
      reason: 'terminal',
      message: 'No route fits.',
    });
  });

  it('reads the capabilities again and retries once after installation_changed', async () => {
    const calls = servePlayback(server);
    let starts = 0;
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/start`, async () => {
        starts += 1;
        if (starts === 1) {
          return HttpResponse.json(
            { type: 'x/installation_changed', title: 'installation_changed', status: 409 },
            { status: 409 },
          );
        }
        return HttpResponse.json(playableDecision(), { status: 201 });
      }),
    );
    const hook = setup();
    await ready(hook);
    expect(starts).toBe(2);
    expect(calls.capabilities).toBe(2);
  });

  it('stops a session that was created after the screen was left', async () => {
    const calls = servePlayback(server, { startDelayMs: 50 });
    const hook = setup();
    await until(() => calls.start.length === 1);
    hook.unmount();
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.sessionId).toBe(SESSION_ID);
    expect(calls.stop[0]?.body.stop_id).toMatch(LOWER_UUID);
    expect(calls.stop[0]?.body).not.toHaveProperty('sequence');
  });
});

describe('progress', () => {
  it('reports every 10 s while playing with a strictly increasing sequence', async () => {
    const calls = servePlayback(server);
    const hook = setup();
    await ready(hook);
    const p = player(42);
    hook.result.current.bindPlayer(p.read);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    act(() => hook.result.current.onPlaying());

    const quiet = () => new Promise((resolve) => setTimeout(resolve, 30));
    expect(PROGRESS_INTERVAL_MS).toBe(10_000);
    vi.advanceTimersByTime(9_999);
    await quiet();
    expect(calls.progress).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await until(() => calls.progress.length === 1);
    await quiet();
    expect(calls.progress).toHaveLength(1);
    p.reading.position = 52;
    vi.advanceTimersByTime(10_000);
    await until(() => calls.progress.length === 2);
    await quiet();
    expect(calls.progress).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    await until(() => calls.progress.length === 3);

    expect(calls.progress.map((c) => c.body.sequence)).toEqual([1, 2, 3]);
    expect(calls.progress[0]?.sessionId).toBe(SESSION_ID);
    expect(calls.progress[0]?.body).toMatchObject({
      installation_id: INSTALLATION_ID,
      position: 42,
      is_paused: false,
    });
    expect(calls.progress[1]?.body.position).toBe(52);
  });

  it('reports at once on pause and on resume, and stays quiet while paused', async () => {
    const calls = servePlayback(server);
    const hook = setup();
    await ready(hook);
    const p = player(30);
    hook.result.current.bindPlayer(p.read);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    act(() => hook.result.current.onPlaying());
    expect(calls.progress).toHaveLength(0);

    p.reading.position = 31;
    act(() => hook.result.current.onPause());
    await until(() => calls.progress.length === 1);
    expect(calls.progress[0]?.body).toMatchObject({ position: 31, is_paused: true, sequence: 1 });

    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 3);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.progress).toHaveLength(1);

    act(() => hook.result.current.onPlaying());
    await until(() => calls.progress.length === 2);
    expect(calls.progress[1]?.body).toMatchObject({ is_paused: false, sequence: 2 });
  });
});

describe('stop', () => {
  it('sends the final position with the next sequence and a lowercase stop_id', async () => {
    const calls = servePlayback(server);
    const hook = setup();
    await ready(hook);
    const p = player(77);
    hook.result.current.bindPlayer(p.read);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    act(() => hook.result.current.onPlaying());
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS);
    await until(() => calls.progress.length === 1);

    p.reading.position = 88.5;
    p.reading.paused = true;
    await act(() => hook.result.current.stop());
    expect(calls.stop).toHaveLength(1);
    expect(calls.stop[0]?.sessionId).toBe(SESSION_ID);
    expect(calls.stop[0]?.body).toMatchObject({
      installation_id: INSTALLATION_ID,
      sequence: 2,
      position: 88.5,
      is_paused: true,
    });
    expect(calls.stop[0]?.body.stop_id).toMatch(LOWER_UUID);

    // A second stop, and the unmount that follows, send nothing more.
    await act(() => hook.result.current.stop());
    hook.unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.stop).toHaveLength(1);
  });

  it('mints a stop_id that is not the attempt id and differs between sessions', async () => {
    const calls = servePlayback(server);
    const first = setup();
    await ready(first);
    await act(() => first.result.current.stop());
    const second = setup();
    await ready(second);
    await act(() => second.result.current.stop());
    expect(calls.stop).toHaveLength(2);
    const [a, b] = calls.stop.map((c) => c.body.stop_id);
    expect(a).toMatch(LOWER_UUID);
    expect(b).toMatch(LOWER_UUID);
    expect(a).not.toBe(b);
    expect(a).not.toBe(calls.start[0]?.body.playback_attempt_id);
    expect(b).not.toBe(calls.start[1]?.body.playback_attempt_id);
  });

  it('stops on unmount with the last known position', async () => {
    const calls = servePlayback(server);
    const hook = setup();
    await ready(hook);
    hook.result.current.bindPlayer(player(61).read);
    hook.unmount();
    await until(() => calls.stop.length === 1);
    expect(calls.stop[0]?.body).toMatchObject({ position: 61, sequence: 1 });
    expect(calls.stop[0]?.body.stop_id).toMatch(LOWER_UUID);
  });

  it('stops no more progress after the stop', async () => {
    const calls = servePlayback(server);
    const hook = setup();
    await ready(hook);
    hook.result.current.bindPlayer(player().read);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    act(() => hook.result.current.onPlaying());
    await act(() => hook.result.current.stop());
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 3);
    act(() => hook.result.current.onPause());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.progress).toHaveLength(0);
  });
});

describe('failure-driven replan', () => {
  const failure = { code: 3, message: 'decode failed' };

  it('sends exactly one replan on the first MediaError and loads the new plan', async () => {
    const calls = servePlayback(server, {
      replan: [
        playableDecision(
          playbackPlan({
            plan_id: 'plan:2',
            plan_attempt_key: 'v3:key-2',
            delivery: 'server_remux_hls',
            stream: {
              header_refresh: 'none',
              headers: {},
              protocol: 'hls',
              url: `/api/v2/playback/transcode/${SESSION_ID}/master.m3u8`,
            },
          }),
        ),
      ],
    });
    const hook = setup();
    await ready(hook);
    const first = hook.result.current.state;
    hook.result.current.bindPlayer(player(120).read);
    act(() => hook.result.current.onPlaying());

    act(() => hook.result.current.onMediaError(failure));
    await until(() => calls.replan.length === 1);
    await waitFor(() => {
      const state = hook.result.current.state;
      expect(state.kind === 'ready' && state.plan.plan_id).toBe('plan:2');
    });

    const { sessionId, body } = calls.replan[0]!;
    expect(sessionId).toBe(SESSION_ID);
    expect(body).toMatchObject({
      installation_id: INSTALLATION_ID,
      protocol_version: 3,
      operation: 'failure_recovery',
      failure: { classification: 'decoder_failure', message: 'decode failed' },
      failed_plan_id: 'plan:1',
      plan_attempt_key: 'v3:key-1',
      attempted_plan_keys: ['v3:key-1'],
      attempt_count: 1,
      position_seconds: 120,
      quality_preference: 'auto',
      selected_tracks: { audio: { id: 'file:1:audio:0', index: 0 } },
    });
    expect(body.replan_request_id).toMatch(LOWER_UUID);
    expect(body.plan_attempt_id).toMatch(LOWER_UUID);
    expect(body.playback_attempt_id).toBe(calls.start[0]?.body.playback_attempt_id);
    expect(hook.result.current.mediaError).toEqual(failure);

    const next = hook.result.current.state;
    expect(next.kind === 'ready' && first.kind === 'ready' && next.loadId > first.loadId).toBe(
      true,
    );
    expect(next.kind === 'ready' && next.mediaUrl).toContain('/master.m3u8');
  });

  it('ends in the error state on the second failure and sends no second replan', async () => {
    const calls = servePlayback(server);
    const hook = setup();
    await ready(hook);
    act(() => hook.result.current.onMediaError(failure));
    await waitFor(() => {
      const state = hook.result.current.state;
      expect(state.kind === 'ready' && state.plan.plan_id).toBe('plan:2');
    });
    act(() => hook.result.current.onMediaError({ code: 4, message: 'again' }));
    await waitFor(() => expect(hook.result.current.state.kind).toBe('error'));
    expect(hook.result.current.state).toMatchObject({ reason: 'failed' });
    expect(calls.replan).toHaveLength(1);
  });

  it('counts one failure once, even when the engine reports it twice in a row', async () => {
    const calls = servePlayback(server);
    const hook = setup();
    await ready(hook);
    act(() => {
      hook.result.current.onMediaError(failure);
      hook.result.current.onMediaError(failure);
    });
    await waitFor(() => {
      const state = hook.result.current.state;
      expect(state.kind === 'ready' && state.plan.plan_id).toBe('plan:2');
    });
    expect(calls.replan).toHaveLength(1);
  });

  it('classifies a network error as a transport stall', async () => {
    const calls = servePlayback(server);
    const hook = setup();
    await ready(hook);
    act(() => hook.result.current.onMediaError({ code: 2, message: 'network' }));
    await until(() => calls.replan.length === 1);
    expect(calls.replan[0]?.body.failure).toMatchObject({ classification: 'transport_stall' });
  });

  it('shows the terminal answer of a replan', async () => {
    servePlayback(server, { replan: [terminalDecision('Nothing else works.')] });
    const hook = setup();
    await ready(hook);
    act(() => hook.result.current.onMediaError(failure));
    await waitFor(() => expect(hook.result.current.state.kind).toBe('error'));
    expect(hook.result.current.state).toMatchObject({
      reason: 'terminal',
      message: 'Nothing else works.',
    });
  });
});

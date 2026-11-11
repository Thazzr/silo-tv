// The subtitle a playback starts with and follows an audio change with: the controller resolves it
// from the profile's subtitle settings (Silo's server names none by itself) and sends it as a
// `track_change`. Driven through the controller against MSW, like the other session tests.
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSiloClient } from '../api/client';
import type { components } from '../api/generated/schema';
import { Session } from '../api/session';
import { currentTransport } from '../api/transport';
import { BASE_URL, account } from '../test/apiFixtures';
import { FakeEngine } from '../test/fakeEngine';
import {
  ACCESS_TOKEN,
  playableDecision,
  playbackPlan,
  until,
  servePlayback,
  terminalDecision,
  watchDetail,
  watchVersion,
  type PlaybackServerOptions,
} from '../test/playbackFixtures';
import { memoryStorage, testDevice } from '../test/renderFlow';
import type { StartIntent } from './resume';
import { PlaybackController } from './session/PlaybackController';
import { clearInstallationCache } from './session/startSession';
import type { SessionState } from './session/types';
import type { SubtitleDefaults } from './subtitleAuto';

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

// Audio 0 is German, audio 1 English. The inventory has a full and a forced track of each.
const AUDIO: S['WatchAudioTrack'][] = [
  { default: true, language: 'de', codec: 'ac3', channels: 6 },
  { default: false, language: 'en', codec: 'aac', channels: 2 },
];
const DE_FULL = 'sub:0';
const DE_FORCED = 'sub:1';
const EN_FULL = 'sub:2';
const EN_FORCED = 'sub:3';

const subtitle = (n: number, over: Partial<S['SubtitleInventoryItemV3']>) => ({
  track_id: `sub:${n}`,
  combined_index: n,
  source: 'embedded',
  forced: false,
  default: false,
  hearing_impaired: false,
  delivery: 'sidecar',
  codec: 'srt',
  ...over,
});
const INVENTORY = [
  subtitle(0, { language: 'de' }),
  subtitle(1, { language: 'de', forced: true }),
  subtitle(2, { language: 'en' }),
  subtitle(3, { language: 'en', forced: true }),
];

const audioId = (index: number) => ({ id: `file:file-1:audio:${index}`, index });
const subId = (id: string) => ({ id, index: Number(id.slice(4)) });

/** A plan on its own stream with the given tracks selected. */
const plan = (n: number, audio: number, subtitleId?: string) =>
  playbackPlan({
    plan_id: `plan:${n}`,
    plan_attempt_key: `v3:key-${n}`,
    selected_tracks: {
      audio: audioId(audio),
      ...(subtitleId ? { subtitle: subId(subtitleId) } : {}),
    },
    subtitle: { mode: 'sidecar', inventory: INVENTORY },
  });

const watch = (over: Partial<S['WatchDetail']> = {}) =>
  watchDetail({ versions: [watchVersion({ audio_tracks: AUDIO })], ...over });

const sentTracks = (call: { body: Json } | undefined) => call?.body.selected_tracks;

function make(
  options: {
    intent?: StartIntent;
    serve?: PlaybackServerOptions;
    defaults?: SubtitleDefaults;
  } = {},
) {
  const calls = servePlayback(server, {
    watch: watch(),
    start: [playableDecision(plan(1, 0))],
    ...options.serve,
  });
  const session = new Session(memoryStorage());
  session.set({
    accessToken: ACCESS_TOKEN,
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  const client = createSiloClient({
    baseUrl: BASE_URL,
    transport: currentTransport,
    session,
    device: testDevice,
  });
  const states: SessionState[] = [];
  const defaults = options.defaults;
  const controller = new PlaybackController({
    client,
    baseUrl: BASE_URL,
    session,
    contentId: 'm1',
    intent: options.intent,
    ...(defaults ? { subtitleDefaults: () => Promise.resolve(defaults) } : {}),
    onState: (state) => states.push(state),
    onMediaError: () => undefined,
    onEnded: () => undefined,
  });
  controllers.push(controller);
  const ready = () => {
    const state = states.at(-1);
    if (state?.kind !== 'ready') throw new Error(`not ready: ${state?.kind}`);
    return state;
  };
  return { calls, controller, states, ready };
}

/** Started: `begin()` returns once the start, and any change the settings asked for, is done. */
async function started(options: Parameters<typeof make>[0] = {}) {
  const ctx = make(options);
  await ctx.controller.begin();
  ctx.controller.attachEngine(new FakeEngine());
  return ctx;
}

const decision = (n: number, audio: number, subtitleId?: string) =>
  playableDecision(plan(n, audio, subtitleId));

describe('the subtitle at start', () => {
  it('starts German audio on the German forced track for a default profile: one track_change, one load', async () => {
    const { calls, states, ready } = await started({
      serve: { replan: [decision(2, 0, DE_FORCED)] },
    });
    // The start names no subtitle; the settings (auto, no language, forced on) pick the forced track.
    expect(calls.start[0]?.body).not.toHaveProperty('subtitle_track_id');
    expect(calls.start[0]?.body).not.toHaveProperty('subtitle_track_index');
    expect(calls.replan).toHaveLength(1);
    expect(calls.replan[0]?.body.operation).toBe('track_change');
    expect(sentTracks(calls.replan[0])).toEqual({
      audio: audioId(0),
      subtitle: subId(DE_FORCED),
    });
    // The screen never saw the plan without the subtitle: it waited for the changed one.
    expect(states.filter((state) => state.kind === 'ready')).toHaveLength(1);
    expect(ready().plan.plan_id).toBe('plan:2');
    expect(ready().plan.selected_tracks.subtitle?.id).toBe(DE_FORCED);
  });

  it('sends nothing when the profile has subtitles off and forced subtitles off', async () => {
    const { calls, ready } = await started({
      serve: {
        watch: watch({ effective_subtitle_mode: 'off', effective_show_forced_subtitles: false }),
      },
    });
    expect(calls.replan).toHaveLength(0);
    expect(ready().plan.plan_id).toBe('plan:1');
  });

  it('sends nothing when the inventory has no track for the profile', async () => {
    const { calls, ready } = await started({
      serve: { watch: watch({ effective_subtitle_language: 'ja' }) },
    });
    expect(calls.replan).toHaveLength(0);
    expect(ready().plan.plan_id).toBe('plan:1');
  });

  it('sends nothing when the plan already plays what the settings pick', async () => {
    const { calls, ready } = await started({
      serve: { start: [decision(1, 0, DE_FORCED)] },
    });
    expect(calls.replan).toHaveLength(0);
    expect(ready().plan.selected_tracks.subtitle?.id).toBe(DE_FORCED);
  });

  it('turns off a subtitle the plan plays when the settings pick none', async () => {
    const { calls, ready } = await started({
      serve: {
        watch: watch({ effective_subtitle_language: '' }),
        start: [decision(1, 0, DE_FORCED)],
        replan: [decision(2, 0)],
      },
    });
    expect(sentTracks(calls.replan[0])).toEqual({ audio: audioId(0) });
    expect(ready().plan.plan_id).toBe('plan:2');
  });

  it('shows the plan as it is when the change is refused, without a word', async () => {
    const refused: S['PlaybackDecision'] = {
      ...terminalDecision('No route shows it.'),
      terminal: {
        message: 'No route shows it.',
        reason: 'subtitle_codec_unsupported',
        retryable: false,
      },
    };
    const { calls, states, ready } = await started({ serve: { replan: [refused] } });
    expect(calls.replan).toHaveLength(1);
    expect(states.some((state) => state.kind === 'error')).toBe(false);
    expect(ready().plan.plan_id).toBe('plan:1');
    expect(ready().plan.selected_tracks.subtitle).toBeUndefined();
    expect(calls.stop).toHaveLength(0);
  });

  it('shows the plan as it is when the server fails on the change', async () => {
    const { controller, states, ready } = make();
    server.use(
      http.post(
        `${BASE_URL}/api/v2/playback/:sessionId/replan`,
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    await controller.begin();
    expect(states.some((state) => state.kind === 'error')).toBe(false);
    expect(ready().plan.plan_id).toBe('plan:1');
  });

  it("does not overrule a start that names the viewer's subtitle", async () => {
    const { calls, ready } = await started({
      intent: { kind: 'beginning', subtitle: subId(EN_FULL) },
      serve: { start: [decision(1, 0, EN_FULL)] },
    });
    expect(calls.start[0]?.body).toMatchObject({ subtitle_track_id: EN_FULL });
    expect(calls.replan).toHaveLength(0);
    expect(ready().plan.selected_tracks.subtitle?.id).toBe(EN_FULL);
  });
});

describe('where the settings come from', () => {
  it("falls back to the profile's settings when the title stores none", async () => {
    const { calls } = await started({
      defaults: { mode: 'always', language: 'en', showForced: true },
      serve: { replan: [decision(2, 0, EN_FULL)] },
    });
    expect(sentTracks(calls.replan[0])).toEqual({ audio: audioId(0), subtitle: subId(EN_FULL) });
  });

  it("prefers the title's own settings, field by field", async () => {
    const { calls } = await started({
      // The profile asks for no subtitles; this title stores mode always and English.
      defaults: { mode: 'off', language: 'fr', showForced: false },
      serve: {
        watch: watch({ effective_subtitle_mode: 'always', effective_subtitle_language: 'en' }),
        replan: [decision(2, 0, EN_FULL)],
      },
    });
    expect(sentTracks(calls.replan[0])).toEqual({ audio: audioId(0), subtitle: subId(EN_FULL) });
  });

  it('uses the remembered track in mode always, even when it is a forced one', async () => {
    const { calls } = await started({
      serve: {
        watch: watch({
          effective_subtitle_mode: 'always',
          effective_subtitle_language: 'en',
          effective_subtitle_track_signature: {
            source: 'embedded',
            language: 'en',
            codec: 'srt',
            forced: true,
            hearing_impaired: false,
          },
        }),
        replan: [decision(2, 0, EN_FORCED)],
      },
    });
    expect(sentTracks(calls.replan[0])).toEqual({ audio: audioId(0), subtitle: subId(EN_FORCED) });
  });

  it("judges by the language of the audio the plan plays, not the version's first", async () => {
    // The plan plays the English audio (index 1): the forced track is the English one.
    const { calls } = await started({
      serve: { start: [decision(1, 1)], replan: [decision(2, 1, EN_FORCED)] },
    });
    expect(sentTracks(calls.replan[0])).toEqual({ audio: audioId(1), subtitle: subId(EN_FORCED) });
  });

  it("takes the audio language from the version's effective language when the track names none", async () => {
    const { calls } = await started({
      serve: {
        watch: watchDetail({
          versions: [
            watchVersion({
              audio_tracks: [{ default: true }],
              effective_audio_track_index: 0,
              effective_audio_language: 'de',
            }),
          ],
        }),
        start: [decision(1, 0)],
        replan: [decision(2, 0, DE_FORCED)],
      },
    });
    expect(sentTracks(calls.replan[0])).toEqual({ audio: audioId(0), subtitle: subId(DE_FORCED) });
  });
});

describe('an audio change', () => {
  /** German audio on the German forced track; then the answers for the audio changes. */
  const afterStart = (...replans: S['PlaybackDecision'][]) => ({
    serve: { replan: [decision(2, 0, DE_FORCED), ...replans] },
  });

  it('moves the forced track to the new audio language in the same track_change, before a manual pick', async () => {
    const { controller, calls } = await started(afterStart(decision(3, 1, EN_FORCED)));
    // What the audio menu sends: the new audio and the subtitle the plan plays now.
    const result = await controller.trackChange(
      { audio: audioId(1), subtitle: subId(DE_FORCED) },
      'audio',
    );
    expect(result).toEqual({ kind: 'applied' });
    expect(calls.replan).toHaveLength(2);
    expect(sentTracks(calls.replan[1])).toEqual({ audio: audioId(1), subtitle: subId(EN_FORCED) });
  });

  it('keeps following the audio over several changes', async () => {
    const { controller, calls } = await started(
      afterStart(decision(3, 1, EN_FORCED), decision(4, 0, DE_FORCED)),
    );
    await controller.trackChange({ audio: audioId(1), subtitle: subId(DE_FORCED) }, 'audio');
    await controller.trackChange({ audio: audioId(0), subtitle: subId(EN_FORCED) }, 'audio');
    expect(sentTracks(calls.replan[2])).toEqual({ audio: audioId(0), subtitle: subId(DE_FORCED) });
  });

  it('leaves the subtitle as the viewer picked it, once they picked one', async () => {
    const { controller, calls } = await started(
      afterStart(decision(3, 0, DE_FULL), decision(4, 1, DE_FULL)),
    );
    await controller.trackChange({ audio: audioId(0), subtitle: subId(DE_FULL) }, 'subtitle');
    // The pick goes out as it is, not as the settings would choose.
    expect(sentTracks(calls.replan[1])).toEqual({ audio: audioId(0), subtitle: subId(DE_FULL) });
    await controller.trackChange({ audio: audioId(1), subtitle: subId(DE_FULL) }, 'audio');
    expect(sentTracks(calls.replan[2])).toEqual({ audio: audioId(1), subtitle: subId(DE_FULL) });
  });

  it('leaves subtitles off after the viewer turned them off', async () => {
    const { controller, calls } = await started(afterStart(decision(3, 0), decision(4, 1)));
    await controller.trackChange({ audio: audioId(0) }, 'subtitle');
    expect(sentTracks(calls.replan[1])).toEqual({ audio: audioId(0) });
    await controller.trackChange({ audio: audioId(1) }, 'audio');
    expect(sentTracks(calls.replan[2])).toEqual({ audio: audioId(1) });
  });

  it('does not choose again after the change at start was refused', async () => {
    const refused: S['PlaybackDecision'] = {
      ...terminalDecision('No route shows it.'),
      terminal: { message: 'No', reason: 'subtitle_codec_unsupported', retryable: false },
    };
    const { controller, calls } = await started({
      serve: { replan: [refused, decision(3, 1)] },
    });
    // The plan plays no subtitle; the audio pick is sent as it is, not with the English forced track.
    await controller.trackChange({ audio: audioId(1) }, 'audio');
    expect(sentTracks(calls.replan[1])).toEqual({ audio: audioId(1) });
  });

  it('keeps the tracks that play when the session starts anew, and does not choose again', async () => {
    const second = playableDecision(plan(5, 0, DE_FORCED), 'session-2');
    const { controller, calls, states, ready } = await started({
      serve: {
        start: [decision(1, 0), second],
        replan: [decision(2, 0, DE_FORCED), decision(6, 1, DE_FORCED)],
      },
    });
    // The server forgot the session: the next progress report is a 404 and a new attempt starts.
    server.use(
      http.post(`${BASE_URL}/api/v2/playback/:sessionId/progress`, () =>
        HttpResponse.json(
          { type: 'x/playback_session_not_found', title: 'x', status: 404 },
          { status: 404 },
        ),
      ),
    );
    controller.onPlaying();
    controller.onPause();
    await until(() => calls.start.length === 2);
    await until(() => ready().sessionId === 'session-2');
    expect(states.some((state) => state.kind === 'error')).toBe(false);
    // The new start carries the subtitle that played; the settings are not asked again.
    expect(calls.start[1]?.body).toMatchObject({ subtitle_track_id: DE_FORCED });
    expect(calls.replan).toHaveLength(1);
    await controller.trackChange({ audio: audioId(1), subtitle: subId(DE_FORCED) }, 'audio');
    expect(sentTracks(calls.replan[1])).toEqual({ audio: audioId(1), subtitle: subId(DE_FORCED) });
  });

  it('counts a refused subtitle pick as a pick: the settings do not choose again', async () => {
    const refused: S['PlaybackDecision'] = {
      ...terminalDecision('No route shows it.'),
      terminal: { message: 'No', reason: 'subtitle_codec_unsupported', retryable: false },
    };
    const { controller, calls } = await started(afterStart(refused, decision(4, 1, DE_FORCED)));
    expect(
      await controller.trackChange({ audio: audioId(0), subtitle: subId(DE_FULL) }, 'subtitle'),
    ).toEqual({ kind: 'refused' });
    await controller.trackChange({ audio: audioId(1), subtitle: subId(DE_FORCED) }, 'audio');
    expect(sentTracks(calls.replan[2])).toEqual({ audio: audioId(1), subtitle: subId(DE_FORCED) });
  });

  it('adopts a subtitle the server changed on its own, and stops choosing', async () => {
    // The change asks for the English forced track; the new plan plays the German full one.
    const { controller, calls, ready } = await started(
      afterStart(decision(3, 1, DE_FULL), decision(4, 0, DE_FULL)),
    );
    await controller.trackChange({ audio: audioId(1), subtitle: subId(DE_FORCED) }, 'audio');
    expect(sentTracks(calls.replan[1])).toEqual({ audio: audioId(1), subtitle: subId(EN_FORCED) });
    expect(ready().plan.selected_tracks.subtitle?.id).toBe(DE_FULL);
    await controller.trackChange({ audio: audioId(0), subtitle: subId(DE_FULL) }, 'audio');
    expect(sentTracks(calls.replan[2])).toEqual({ audio: audioId(0), subtitle: subId(DE_FULL) });
  });

  it('adopts a subtitle a quality change moved on its own, and stops choosing', async () => {
    const { controller, calls } = await started(
      afterStart(decision(3, 0, DE_FULL), decision(4, 1, DE_FULL)),
    );
    await controller.qualityChange('720p');
    await controller.trackChange({ audio: audioId(1), subtitle: subId(DE_FULL) }, 'audio');
    expect(sentTracks(calls.replan[2])).toEqual({ audio: audioId(1), subtitle: subId(DE_FULL) });
  });

  it('does not take a plan that keeps the subtitle for a change of the server', async () => {
    const { controller, calls } = await started(
      afterStart(decision(3, 0, DE_FORCED), decision(4, 1, EN_FORCED)),
    );
    await controller.qualityChange('720p');
    await controller.trackChange({ audio: audioId(1), subtitle: subId(DE_FORCED) }, 'audio');
    expect(sentTracks(calls.replan[2])).toEqual({ audio: audioId(1), subtitle: subId(EN_FORCED) });
  });

  it("sends the audio pick as it is when the viewer's start named the subtitle", async () => {
    const { controller, calls } = await started({
      intent: { kind: 'beginning', subtitle: subId(DE_FULL) },
      serve: { start: [decision(1, 0, DE_FULL)], replan: [decision(2, 1, DE_FULL)] },
    });
    await controller.trackChange({ audio: audioId(1), subtitle: subId(DE_FULL) }, 'audio');
    expect(sentTracks(calls.replan[0])).toEqual({ audio: audioId(1), subtitle: subId(DE_FULL) });
  });
});

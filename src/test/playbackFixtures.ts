// Typed fixtures and an MSW harness for playback tests. Fixtures are typed against the generated
// schema so a spec change breaks them instead of silently passing.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';

type S = components['schemas'];

export const INSTALLATION_ID = 'install-1';
export const SESSION_ID = 'session-12345678-abcd';
/** A recognisable access token, so tests can prove it never reaches the screen. */
export const ACCESS_TOKEN = 'secret-access-token-xyz';

export function playbackCapabilities(
  overrides: Partial<S['PlaybackCapabilities']> = {},
): S['PlaybackCapabilities'] {
  return {
    allowed: true,
    deliveries: ['original_http', 'server_remux_hls'],
    features: ['playback_plan_v3', 'sequenced_progress_v1'],
    installation_id: INSTALLATION_ID,
    protocol_versions: [3],
    revision: 'rev-1',
    state: 'available',
    ...overrides,
  };
}

export function watchVersion(
  overrides: Partial<S['WatchFileVersion']> = {},
): S['WatchFileVersion'] {
  return {
    added_at: '2026-01-01T00:00:00.000Z',
    bitrate: 8000,
    codec_audio: 'aac',
    codec_video: 'h264',
    container: 'mp4',
    duration_seconds: 5400,
    file_id: 'file-1',
    file_size: 1000,
    hdr: false,
    marker_segments: [],
    resolution: '1080p',
    trickplay_available: false,
    ...overrides,
  };
}

export function watchDetail(overrides: Partial<S['WatchDetail']> = {}): S['WatchDetail'] {
  return {
    content_id: 'm1',
    subtitles: [],
    title: 'First Title',
    type: 'movie',
    versions: [watchVersion()],
    ...overrides,
  };
}

export function watchUserData(overrides: Partial<S['WatchUserData']> = {}): S['WatchUserData'] {
  return {
    in_progress_count: 0,
    played: false,
    unplayed_count: 1,
    watched_count: 0,
    ...overrides,
  };
}

export function playbackPlan(overrides: Partial<S['PlaybackPlan']> = {}): S['PlaybackPlan'] {
  return {
    applied_quirks: [],
    available_qualities: [],
    claims: {
      audio: { atmos_preserved: false, passthrough: false },
      subtitles: { ass_styling_preserved: false, bitmap_overlay: false, bitmap_sidecar: false },
      video: { dolby_vision: false, hdr10: false, hdr10_plus: false, hlg: false },
    },
    decision_reason: 'validated_original_playback',
    degradation_warnings: [],
    delivery: 'original_http',
    effective_media_file_id: 'file-1',
    effective_recipe: { video_codec: 'h264', audio_codec: 'aac' },
    plan_attempt_key: 'v3:key-1',
    plan_id: 'plan:1',
    protocol_version: 3,
    requested_media_file_id: 'file-1',
    runtime_corrections: [],
    selected_tracks: { audio: { id: 'file:1:audio:0', index: 0 } },
    session_id: SESSION_ID,
    source: {
      dv_enhancement_layer: '',
      hdr10_plus: false,
      media_file_id: 'file-1',
      container: 'mp4',
      video_codec: 'h264',
      audio_codec: 'aac',
      duration_seconds: 5400,
    },
    stream: {
      container: 'mp4',
      header_refresh: 'none',
      headers: {},
      protocol: 'http',
      url: `/api/v2/stream/${SESSION_ID}?st=signed-1`,
    },
    subtitle: { inventory: [], mode: 'none' },
    subtitle_fidelity_policy: 'compatible',
    timeline: {
      can_seek_anywhere: true,
      player_start_seconds: 0,
      seek_restoration: 'player_position',
      source_start_seconds: 0,
      stream_origin_seconds: 0,
      timeline_offset_seconds: 0,
    },
    transformations: [],
    ...overrides,
  };
}

export function playableDecision(
  plan: S['PlaybackPlan'] = playbackPlan(),
  sessionId: string = SESSION_ID,
): S['PlaybackDecision'] {
  return {
    outcome: 'playable',
    playback_plan: plan,
    protocol_version: 3,
    server_features: [],
    session_id: sessionId,
  };
}

export function terminalDecision(message = 'No route fits.'): S['PlaybackDecision'] {
  return {
    outcome: 'adaptation_unavailable',
    protocol_version: 3,
    server_features: [],
    terminal: { message, reason: 'adaptation_exhausted', retryable: false },
  };
}

type Json = Record<string, unknown>;

export interface PlaybackCalls {
  capabilities: number;
  watch: number;
  start: { body: Json; headers: Headers }[];
  progress: { sessionId: string; body: Json }[];
  stop: { sessionId: string; body: Json }[];
  replan: { sessionId: string; body: Json }[];
}

export interface PlaybackServerOptions {
  capabilities?: S['PlaybackCapabilities'];
  watch?: S['WatchDetail'];
  /** Decisions the start call answers with, in order; the last one repeats. */
  start?: S['PlaybackDecision'][];
  /** Decisions the replan call answers with, in order; the last one repeats. */
  replan?: S['PlaybackDecision'][];
  /** Delays the start answer, to leave the screen while a start is in flight. */
  startDelayMs?: number;
}

/** Serves the playback endpoints of one test server and records what the client sent. */
export function servePlayback(
  server: SetupServer,
  options: PlaybackServerOptions = {},
): PlaybackCalls {
  const calls: PlaybackCalls = {
    capabilities: 0,
    watch: 0,
    start: [],
    progress: [],
    stop: [],
    replan: [],
  };
  const starts = options.start ?? [playableDecision()];
  // A recovery plan has a key of its own: a plan already tried is a loop to the client.
  const replans = options.replan ?? [
    playableDecision(playbackPlan({ plan_id: 'plan:2', plan_attempt_key: 'v3:key-2' })),
  ];
  const next = <T>(list: T[], seen: number): T => list[Math.min(seen, list.length - 1)]!;

  server.use(
    http.get(`${BASE_URL}/api/v2/playback/capabilities`, () => {
      calls.capabilities += 1;
      return HttpResponse.json(options.capabilities ?? playbackCapabilities());
    }),
    http.get(`${BASE_URL}/api/v2/watch/:id`, () => {
      calls.watch += 1;
      return HttpResponse.json(options.watch ?? watchDetail());
    }),
    http.post(`${BASE_URL}/api/v2/playback/start`, async ({ request }) => {
      const body = (await request.json()) as Json;
      calls.start.push({ body, headers: request.headers });
      if (options.startDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.startDelayMs));
      }
      return HttpResponse.json(next(starts, calls.start.length - 1), { status: 201 });
    }),
    http.post(`${BASE_URL}/api/v2/playback/:sessionId/progress`, async ({ request, params }) => {
      calls.progress.push({
        sessionId: String(params.sessionId),
        body: (await request.json()) as Json,
      });
      return HttpResponse.json({ outcome: 'applied' });
    }),
    http.delete(`${BASE_URL}/api/v2/playback/:sessionId`, async ({ request, params }) => {
      calls.stop.push({
        sessionId: String(params.sessionId),
        body: (await request.json()) as Json,
      });
      return HttpResponse.json({ outcome: 'stopped' });
    }),
    http.post(`${BASE_URL}/api/v2/playback/:sessionId/replan`, async ({ request, params }) => {
      calls.replan.push({
        sessionId: String(params.sessionId),
        body: (await request.json()) as Json,
      });
      return HttpResponse.json(next(replans, calls.replan.length - 1));
    }),
  );
  return calls;
}

/** Polls with the real clock; fake timers in these tests only cover setInterval. */
export async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A manifest for 5400 s at one thumbnail per 10 s: 540 thumbnails on six 10x10 sheets. */
export function trickplayManifest(
  overrides: Partial<S['WatchTrickplay']> = {},
): S['WatchTrickplay'] {
  return {
    expires_at: '2030-01-01T00:00:00.000Z',
    file_id: 'file-1',
    interval_ms: 10_000,
    sheets: [0, 1, 2, 3, 4, 5].map((index) => ({
      index,
      url: `/api/v2/artwork/trickplay/file-1/rev1/${index}.rev1.jpg?exp=1893456000&sig=sig${index}`,
    })),
    thumbnail_count: 540,
    thumbnail_height: 126,
    thumbnail_width: 300,
    tile_columns: 10,
    tile_rows: 10,
    ...overrides,
  };
}

export interface TrickplayCall {
  url: URL;
  headers: Headers;
}

/** Serves the trickplay manifest (or a status) and records every read. */
export function serveTrickplay(
  server: SetupServer,
  answer: S['WatchTrickplay'] | number | (() => S['WatchTrickplay']) = trickplayManifest(),
): TrickplayCall[] {
  const calls: TrickplayCall[] = [];
  server.use(
    http.get(`${BASE_URL}/api/v2/watch/:id/trickplay`, ({ request }) => {
      calls.push({ url: new URL(request.url), headers: request.headers });
      if (typeof answer === 'number') {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Error', status: answer, code: 'internal_error' },
          { status: answer, headers: { 'content-type': 'application/problem+json' } },
        );
      }
      return HttpResponse.json(typeof answer === 'function' ? answer() : answer);
    }),
  );
  return calls;
}

/** Capabilities that offer scrub previews. */
export const TRICKPLAY_FEATURES = ['playback_plan_v3', 'sequenced_progress_v1', 'trickplay_v1'];

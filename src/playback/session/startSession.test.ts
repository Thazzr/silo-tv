// The start of a session: the server's capabilities cached per server, and the start answer
// mapped to an outcome. A stub client answers by hand; no controller is involved.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiloClient } from '../../api/client';
import type { ClientCapabilities, PlaybackContext } from '../deviceProfile';
import {
  INSTALLATION_ID,
  SESSION_ID,
  playableDecision,
  playbackCapabilities,
  playbackPlan,
  watchDetail,
  watchUserData,
  watchVersion,
  terminalDecision,
} from '../../test/playbackFixtures';
import { problem } from '../../test/apiFixtures';
import {
  clearInstallationCache,
  forgetInstallation,
  interpretStart,
  loadInstallation,
  loadWatch,
  requestStart,
} from './startSession';
import { SessionError } from './types';
import { CLIENT_FEATURES } from '../deviceProfile';

const HEADER = { 'X-Profile-Id': 'p1' };

type Answer = Parameters<typeof interpretStart>[0];

const answer = (status: number, data?: unknown, error?: unknown): Answer =>
  ({ data, error, response: new Response(null, { status }) }) as unknown as Answer;

beforeEach(() => clearInstallationCache());

describe('interpretStart', () => {
  it('is playable with the plan and the session id from the decision', () => {
    const plan = playbackPlan();
    const outcome = interpretStart(answer(200, playableDecision(plan)), true);
    expect(outcome).toEqual({ kind: 'playable', plan, sessionId: SESSION_ID });
  });

  it('takes the session id from the plan when the decision has none', () => {
    const plan = playbackPlan({ session_id: 'from-plan' });
    const decision = { ...playableDecision(plan), session_id: undefined };
    expect(interpretStart(answer(200, decision), true)).toEqual({
      kind: 'playable',
      plan,
      sessionId: 'from-plan',
    });
  });

  it('is terminal, with the server message and reason, when the outcome is not playable', () => {
    expect(interpretStart(answer(200, terminalDecision('No route fits.')), true)).toEqual({
      kind: 'terminal',
      message: 'No route fits.',
      reason: 'adaptation_exhausted',
    });
  });

  it('is terminal when a playable decision carries no plan or no session id', () => {
    const noPlan = { ...playableDecision(), playback_plan: undefined };
    expect(interpretStart(answer(200, noPlan), true).kind).toBe('terminal');
    const noSession = {
      ...playableDecision(playbackPlan({ session_id: undefined })),
      session_id: undefined,
    };
    expect(interpretStart(answer(200, noSession), true).kind).toBe('terminal');
  });

  it('is terminal without a message when the decision has no terminal block', () => {
    const outcome = interpretStart(answer(200, { ...playableDecision(), outcome: 'x' }), true);
    // a non-playable outcome without a plan or terminal block
    expect(outcome).toEqual({ kind: 'terminal', message: undefined, reason: undefined });
  });

  it('asks for another attempt when the installation changed and a retry is allowed', () => {
    const outcome = interpretStart(
      answer(409, undefined, problem('installation_changed', 409)),
      true,
    );
    expect(outcome).toEqual({ kind: 'installationChanged' });
  });

  it('fails when the installation changed again after the retry', () => {
    const outcome = interpretStart(
      answer(409, undefined, problem('installation_changed', 409)),
      false,
    );
    expect(outcome).toEqual({ kind: 'failed', reason: 'failed' });
  });

  it('is unsupported on 426 and failed on any other error', () => {
    expect(interpretStart(answer(426, undefined, problem('upgrade_required', 426)), true)).toEqual({
      kind: 'failed',
      reason: 'unsupported',
    });
    expect(interpretStart(answer(500, undefined, problem('boom', 500)), true)).toEqual({
      kind: 'failed',
      reason: 'failed',
    });
    expect(interpretStart(answer(400, undefined, undefined), true)).toEqual({
      kind: 'failed',
      reason: 'failed',
    });
  });
});

describe('loadInstallation cache', () => {
  function clientFor(
    capabilities: unknown,
    status = 200,
  ): { client: SiloClient; get: ReturnType<typeof vi.fn> } {
    const get = vi.fn(async () => ({
      data: status === 200 ? capabilities : undefined,
      response: new Response(null, { status }),
    }));
    return { client: { GET: get } as unknown as SiloClient, get };
  }

  it('reads the capabilities once per server and caches them', async () => {
    const { client, get } = clientFor(
      playbackCapabilities({
        features: [
          'sequenced_progress_v1',
          'trickplay_v1',
          'marker_segments_v1',
          'plan_active_quality_v1',
        ],
      }),
    );
    const first = await loadInstallation(client, 'https://a.test', HEADER);
    expect(first).toEqual({
      id: INSTALLATION_ID,
      trickplay: true,
      markerList: true,
      activeQuality: true,
    });
    expect(await loadInstallation(client, 'https://a.test', HEADER)).toBe(first);
    expect(get).toHaveBeenCalledTimes(1);
    await loadInstallation(client, 'https://b.test', HEADER);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('reports the optional features as absent when the server does not list them', async () => {
    const { client } = clientFor(playbackCapabilities());
    expect(await loadInstallation(client, 'https://a.test', HEADER)).toMatchObject({
      trickplay: false,
      markerList: false,
      activeQuality: false,
    });
  });

  it('forgetInstallation drops one server and leaves the others', async () => {
    const { client, get } = clientFor(playbackCapabilities());
    await loadInstallation(client, 'https://a.test', HEADER);
    await loadInstallation(client, 'https://b.test', HEADER);
    forgetInstallation('https://a.test');
    await loadInstallation(client, 'https://b.test', HEADER);
    expect(get).toHaveBeenCalledTimes(2);
    await loadInstallation(client, 'https://a.test', HEADER);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('clearInstallationCache drops every server', async () => {
    const { client, get } = clientFor(playbackCapabilities());
    await loadInstallation(client, 'https://a.test', HEADER);
    clearInstallationCache();
    await loadInstallation(client, 'https://a.test', HEADER);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    const { client, get } = clientFor(undefined, 500);
    await expect(loadInstallation(client, 'https://a.test', HEADER)).rejects.toMatchObject({
      reason: 'failed',
    });
    await expect(loadInstallation(client, 'https://a.test', HEADER)).rejects.toBeInstanceOf(
      SessionError,
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('is unsupported on 404 and on a server that cannot do protocol 3 with sequenced progress', async () => {
    await expect(
      loadInstallation(clientFor(undefined, 404).client, 'https://a.test', HEADER),
    ).rejects.toMatchObject({ reason: 'unsupported' });
    const unsupported = [
      playbackCapabilities({ state: 'unsupported' }),
      playbackCapabilities({ allowed: false }),
      playbackCapabilities({ protocol_versions: [2] }),
      playbackCapabilities({ features: [] }),
      playbackCapabilities({ installation_id: '' }),
    ];
    for (const capabilities of unsupported) {
      await expect(
        loadInstallation(clientFor(capabilities).client, 'https://a.test', HEADER),
      ).rejects.toMatchObject({ reason: 'unsupported' });
    }
  });
});

describe('requestStart', () => {
  function send(start: Partial<Parameters<typeof requestStart>[2]> = {}) {
    const post = vi.fn(async () => ({ data: undefined, response: new Response(null) }));
    void requestStart({ POST: post } as unknown as SiloClient, HEADER, {
      installationId: INSTALLATION_ID,
      fileId: 'file-1',
      pinnedFile: false,
      profileId: 'p1',
      attemptId: 'attempt-1',
      quality: 'auto',
      position: 12,
      tracks: {},
      capabilities: {} as ClientCapabilities,
      context: {} as PlaybackContext,
      ...start,
    });
    const call = post.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
    return call[1].body;
  }

  it('sends protocol 3 with the attempt, quality and position, and no track or pin fields by default', () => {
    const body = send();
    expect(body).toMatchObject({
      installation_id: INSTALLATION_ID,
      protocol_version: 3,
      file_id: 'file-1',
      playback_attempt_id: 'attempt-1',
      quality_preference: 'auto',
      start_position: 12,
    });
    expect(body).not.toHaveProperty('allow_alternate_versions');
    expect(body).not.toHaveProperty('audio_track_id');
    expect(body).not.toHaveProperty('subtitle_track_index');
  });

  it('sends bandwidth_cap_kbps only when the profile has a cap', () => {
    expect(send({ bandwidthCapKbps: 8000 }).bandwidth_cap_kbps).toBe(8000);
    expect(send({ bandwidthCapKbps: null })).not.toHaveProperty('bandwidth_cap_kbps');
    expect(send()).not.toHaveProperty('bandwidth_cap_kbps');
  });

  it('forbids alternate versions for a picked file and carries the track picks', () => {
    const body = send({
      pinnedFile: true,
      tracks: { audio: { id: 'a1' }, subtitle: { index: 4 } },
    });
    expect(body.allow_alternate_versions).toBe(false);
    expect(body).toMatchObject({ audio_track_id: 'a1', subtitle_track_index: 4 });
  });
});

describe('requestStart body in full', () => {
  it('passes every field through: features, fidelity, quality, profile, capabilities, context', () => {
    const post = vi.fn(async () => ({ data: undefined, response: new Response(null) }));
    const capabilities = { marker: 'caps', nested: { a: 1 } } as unknown as ClientCapabilities;
    const context = { marker: 'context', nested: { b: 2 } } as unknown as PlaybackContext;
    void requestStart({ POST: post } as unknown as SiloClient, HEADER, {
      installationId: INSTALLATION_ID,
      fileId: 'file-1',
      pinnedFile: false,
      profileId: 'profile-9',
      attemptId: 'attempt-1',
      quality: '1080p',
      position: 0,
      tracks: {},
      capabilities,
      context,
    });
    const call = post.mock.calls[0] as unknown as [
      string,
      { params: { header: unknown }; body: Record<string, unknown> },
    ];
    const { body, params } = call[1];
    expect(params.header).toEqual(HEADER);
    expect(body.client_features).toEqual(CLIENT_FEATURES);
    expect(body.client_features).not.toEqual([]);
    expect(body.subtitle_fidelity_preference).toBe('compatible');
    expect(body.quality_preference).toBe('1080p');
    expect(body.profile_id).toBe('profile-9');
    expect(body.start_position).toBe(0);
    expect(body.client_capabilities).toEqual(capabilities);
    expect(body.client_playback_context).toEqual(context);
  });
});

describe('interpretStart session id precedence', () => {
  it('prefers the decision session id over the plan one', () => {
    const plan = playbackPlan({ session_id: 'from-plan' });
    const decision = { ...playableDecision(plan), session_id: 'from-decision' };
    expect(interpretStart(answer(200, decision), true)).toMatchObject({
      sessionId: 'from-decision',
    });
  });
});

describe('loadWatch', () => {
  const load = (detail: ReturnType<typeof watchDetail>, picked?: string) =>
    loadWatch(
      {
        GET: vi.fn(async () => ({ data: detail, response: new Response(null) })),
      } as unknown as SiloClient,
      'm1',
      picked,
      HEADER,
    );
  const versions = [
    watchVersion({ file_id: 'a', duration_seconds: 1000 }),
    watchVersion({ file_id: 'b', duration_seconds: 2000 }),
    watchVersion({ file_id: 'c', duration_seconds: 3000 }),
  ];

  it('plays the picked file, else the one watched last, else the first', async () => {
    const detail = watchDetail({ versions, user_data: watchUserData({ last_file_id: 'b' }) });
    expect((await load(detail, 'c')).fileId).toBe('c');
    expect((await load(detail)).fileId).toBe('b');
    expect((await load(watchDetail({ versions }))).fileId).toBe('a');
    // a pick or last-watched id the list does not hold falls back to the first
    expect((await load(detail, 'zzz')).fileId).toBe('a');
  });

  it('throws noFile for a title without versions', async () => {
    await expect(load(watchDetail({ versions: [] }))).rejects.toMatchObject({
      reason: 'noFile',
    });
    await expect(load(watchDetail({ versions: [] }))).rejects.toBeInstanceOf(SessionError);
  });

  it('keeps season and episode number 0 and omits an absent series title', async () => {
    const withNumbers = await load(
      watchDetail({
        type: 'episode',
        series_title: 'Show',
        season_number: 0,
        episode_number: 0,
      }),
    );
    expect(withNumbers.heading).toEqual({
      title: 'First Title',
      seriesTitle: 'Show',
      seasonNumber: 0,
      episodeNumber: 0,
    });
    const movie = await load(watchDetail());
    expect(movie.heading).toEqual({ title: 'First Title' });
  });

  it('falls back from edition_raw to edition_key, and leaves out an absent edition', async () => {
    const detail = watchDetail({
      versions: [
        watchVersion({ file_id: 'a', edition_raw: 'Raw', edition_key: 'key' }),
        watchVersion({ file_id: 'b', edition_key: 'key-only' }),
        watchVersion({ file_id: 'c' }),
      ],
    });
    const { versions: out } = await load(detail);
    expect(out[0]!.edition).toBe('Raw');
    expect(out[1]!.edition).toBe('key-only');
    expect(out[2]).not.toHaveProperty('edition');
  });

  it('marks only an episode as one, and carries the series id', async () => {
    const episode = await load(watchDetail({ type: 'episode', series_id: 's1' }));
    expect(episode.item).toMatchObject({ isEpisode: true, seriesId: 's1' });
    const movie = await load(watchDetail({ type: 'movie', series_id: 's1' }));
    expect(movie.item.isEpisode).toBe(false);
    const noSeries = await load(watchDetail({ type: 'episode' }));
    expect(noSeries.item).not.toHaveProperty('seriesId');
  });

  it('resumes by the picked version duration', async () => {
    // 1500 s is inside the picked 2000 s version, but past the end of the first (1000 s) one
    const detail = watchDetail({
      versions,
      user_data: watchUserData({ position_seconds: 1500 }),
    });
    const picked = await load(detail, 'b');
    expect(picked.fileId).toBe('b');
    expect(picked.resume).toBe(1500);
  });
});

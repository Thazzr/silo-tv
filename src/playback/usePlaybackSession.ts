// One playback through Silo playback protocol v3: capabilities, start, progress, stop and one
// failure-driven replan. The controller is plain TypeScript so the protocol logic does not
// depend on React; usePlaybackSession ties its lifetime to a component.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toApiError, type SiloClient } from '../api/client';
import type { components } from '../api/generated/schema';
import type { Session } from '../api/session';
import { useSilo } from '../app/SiloContext';
import {
  buildClientCapabilities,
  buildPlaybackContext,
  CLIENT_FEATURES,
  type ClientCapabilities,
  type PlaybackContext,
} from './deviceProfile';
import { mediaUrlWithToken } from './mediaUrl';
import { collectProfileProbe } from './probe';
import { resumePoint, rewound, type StartIntent } from './resume';
import { getResumeRewind } from './resumeRewind';
import { uuidV4 } from './uuid';

type S = components['schemas'];
export type Plan = S['PlaybackPlan'];

/** Progress is reported every 10 s while playing (CLAUDE.md, protocol rules). */
export const PROGRESS_INTERVAL_MS = 10_000;

export type SessionFailure = 'unsupported' | 'noFile' | 'terminal' | 'failed' | 'sessionEnded';

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'prompt'; positionSeconds: number }
  | { kind: 'starting' }
  | { kind: 'ready'; plan: Plan; sessionId: string; mediaUrl: string; loadId: number }
  | {
      kind: 'error';
      reason: SessionFailure;
      message?: string;
      plan?: Plan;
      sessionId?: string;
      mediaUrl?: string;
    };

/** What the player reports: the position on the source's timeline, in seconds. */
export interface PlayerReading {
  position: number;
  paused: boolean;
}

export interface MediaFailure {
  code: number;
  message: string;
}

class SessionError extends Error {
  constructor(readonly reason: SessionFailure) {
    super(reason);
  }
}

// The server's installation id, per server, for the whole app run. Every mutation carries it.
const installations = new Map<string, string>();

/** Test hook. */
export function clearInstallationCache(): void {
  installations.clear();
}

interface Deps {
  client: SiloClient;
  baseUrl: string;
  session: Session;
  contentId: string;
  /** How to start; without one the player asks when there is something to resume. */
  intent?: StartIntent;
  onState(state: SessionState): void;
  onMediaError(failure: MediaFailure | null): void;
}

export class PlaybackController {
  private disposed = false;
  private stopped = false;
  private profileId = '';
  private installationId = '';
  private fileId = '';
  private attemptId = '';
  private sessionId = '';
  private plan: Plan | null = null;
  private planAttemptId = '';
  private mediaUrl = '';
  private attemptedKeys: string[] = [];
  private capabilities: ClientCapabilities | null = null;
  private context: PlaybackContext | null = null;
  private startPosition = 0;
  private resumeAt: number | null = null;
  private sequence = 0;
  private loadId = 0;
  private replans = 0;
  private replanning = false;
  private read: (() => PlayerReading | null) | null = null;
  private lastReading: PlayerReading | null = null;
  private playing = false;
  private wasPaused = false;
  private hasPlayed = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: Deps) {}

  private header() {
    return { 'X-Profile-Id': this.profileId };
  }

  private set(state: SessionState): void {
    if (!this.disposed) this.deps.onState(state);
  }

  private fail(reason: SessionFailure, message?: string): void {
    this.set({
      kind: 'error',
      reason,
      ...(message ? { message } : {}),
      ...(this.plan ? { plan: this.plan } : {}),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.mediaUrl ? { mediaUrl: this.mediaUrl } : {}),
    });
  }

  // --- Preparation ---------------------------------------------------------------------------

  /** Capabilities and the watch state; then either the resume prompt or the start. */
  async begin(): Promise<void> {
    const profileId = this.deps.session.get()?.profileId;
    if (!profileId) {
      this.fail('failed');
      return;
    }
    this.profileId = profileId;
    try {
      const [installationId, watch] = await Promise.all([this.installation(), this.watch()]);
      if (this.disposed) return;
      this.installationId = installationId;
      this.fileId = watch.fileId;
      this.resumeAt = watch.resume;
      const kind = this.deps.intent?.kind ?? 'ask';
      if (kind === 'beginning') {
        await this.start(0);
      } else if (kind === 'resume') {
        await this.resume();
      } else if (watch.resume !== null) {
        this.set({ kind: 'prompt', positionSeconds: watch.resume });
      } else {
        await this.start(0);
      }
    } catch (error) {
      this.fail(error instanceof SessionError ? error.reason : 'failed');
    }
  }

  private async installation(): Promise<string> {
    const cached = installations.get(this.deps.baseUrl);
    if (cached) return cached;
    const { data, response } = await this.deps.client.GET('/api/v2/playback/capabilities', {
      params: { header: this.header() },
    });
    if (!data) throw new SessionError(response.status === 404 ? 'unsupported' : 'failed');
    const supported =
      data.state === 'available' &&
      data.allowed &&
      data.protocol_versions.includes(3) &&
      data.features.includes('sequenced_progress_v1') &&
      Boolean(data.installation_id);
    if (!supported || !data.installation_id) throw new SessionError('unsupported');
    installations.set(this.deps.baseUrl, data.installation_id);
    return data.installation_id;
  }

  private async watch(): Promise<{ fileId: string; resume: number | null }> {
    const { data, error, response } = await this.deps.client.GET('/api/v2/watch/{id}', {
      params: { path: { id: this.deps.contentId }, header: this.header() },
    });
    if (!data) throw toApiError(error, response);
    const last = data.user_data?.last_file_id;
    const version = data.versions.find((v) => v.file_id === last) ?? data.versions[0];
    if (!version) throw new SessionError('noFile');
    // One rule for every entry: the detail page's. A rewatch that stopped partway resumes too.
    const resume = resumePoint(data.user_data, version.duration_seconds);
    return { fileId: version.file_id, resume };
  }

  // --- Start ---------------------------------------------------------------------------------

  /**
   * Starts at the resume point, moved back by the "Rewind on resume" setting (read now, so a
   * change applies to the next start); from the beginning when there is no resume point.
   */
  async resume(): Promise<void> {
    await this.start(this.resumeAt === null ? 0 : rewound(this.resumeAt, getResumeRewind()));
  }

  /** Starts the playback at `position` seconds (0 means from the beginning). */
  async start(position: number, retryInstallation = true): Promise<void> {
    this.set({ kind: 'starting' });
    this.startPosition = position;
    try {
      const probe = await collectProfileProbe();
      this.capabilities = buildClientCapabilities(probe);
      this.context = buildPlaybackContext(probe);
      this.attemptId = uuidV4();
      const { data, error, response } = await this.deps.client.POST('/api/v2/playback/start', {
        params: { header: this.header() },
        body: {
          installation_id: this.installationId,
          protocol_version: 3,
          client_features: CLIENT_FEATURES,
          file_id: this.fileId,
          profile_id: this.profileId,
          playback_attempt_id: this.attemptId,
          quality_preference: 'auto',
          subtitle_fidelity_preference: 'compatible',
          start_position: position,
          client_capabilities: this.capabilities,
          client_playback_context: this.context,
        },
      });
      if (this.disposed) {
        // Left while the start was in flight: end the session the server just created.
        if (data?.session_id) await this.stopSession(data.session_id);
        return;
      }
      if (!data) {
        const problem = toApiError(error, response);
        if (problem.code === 'installation_changed' && retryInstallation) {
          // The server was replaced or restored: read its capabilities again, new attempt.
          installations.delete(this.deps.baseUrl);
          this.installationId = await this.installation();
          await this.start(position, false);
          return;
        }
        this.fail(response.status === 426 ? 'unsupported' : 'failed');
        return;
      }
      const sessionId = data.session_id ?? data.playback_plan?.session_id;
      if (data.outcome === 'playable' && data.playback_plan && sessionId) {
        this.adopt(data.playback_plan, sessionId);
      } else {
        this.fail('terminal', data.terminal?.message);
      }
    } catch (error) {
      this.fail(error instanceof SessionError ? error.reason : 'failed');
    }
  }

  private adopt(plan: Plan, sessionId: string): void {
    this.plan = plan;
    this.sessionId = sessionId;
    this.planAttemptId = uuidV4();
    if (!this.attemptedKeys.includes(plan.plan_attempt_key)) {
      this.attemptedKeys.push(plan.plan_attempt_key);
    }
    this.loadId += 1;
    this.playing = false;
    this.wasPaused = false;
    // A new load must prove itself again before progress counts.
    this.hasPlayed = false;
    this.mediaUrl = mediaUrlWithToken(
      plan.stream.url,
      this.deps.baseUrl,
      this.deps.session.get()?.accessToken,
    );
    this.set({ kind: 'ready', plan, sessionId, mediaUrl: this.mediaUrl, loadId: this.loadId });
  }

  // --- Player events -------------------------------------------------------------------------

  /** The player screen tells how to read the current position; null detaches it. */
  bindPlayer(read: (() => PlayerReading | null) | null): void {
    this.read = read;
  }

  onPlaying(): void {
    if (this.stopped) return;
    this.hasPlayed = true;
    this.playing = true;
    if (this.wasPaused) {
      this.wasPaused = false;
      this.sendProgress(false);
    }
    this.timer ??= setInterval(() => {
      if (this.playing) this.sendProgress(false);
    }, PROGRESS_INTERVAL_MS);
  }

  onPause(): void {
    if (this.stopped) return;
    this.playing = false;
    this.wasPaused = true;
    this.sendProgress(true);
  }

  private sendProgress(paused: boolean): void {
    if (this.stopped || !this.sessionId) return;
    const reading = this.read?.();
    if (!reading) return;
    this.lastReading = reading;
    this.sequence += 1;
    this.deps.client
      .POST('/api/v2/playback/{session_id}/progress', {
        params: { path: { session_id: this.sessionId }, header: this.header() },
        body: {
          installation_id: this.installationId,
          sequence: this.sequence,
          position: reading.position,
          is_paused: paused,
        },
      })
      .then(
        ({ response }) => {
          // An expired (404) or administratively ended (410) session must not be restarted.
          if (response.status === 404 || response.status === 410) this.sessionGone();
        },
        () => undefined,
      );
  }

  private sessionGone(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    this.fail('sessionEnded');
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // --- Failure-driven replan -----------------------------------------------------------------

  /** A MediaError: exactly one replan; a second failure ends in the error state. */
  async onMediaError(failure: MediaFailure): Promise<void> {
    const plan = this.plan;
    if (this.stopped || this.replanning || !plan || !this.capabilities || !this.context) return;
    this.deps.onMediaError(failure);
    this.playing = false;
    this.clearTimer();
    if (this.replans >= 1) {
      this.fail('failed');
      return;
    }
    this.replans += 1;
    this.replanning = true;
    try {
      const reading = this.hasPlayed ? (this.read?.() ?? this.lastReading) : null;
      const { data, error, response } = await this.deps.client.POST(
        '/api/v2/playback/{session_id}/replan',
        {
          params: { path: { session_id: this.sessionId }, header: this.header() },
          body: {
            installation_id: this.installationId,
            protocol_version: 3,
            operation: 'failure_recovery',
            // The values the existing clients send: a decode or unsupported-source failure is a
            // decoder failure; an aborted or interrupted load is a transport stall.
            failure: {
              classification:
                failure.code === 3 || failure.code === 4 ? 'decoder_failure' : 'transport_stall',
              message: failure.message.slice(0, 512),
            },
            client_features: CLIENT_FEATURES,
            playback_attempt_id: this.attemptId,
            replan_request_id: uuidV4(),
            failed_plan_id: plan.plan_id,
            plan_attempt_id: this.planAttemptId,
            plan_attempt_key: plan.plan_attempt_key,
            attempted_plan_keys: this.attemptedKeys,
            attempt_count: 1,
            quality_preference: 'auto',
            position_seconds: reading?.position ?? this.startPosition,
            selected_tracks: plan.selected_tracks,
            client_capabilities: this.capabilities,
            client_playback_context: this.context,
          },
        },
      );
      if (this.stopped) return;
      if (!data) {
        const code = toApiError(error, response).status;
        if (code === 404 || code === 410) this.sessionGone();
        else this.fail('failed');
        return;
      }
      const sessionId = data.session_id ?? data.playback_plan?.session_id ?? this.sessionId;
      if (data.outcome === 'playable' && data.playback_plan) {
        this.adopt(data.playback_plan, sessionId);
      } else {
        this.fail('terminal', data.terminal?.message);
      }
    } catch {
      if (!this.stopped) this.fail('failed');
    } finally {
      this.replanning = false;
    }
  }

  // --- Stop ----------------------------------------------------------------------------------

  /** Ends the session on the server with the final position. Safe to call more than once. */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    this.clearTimer();
    if (!this.sessionId) return Promise.resolve();
    const reading = this.read?.() ?? this.lastReading;
    return this.stopSession(this.sessionId, reading);
  }

  private async stopSession(sessionId: string, reading?: PlayerReading | null): Promise<void> {
    try {
      await this.deps.client.DELETE('/api/v2/playback/{session_id}', {
        params: { path: { session_id: sessionId }, header: this.header() },
        body: {
          installation_id: this.installationId,
          stop_id: uuidV4(),
          // The final sample: sequence and position go together or not at all.
          ...(reading
            ? {
                sequence: (this.sequence += 1),
                position: reading.position,
                is_paused: reading.paused,
              }
            : {}),
        },
      });
    } catch {
      // The server ends an abandoned session on its own after a timeout.
    }
  }

  /** The screen is gone: end the session, and one still being started when it arrives. */
  dispose(): void {
    void this.stop();
    this.disposed = true;
  }
}

export interface PlaybackSession {
  state: SessionState;
  mediaError: MediaFailure | null;
  /** From the resume prompt: start over (`0`) or at another position, as given. */
  choose(position: number): void;
  /** From the resume prompt: continue at the resume point, rewound. */
  resume(): void;
  bindPlayer(read: (() => PlayerReading | null) | null): void;
  onPlaying(): void;
  onPause(): void;
  onMediaError(failure: MediaFailure): void;
  stop(): Promise<void>;
}

export function usePlaybackSession(contentId: string, intent?: StartIntent): PlaybackSession {
  const { client, baseUrl, session } = useSilo();
  const [state, setState] = useState<SessionState>({ kind: 'loading' });
  const [mediaError, setMediaError] = useState<MediaFailure | null>(null);
  const controller = useRef<PlaybackController | null>(null);

  useEffect(() => {
    const created = new PlaybackController({
      client,
      baseUrl,
      session,
      contentId,
      intent,
      onState: setState,
      onMediaError: setMediaError,
    });
    controller.current = created;
    void created.begin();
    return () => {
      created.dispose();
      controller.current = null;
    };
    // The intent is a plain value: its kind restarts the session, a new object of the same kind must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, baseUrl, session, contentId, intent?.kind]);

  const choose = useCallback((position: number) => void controller.current?.start(position), []);
  const resume = useCallback(() => void controller.current?.resume(), []);
  const bindPlayer = useCallback(
    (read: (() => PlayerReading | null) | null) => controller.current?.bindPlayer(read),
    [],
  );
  const onPlaying = useCallback(() => controller.current?.onPlaying(), []);
  const onPause = useCallback(() => controller.current?.onPause(), []);
  const onMediaError = useCallback(
    (failure: MediaFailure) => void controller.current?.onMediaError(failure),
    [],
  );
  const stop = useCallback(() => controller.current?.stop() ?? Promise.resolve(), []);

  return useMemo(
    () => ({
      state,
      mediaError,
      choose,
      resume,
      bindPlayer,
      onPlaying,
      onPause,
      onMediaError,
      stop,
    }),
    [state, mediaError, choose, resume, bindPlayer, onPlaying, onPause, onMediaError, stop],
  );
}

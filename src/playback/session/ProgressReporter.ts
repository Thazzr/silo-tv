// The session's heartbeat: a progress report every 10 s while playing or paused, and the one-off
// reports a pause or a lost connection asks for. Owns the report sequence the stop continues.
import { toApiError, type SiloClient } from '../../api/client';
import type { PlayerReading, ProfileHeader } from './types';

/** Progress is reported every 10 s while the session is open, playing or paused (protocol §2.5). */
export const PROGRESS_INTERVAL_MS = 10_000;

export interface ProgressDeps {
  client: SiloClient;
  header(): ProfileHeader;
  installationId(): string;
  /** The session to report for; empty before a plan and after a restart cleared it. */
  sessionId(): string;
  isStopped(): boolean;
  reading(): PlayerReading | null;
  /** The heartbeat only reports once a frame has played in the current load. */
  hasPlayed(): boolean;
  isPlaying(): boolean;
  /** 410: the server ended the session on purpose. */
  onEnded(): void;
  /** 404: the session expired; a new attempt picks up at `position`. */
  onExpired(position: number): void;
}

export class ProgressReporter {
  private sequence = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: ProgressDeps) {}

  /** The next sequence number; the stop's final sample continues the same count. */
  nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  /** A new session counts from its own start. */
  reset(): void {
    this.sequence = 0;
  }

  /** The heartbeat runs while playing and while paused: the server drops a quiet session. */
  startHeartbeat(): void {
    this.timer ??= setInterval(() => {
      if (this.deps.hasPlayed()) this.send(!this.deps.isPlaying());
    }, PROGRESS_INTERVAL_MS);
  }

  clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  send(paused: boolean): void {
    if (this.deps.isStopped() || !this.deps.sessionId()) return;
    const reading = this.deps.reading();
    if (!reading) return;
    this.sequence += 1;
    const sessionId = this.deps.sessionId();
    this.deps.client
      .POST('/api/v2/playback/{session_id}/progress', {
        params: { path: { session_id: sessionId }, header: this.deps.header() },
        body: {
          installation_id: this.deps.installationId(),
          sequence: this.sequence,
          position: reading.position,
          is_paused: paused,
        },
      })
      .then(
        ({ error, response }) => {
          // The answer of a session that was replaced meanwhile says nothing about this one.
          if (sessionId !== this.deps.sessionId()) return;
          // An administratively ended session (410) must not be restarted ...
          if (response.status === 410) this.deps.onEnded();
          // ... an expired one (404) is, where the viewer was (stale_sample and replayed are fine).
          else if (response.status === 404 && toApiError(error, response).code !== 'not_found') {
            this.deps.onExpired(reading.position);
          }
        },
        () => undefined,
      );
  }
}

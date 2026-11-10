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

/** The one progress request that may be on its way, and the session it belongs to. */
interface Flight {
  sessionId: string;
}

export class ProgressReporter {
  private sequence = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flight: Flight | null = null;
  /** The newest report that had to wait for the flight: only its `paused` flag is kept. */
  private pending: { sessionId: string; paused: boolean } | null = null;

  constructor(private readonly deps: ProgressDeps) {}

  /** The next sequence number; the stop's final sample continues the same count. */
  nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  /** A new session counts from its own start. */
  reset(): void {
    this.sequence = 0;
    // The old session's answer says nothing about the new one: it starts with a free slot.
    this.flight = null;
    this.pending = null;
  }

  /** The heartbeat runs while playing and while paused: the server drops a quiet session. */
  startHeartbeat(): void {
    this.timer ??= setInterval(() => {
      if (this.deps.hasPlayed()) this.send(!this.deps.isPlaying());
    }, PROGRESS_INTERVAL_MS);
  }

  /** A report waiting for the flight is not sent any more (the session is over). */
  dropPending(): void {
    this.pending = null;
  }

  clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Reports progress, one request at a time. While one is in flight a new report only marks itself
   * as pending (the newest wins); when the flight settles, the pending one goes out at once with a
   * fresh reading and the next sequence, so sent order and sequence order agree. A failed request
   * is not retried: the next tick sends a fresh sample. The transport's timeout bounds a request
   * nobody answers, so the slot always frees.
   */
  send(paused: boolean): void {
    if (this.deps.isStopped()) return;
    const sessionId = this.deps.sessionId();
    if (!sessionId) return;
    if (this.flight && this.flight.sessionId === sessionId) {
      this.pending = { sessionId, paused };
      return;
    }
    this.dispatch(sessionId, paused);
  }

  private dispatch(sessionId: string, paused: boolean): void {
    const reading = this.deps.reading();
    if (!reading) return;
    this.sequence += 1;
    const flight: Flight = { sessionId };
    this.flight = flight;
    this.pending = null;
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
      )
      .finally(() => {
        // A restart gave the slot to another flight; this one's end changes nothing.
        if (this.flight !== flight) return;
        this.flight = null;
        const next = this.pending;
        this.pending = null;
        // Dropped after a stop, and for a session that was replaced meanwhile.
        if (!next || this.deps.isStopped() || next.sessionId !== this.deps.sessionId()) return;
        this.dispatch(next.sessionId, next.paused);
      });
  }
}

// When a load goes wrong: the first-frame watchdog, the classification of a media error, the
// reconnect after a lost connection and the restart of a session the server no longer knows.
import type { PlayerEngine } from '../engine/PlayerEngine';
import type {
  MediaFailure,
  Plan,
  PlayerReading,
  ReplanOperation,
  ReplanOptions,
  ReplanResult,
} from './types';
import type { QualityLoad } from './replan';

/** Lost connection (§6.2): retry after 1 s, doubling to a 15 s cap, for about two minutes. */
export const RECONNECT_FIRST_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 15_000;
export const RECONNECT_BUDGET_MS = 120_000;
/** A session the server drops again and again is not worth another attempt. */
const MAX_RESTARTS = 3;
/**
 * A new source must deliver `loadedmetadata` within this time, or the load counts as failed.
 * webOS can hang a stream request without any event, which no media error would ever report.
 */
export const METADATA_TIMEOUT_MS = 20_000;
/** A MediaError code: the media element could not reach its source. */
const MEDIA_ERR_NETWORK = 2;

// --- First-frame watchdog ------------------------------------------------------------------------

export interface WatchdogDeps {
  isStopped(): boolean;
  engine(): Pick<PlayerEngine, 'buffered'> | null;
  /** No metadata and no error in time: the load failed silently. */
  onStall(failure: MediaFailure, classification: string): void;
}

/** Runs only while a loaded source has not shown its metadata. */
export class FirstFrameWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private awaitingMetadata = false;

  constructor(private readonly deps: WatchdogDeps) {}

  /** A new element loads a new source (every load mounts its own); a gone one loads nothing. */
  expect(loading: boolean): void {
    this.awaitingMetadata = loading;
    this.arm();
  }

  arm(): void {
    this.clear();
    if (!this.awaitingMetadata || this.deps.isStopped() || document.visibilityState === 'hidden') {
      return;
    }
    this.timer = setTimeout(this.onTimeout, METADATA_TIMEOUT_MS);
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  disarm(): void {
    this.awaitingMetadata = false;
    this.clear();
  }

  /** No metadata and no error in time: the load failed silently, so it takes the failure path. */
  private readonly onTimeout = (): void => {
    this.timer = null;
    const engine = this.deps.engine();
    if (!engine || !this.awaitingMetadata || this.deps.isStopped()) return;
    this.awaitingMetadata = false;
    // Data without metadata is a decoder's problem; nothing at all is a transport that stalled.
    const received = engine.buffered.length > 0;
    // Always a failure recovery: a silent hang is a failed route, never a lost connection, so
    // the server must pick another one instead of the same URL being retried.
    this.deps.onStall(
      {
        code: received ? 3 : MEDIA_ERR_NETWORK,
        message: `No metadata within ${METADATA_TIMEOUT_MS / 1000} s`,
      },
      received ? 'decoder_failure' : 'transport_stall',
    );
  };
}

// --- Recovery ------------------------------------------------------------------------------------

export interface RecoveryDeps {
  isStopped(): boolean;
  isReplanning(): boolean;
  /** A plan and a device profile exist: there is something to recover. */
  ready(): boolean;
  loadId(): number;
  hasPlayed(): boolean;
  /** What the viewer wants: a reload after a lost connection follows it. */
  viewerPaused(): boolean;
  startPosition(): number;
  reading(): PlayerReading | null;
  plan(): Plan | null;
  /** Tells the screen that the media element failed. */
  reportFailure(failure: MediaFailure): void;
  markNotPlaying(): void;
  disarmWatchdog(): void;
  takeQualityLoad(): QualityLoad | null;
  replan(operation: ReplanOperation, options?: ReplanOptions): Promise<ReplanResult>;
  /** A paused report is the longest grace the server gives a quiet session (§2.5). */
  sendPausedProgress(): void;
  fail(reason: 'terminal' | 'failed', message?: string, code?: string): void;
  sessionGone(): void;
  /** Forgets the session and its plans; the position and the tracks playing now carry over. */
  prepareRestart(): void;
  start(position: number): Promise<void>;
}

export class Recovery {
  private reconnecting = false;
  private restarting = false;
  private restarts = 0;
  private wake: (() => void) | null = null;
  /** The load whose failure was handled already: one failure is recovered once. */
  private failedLoad = -1;

  constructor(private readonly deps: RecoveryDeps) {}

  /** A reconnect or a restart is running. */
  get active(): boolean {
    return this.reconnecting || this.restarting;
  }

  /** A MediaError: a lost connection reconnects; any other failure replans for another route. */
  async onMediaError(failure: MediaFailure, classification?: string): Promise<void> {
    const deps = this.deps;
    // Whatever the error is, the load has an answer now and the watchdog has nothing to add.
    deps.disarmWatchdog();
    if (deps.isStopped() || deps.isReplanning() || this.reconnecting || this.restarting) return;
    if (!deps.ready()) return;
    // A second report of the same load (an error after the watchdog fired) is not a new failure.
    if (this.failedLoad === deps.loadId()) return;
    this.failedLoad = deps.loadId();
    deps.reportFailure(failure);
    deps.markNotPlaying();
    // A quality the viewer picked that does not play before its first frame goes back to the
    // quality before it, at the same position. If that is not possible, the failure path below runs.
    const pick = deps.takeQualityLoad();
    if (pick && pick.loadId === deps.loadId() && !deps.hasPlayed()) {
      const back = await deps.replan('quality_change', {
        quality: pick.previous,
        position: deps.reading()?.position ?? deps.startPosition(),
        forceReload: true,
        fallback: true,
      });
      if (back.kind === 'applied' || deps.isStopped()) return;
    }
    // A network error after the first frame is a lost connection, not a failed route (§6.2).
    // A caller that names the classification (the watchdog) has decided it is a route failure.
    if (failure.code === MEDIA_ERR_NETWORK && deps.hasPlayed() && !classification) {
      await this.reconnect();
      return;
    }
    const result = await deps.replan('failure_recovery', {
      // The values the existing clients send: a decode or unsupported-source failure is a
      // decoder failure; an aborted or interrupted load is a transport stall.
      failure: {
        classification:
          classification ??
          (failure.code === 3 || failure.code === 4 ? 'decoder_failure' : 'transport_stall'),
        message: failure.message.slice(0, 512),
      },
    });
    switch (result.kind) {
      case 'applied':
      case 'busy':
        return;
      case 'terminal':
        deps.fail('terminal', result.message, result.reason);
        return;
      case 'ended':
        deps.sessionGone();
        return;
      case 'gone':
        await this.restartAt(deps.reading()?.position ?? deps.startPosition());
        return;
      case 'transient':
        // The recovery could not reach the server: it joins the reconnect.
        await this.reconnect();
        return;
      default:
        deps.fail('failed');
    }
  }

  /**
   * The route did not fail, the connection did: retry an unchanged track_change at the saved
   * position, 1 s doubling to 15 s, for about two minutes. A session the server no longer knows
   * starts anew at that position. The budget running out is a failure as before.
   */
  private async reconnect(): Promise<void> {
    const deps = this.deps;
    const plan = deps.plan();
    if (this.reconnecting || !plan) return;
    this.reconnecting = true;
    const saved = deps.reading()?.position ?? deps.startPosition();
    const play = !deps.viewerPaused();
    deps.sendPausedProgress();
    let restart = false;
    try {
      let delay = RECONNECT_FIRST_DELAY_MS;
      let waited = 0;
      for (;;) {
        await this.wait(delay);
        if (deps.isStopped()) return;
        waited += delay;
        const result = await deps.replan('track_change', {
          position: saved,
          tracks: plan.selected_tracks,
          forceReload: true,
          autoplay: play,
        });
        if (deps.isStopped()) return;
        if (result.kind === 'applied' || result.kind === 'busy') return;
        if (result.kind === 'terminal') {
          deps.fail('terminal', result.message, result.reason);
          return;
        }
        if (result.kind === 'ended') {
          deps.sessionGone();
          return;
        }
        if (result.kind !== 'transient') {
          // Anything but a retryable answer means the session did not survive.
          restart = true;
          return;
        }
        if (waited >= RECONNECT_BUDGET_MS) {
          deps.fail('failed');
          return;
        }
        delay = Math.min(delay * 2, RECONNECT_MAX_DELAY_MS);
      }
    } finally {
      this.reconnecting = false;
      if (restart) await this.restartAt(saved);
    }
  }

  /** The session is gone on the server: a new attempt at `position`, with the tracks playing now. */
  async restartAt(position: number): Promise<void> {
    if (this.deps.isStopped() || this.restarting) return;
    if (this.restarts >= MAX_RESTARTS) {
      this.deps.sessionGone();
      return;
    }
    this.restarts += 1;
    this.restarting = true;
    try {
      this.deps.prepareRestart();
      await this.deps.start(position);
    } finally {
      this.restarting = false;
    }
  }

  /** Resolves after `ms`, or early when the session ends. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const handle = setTimeout(done, ms);
      function done() {
        clearTimeout(handle);
        resolve();
      }
      this.wake = done;
    });
  }

  /** Ends a running wait at once (the session is stopping). */
  cancelWait(): void {
    this.wake?.();
    this.wake = null;
  }
}

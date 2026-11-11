// Replans: asking the server for a new plan for the running session. Failure recovery, reconnects,
// seeks that need the server, and the viewer's track and quality changes all go through here. The
// result tells what happened; the callers decide what it means for the screen.
import { toApiError, type SiloClient } from '../../api/client';
import { CLIENT_FEATURES, type ClientCapabilities, type PlaybackContext } from '../deviceProfile';
import type { PlayerEngine } from '../engine/PlayerEngine';
import { uuidV4 } from '../uuid';
import { bufferingFields, clientFeatures, type BufferingMode } from './bufferingQuality';
import { inRanges } from './facts';
import type {
  Plan,
  PlayerReading,
  ProfileHeader,
  ReplanOperation,
  ReplanOptions,
  ReplanResult,
  SelectedTracks,
} from './types';

/** What a request says about buffering when the controller does not track it. */
const NO_BUFFERING = { feature: false, mode: 'always' as const, keptKbps: null };

/** The recovery chain's bounds: `attempt_count` 1-8 and 16 remembered plan keys (§6). */
export const MAX_RECOVERIES = 8;

export function classifyRefusal(status: number, code: string): ReplanResult {
  if (status === 410) return { kind: 'ended' };
  if (status === 404 && code !== 'not_found') return { kind: 'gone' };
  if (status >= 500 || status === 408 || status === 429 || code === 'replan_in_progress') {
    return { kind: 'transient' };
  }
  return { kind: 'refused' };
}

/** The load a viewer's quality change started, with the preference from before it. */
export interface QualityLoad {
  loadId: number;
  previous: string;
}

/** What a request is built from besides the plan and the device profile. */
export interface ReplanState {
  sessionId: string;
  installationId: string;
  attemptId: string;
  planAttemptId: string;
  attemptedKeys: string[];
  /** The quality preference; null until a start decides it. */
  quality: string | null;
  startPosition: number;
  hasPlayed: boolean;
  loadId: number;
}

export interface ReplanDeps {
  client: SiloClient;
  header(): ProfileHeader;
  isStopped(): boolean;
  plan(): Plan | null;
  capabilities(): ClientCapabilities | null;
  context(): PlaybackContext | null;
  state(): ReplanState;
  reading(): PlayerReading | null;
  /** The profile's bitrate cap in kbit/s; null = none. Sent with every operation. */
  bandwidthCap(): number | null;
  /** What the buffering-quality fields of a request depend on, read anew for each one. */
  buffering?(): { feature: boolean; mode: BufferingMode; keptKbps: number | null };
  /** A quality change that went back to the quality before one that did not play. */
  onQualityFallback?(): void;
  /** The display or output changed: the device profile is read again and kept. */
  refreshProfile(): Promise<{ capabilities: ClientCapabilities; context: PlaybackContext }>;
  /** The new load starts here; until its first frame this is the position to report. */
  setStartPosition(position: number): void;
  setQuality(quality: string): void;
  /** Takes the plan as the current one (the controller decides whether the video reloads). */
  adopt(
    plan: Plan,
    sessionId: string,
    options: { forceReload?: boolean; autoplay?: boolean },
  ): void;
  /** For seeking: the player and the container's own first timestamp. */
  engine(): PlayerEngine | null;
  origin(): number;
  /** A reconnect or a restart is running: a seek is dropped then. */
  recoveryActive(): boolean;
  /** What a replan the viewer asked for leaves to do. */
  fail(reason: 'terminal', message?: string, code?: string): void;
  sessionGone(): void;
  restartAt(position: number): Promise<void>;
}

export class Replanner {
  private replanning = false;
  /** Failure recoveries in this attempt: the `attempt_count` of the loop guard. */
  private recoveries = 0;
  /**
   * The load a viewer's quality change started, with the preference from before it. While it has
   * not shown its first frame, a failure goes back to that preference instead of recovering.
   */
  private qualityLoad: QualityLoad | null = null;
  /** Fallbacks to the previous quality so far (see `SessionState.qualityFallbacks`). */
  private fallbacks = 0;
  /** The newest seek asked for while a replan ran: one slot, applied when the replan settles. */
  private queuedSeek: number | null = null;
  /** The load an applied replan started that is still to show its metadata, with the seek it owes. */
  private loadSeek: { loadId: number; seconds: number } | null = null;
  /** The load id the running replan's adopt started; null when the stream played on. */
  private reloadedTo: number | null = null;
  /** A Restore that met a running replan: sent when that replan has ended (one at most). */
  private restorePending = false;

  constructor(private readonly deps: ReplanDeps) {}

  get isReplanning(): boolean {
    return this.replanning;
  }

  get qualityFallbacks(): number {
    return this.fallbacks;
  }

  /** A new session starts its recovery count over. */
  resetRecoveries(): void {
    this.recoveries = 0;
  }

  /** A stop, an unload or a new start: a seek that waited for a replan is no longer wanted. */
  dropQueuedSeek(): void {
    this.queuedSeek = null;
    this.loadSeek = null;
    this.restorePending = false;
  }

  /**
   * The seek a new load owes, once its metadata is known (the origin is set then): the position
   * to seek to instead of the plan's start, or null. A seek bound to another load is gone.
   */
  takeLoadSeek(loadId: number): number | null {
    const owed = this.loadSeek;
    this.loadSeek = null;
    return owed && owed.loadId === loadId ? owed.seconds : null;
  }

  /** The pending quality load, once: a failure uses it or it is gone. */
  takeQualityLoad(): QualityLoad | null {
    const pick = this.qualityLoad;
    this.qualityLoad = null;
    return pick;
  }

  // --- Seeking --------------------------------------------------------------------------------

  /**
   * Moves to a position on the source's timeline. The player seeks by itself where the plan lets
   * it (it can seek anywhere, or the target is in the seekable range); otherwise the server moves
   * the timeline (a seek_reanchor replan) and the new plan loads at the position.
   */
  async seekTo(sourceSeconds: number): Promise<void> {
    const plan = this.deps.plan();
    const engine = this.deps.engine();
    if (!plan || !engine || this.deps.isStopped()) return;
    if (this.deps.recoveryActive()) return;
    if (this.loadSeek) {
      // The new load has not shown its metadata: the old engine is no place for this seek.
      this.loadSeek.seconds = sourceSeconds;
      return;
    }
    if (this.replanning) {
      // The running replan decides the stream this seek belongs to; the newest one waits for it.
      this.queuedSeek = sourceSeconds;
      return;
    }
    const origin = this.deps.origin();
    const offset = plan.timeline.timeline_offset_seconds;
    const total = plan.source.duration_seconds;
    const wanted = origin + sourceSeconds - offset;
    // Never past the ends: the engine's duration, else the source's own runtime.
    const end = Number.isFinite(engine.duration)
      ? engine.duration
      : total !== undefined
        ? origin + total - offset
        : Infinity;
    if (plan.timeline.can_seek_anywhere) {
      engine.seek(Math.min(end, Math.max(origin, wanted)));
      return;
    }
    if (inRanges(engine.seekable, wanted)) {
      engine.seek(wanted);
      return;
    }
    const position = Math.max(0, Math.min(total ?? Infinity, sourceSeconds));
    await this.settle(await this.replan('seek_reanchor', { position }), position);
  }

  /** What a replan the viewer asked for (not a failure) leaves to do. */
  private async settle(result: ReplanResult, position: number): Promise<void> {
    if (result.kind === 'terminal') this.deps.fail('terminal', result.message, result.reason);
    else if (result.kind === 'ended') this.deps.sessionGone();
    else if (result.kind === 'gone') await this.deps.restartAt(position);
    // transient, refused and busy: the current plan keeps playing and the request is dropped.
  }

  /** Switches the audio and subtitle (an omitted subtitle means off); no UI calls this yet. */
  async trackChange(selected: SelectedTracks): Promise<ReplanResult> {
    const result = await this.replan('track_change', { tracks: selected });
    const state = this.deps.state();
    await this.settle(result, this.deps.reading()?.position ?? state.startPosition);
    return result;
  }

  /**
   * Switches to a quality label from the plan's `available_qualities` (or `auto`). `extra` carries
   * the buffering controller's own lowering or restore.
   */
  async qualityChange(
    label: string,
    extra: Pick<ReplanOptions, 'lowering' | 'restore'> = {},
  ): Promise<ReplanResult> {
    if (extra.restore && this.replanning) {
      // Silo: a Restore that cannot be sent at once is sent after the replan in flight.
      this.restorePending = true;
      return { kind: 'busy' };
    }
    const result = await this.replan('quality_change', { quality: label, ...extra });
    const state = this.deps.state();
    await this.settle(result, this.deps.reading()?.position ?? state.startPosition);
    return result;
  }

  // --- Replan ----------------------------------------------------------------------------------

  /**
   * Any replan operation of the protocol, with a fresh request id each time. Failure recoveries
   * count against the loop guard (`attempt_count` up to 8, the last 16 attempted plan keys), and a
   * plan they bring back that was already tried is a loop. A track, quality or seek replan may
   * bring a known plan back: that is not a loop. The result tells what happened; the caller
   * decides what it means for the screen.
   */
  async replan(operation: ReplanOperation, options: ReplanOptions = {}): Promise<ReplanResult> {
    const result = await this.run(operation, options);
    this.afterReplan(result);
    if (['terminal', 'ended', 'gone', 'loop'].includes(result.kind)) {
      // The session does not go on this way (the caller settles it): a Restore has nothing to do.
      this.restorePending = false;
    } else {
      this.releaseRestore();
    }
    return result;
  }

  /**
   * The Restore that waited for a replan goes out once that replan has ended with an answer under
   * which the session goes on (applied, refused, transient, busy), and only then: after
   * `afterReplan` has applied a queued seek that needs no new load (a seek that starts a replan of
   * its own makes the Restore wait for that one too), and not while a seek is still owed to a
   * load the ended replan started. That seek is taken at the load's metadata (`releaseRestore`
   * is called from there); sending the Restore first would null it in `run()`. A later replan
   * (a failure recovery for a load that never reached its metadata) nulls it as well, and the
   * Restore goes out after that one. Settling a terminal, ended or gone answer comes first for the
   * caller, so those drop the Restore instead.
   */
  releaseRestore(): void {
    void this.sendPendingRestore().catch(() => undefined);
  }

  private async sendPendingRestore(): Promise<void> {
    if (!this.restorePending || this.replanning || this.loadSeek !== null) return;
    this.restorePending = false;
    if (this.deps.isStopped()) return;
    await this.qualityChange('auto', { restore: true });
  }

  /**
   * A seek that waited for the replan is applied when it settled as applied, refused or
   * transient. Any other answer (terminal, ended, gone, loop, a stopped session) drops it. A
   * `busy` while another replan still runs is not a settle: the queue stays for that one.
   */
  private afterReplan(result: ReplanResult): void {
    if (this.queuedSeek === null || this.replanning) return;
    const wanted = this.queuedSeek;
    this.queuedSeek = null;
    const settled =
      result.kind === 'applied' || result.kind === 'refused' || result.kind === 'transient';
    if (!settled || this.deps.isStopped()) return;
    if (result.kind === 'applied' && this.reloadedTo !== null) {
      // A new load: the engine and the origin are still the old ones. The seek waits for the
      // load's own metadata and replaces the plan's start seek there.
      this.loadSeek = { loadId: this.reloadedTo, seconds: wanted };
      return;
    }
    // The normal path: it clamps, and runs its own replan when the new plan needs one.
    void this.seekTo(wanted);
  }

  private async run(operation: ReplanOperation, options: ReplanOptions): Promise<ReplanResult> {
    const plan = this.deps.plan();
    const capabilities = this.deps.capabilities();
    const context = this.deps.context();
    if (this.deps.isStopped() || this.replanning || !plan || !capabilities || !context) {
      return { kind: 'busy' };
    }
    const recovery = operation === 'failure_recovery' || operation === 'seek_failure_recovery';
    if (recovery && this.recoveries >= MAX_RECOVERIES) return { kind: 'loop' };
    this.replanning = true;
    // Any replan supersedes what an earlier load still owed.
    this.loadSeek = null;
    this.reloadedTo = null;
    try {
      let profile = { capabilities, context };
      if (operation === 'output_change') profile = await this.deps.refreshProfile();
      if (recovery) this.recoveries += 1;
      const before = this.deps.state();
      const cap = this.deps.bandwidthCap();
      const buffering = this.deps.buffering?.() ?? NO_BUFFERING;
      const preference = options.quality ?? before.quality ?? 'auto';
      const reading = before.hasPlayed ? this.deps.reading() : null;
      const position = options.position ?? reading?.position ?? before.startPosition;
      const { data, error, response } = await this.deps.client.POST(
        '/api/v2/playback/{session_id}/replan',
        {
          params: { path: { session_id: before.sessionId }, header: this.deps.header() },
          body: {
            installation_id: before.installationId,
            protocol_version: 3,
            operation,
            ...(options.failure ? { failure: options.failure } : {}),
            client_features: clientFeatures(CLIENT_FEATURES, buffering.feature),
            playback_attempt_id: before.attemptId,
            replan_request_id: uuidV4(),
            failed_plan_id: plan.plan_id,
            plan_attempt_id: before.planAttemptId,
            plan_attempt_key: plan.plan_attempt_key,
            attempted_plan_keys: before.attemptedKeys,
            attempt_count: Math.max(1, this.recoveries),
            quality_preference: preference,
            ...(cap !== null ? { bandwidth_cap_kbps: cap } : {}),
            ...bufferingFields({
              ...buffering,
              auto: preference === 'auto',
              lowering: options.lowering,
              restore: options.restore,
              fallback: options.fallback,
            }),
            position_seconds: position,
            selected_tracks: options.tracks ?? plan.selected_tracks,
            client_capabilities: profile.capabilities,
            client_playback_context: profile.context,
          },
        },
      );
      if (this.deps.isStopped()) return { kind: 'busy' };
      if (!data) {
        const problem = toApiError(error, response);
        return classifyRefusal(problem.status, problem.code);
      }
      const now = this.deps.state();
      const sessionId = data.session_id ?? data.playback_plan?.session_id ?? now.sessionId;
      if (data.outcome === 'playable' && data.playback_plan) {
        const next = data.playback_plan;
        if (recovery && now.attemptedKeys.includes(next.plan_attempt_key)) {
          return { kind: 'loop' };
        }
        // The new load starts here; until its first frame this is the position to report.
        this.deps.setStartPosition(position);
        // The viewer's pick is the preference from the plan on, so the state that comes with
        // the new plan already carries it.
        const previous = now.quality ?? 'auto';
        const qualityPick = operation === 'quality_change' && options.quality !== undefined;
        if (qualityPick) this.deps.setQuality(options.quality ?? previous);
        if (qualityPick && options.fallback) {
          this.fallbacks += 1;
          // The stepped-down plan did not play: what it was lowered with is no longer wanted.
          this.deps.onQualityFallback?.();
        }
        const loadBefore = this.deps.state().loadId;
        // After a failure the old transport is dead, so its URL is no reason to keep it.
        this.deps.adopt(next, sessionId, {
          forceReload: options.forceReload || recovery,
          autoplay: options.autoplay,
        });
        // A new load from the viewer's pick may fail before its first frame: then the way back is
        // the quality it came from. The way back itself has no way back.
        const loadAfter = this.deps.state().loadId;
        this.reloadedTo = loadAfter !== loadBefore ? loadAfter : null;
        this.qualityLoad =
          qualityPick && !options.fallback && loadAfter !== loadBefore
            ? { loadId: loadAfter, previous }
            : null;
        return { kind: 'applied' };
      }
      return { kind: 'terminal', message: data.terminal?.message, reason: data.terminal?.reason };
    } catch {
      return this.deps.isStopped() ? { kind: 'busy' } : { kind: 'transient' };
    } finally {
      this.replanning = false;
    }
  }
}

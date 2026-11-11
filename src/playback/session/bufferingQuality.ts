// Lowering the quality when playback keeps buffering (Silo's buffering-quality design: the stall
// detector, the rules around it and the request fields). Everything here is pure: no React, no
// timers, no player. A clock is injected, and whoever drives it (BufferingManager) calls it with
// the player's events and decides when to look again, so tests run on a fake clock.
import type { Plan } from './types';

/** A wait counts as a stall when it lasted at least this long. */
export const STALL_MIN_MS = 1_000;
/** One stall this long triggers at once, while it still lasts. */
export const LONG_STALL_MS = 6_000;
/** Two counted stalls that ended within this window trigger. */
export const STALL_WINDOW_MS = 120_000;
export const STALLS_BEFORE_TRIGGER = 2;
/** Stall time in the first seconds of a plan does not count. */
export const STARTUP_GRACE_MS = 10_000;
/** A wait that begins with more than this buffered past the playhead is the renderer's, not the network's. */
export const RENDERER_WAIT_BUFFER_MS = 1_000;
/** A wait in progress that finds more than this buffered is the renderer's too (browsers). */
export const RENDERER_WAIT_AMPLE_MS = 5_000;
/** How long the prompt and the undo pill stay. */
export const PROMPT_MS = 15_000;
/** After a prompt timed out, the next one shows no sooner than this after it first appeared. */
export const REOFFER_MIN_MS = 120_000;
/** After "can't go lower", the plan is left alone for this long. */
export const NO_LOWER_COOLDOWN_MS = 300_000;
/** After a lowering that failed or was never adopted, the plan is watched again after this long. */
export const REARM_AFTER_UNADOPTED_MS = 60_000;
/** While the player waits, no media data for this long is an outage: direct play, HLS segments. */
export const OUTAGE_NO_DATA_MS = 4_000;
export const OUTAGE_NO_DATA_SEGMENTED_MS = 15_000;
/** Below this estimate there is no lower rung. */
export const MIN_ESTIMATE_KBPS = 100;

/** The client feature that tells the server this client implements the buffering-quality contract. */
export const BUFFERING_FEATURE = 'buffering_quality_v1';

export type BufferingMode = 'never' | 'ask' | 'always';
export type Trigger = 'two_stalls' | 'long_stall';
export type Clock = () => number;

interface CountedStall {
  end: number;
  duration: number;
}

/**
 * Tells counted stalls from waits that are not stalls, and says when playback has buffered
 * enough to act on. The caller feeds it the player's events and asks `evaluate()`.
 */
export class StallDetector {
  /** The first wait or frame of the plan; the startup grace runs from here. */
  private graceFrom: number | null = null;
  /** The plan has shown a frame. */
  private planPlayed = false;
  /** Some plan of this attempt has shown a frame. */
  private attemptPlayed = false;
  /** The wait in progress began here; null when none counts. */
  private stallStart: number | null = null;
  /** The current wait is no stall (a seek, a reload, an outage, the end): until the next frame. */
  private exempt = false;
  /** The exemption came from a seek alone, and no wait has begun during it. */
  private seekOnly = false;
  /** The wait in progress is a renderer wait: it turns into a stall when the buffer runs low. */
  private renderer = false;
  /** The player is waiting now (whether or not the wait counts). */
  private waiting = false;
  /** The wait ended uncounted because the link went silent; media data ends it. */
  private outage = false;
  private lastDataAt: number;
  private silenceMs = OUTAGE_NO_DATA_MS;
  private stalls: CountedStall[] = [];

  /**
   * `hasEvidence`: before any plan of the attempt has played, a trigger also needs this to be true
   * (the plan's media measurably arrived more slowly than it is delivered).
   */
  constructor(
    private readonly now: Clock,
    private readonly hasEvidence: () => boolean,
  ) {
    this.lastDataAt = now();
  }

  /** A new playback attempt: everything starts over. */
  newAttempt(): void {
    this.graceFrom = null;
    this.planPlayed = false;
    this.attemptPlayed = false;
    this.stallStart = null;
    this.exempt = false;
    this.seekOnly = false;
    this.renderer = false;
    this.waiting = false;
    this.outage = false;
    this.lastDataAt = this.now();
    this.stalls = [];
  }

  /** How long the link may stay silent while the player waits before it is an outage. */
  setSilenceLimit(ms: number): void {
    this.silenceMs = ms;
  }

  /**
   * A plan was adopted: its own grace, no history. A reload (a new source) of a source that has
   * played buffers uncounted until its first frame; a plan that plays on starts its grace now. A
   * replacement before any plan of the attempt has played continues the start wait, with the
   * grace the attempt began with.
   */
  planAdopted(reload: boolean): void {
    this.stalls = [];
    this.lastDataAt = this.now();
    this.outage = false;
    if (reload && !this.attemptPlayed) {
      this.planPlayed = false;
      return;
    }
    this.stallStart = null;
    this.exempt = reload;
    this.seekOnly = false;
    this.renderer = false;
    this.graceFrom = reload ? null : this.now();
    if (reload) this.planPlayed = false;
  }

  /** The player ran out of data. `paused`: the viewer's pause, which no wait counts under. */
  onWaiting(bufferedAheadMs: number, paused: boolean): void {
    if (this.stallStart !== null || this.renderer) return;
    const t = this.now();
    this.graceFrom ??= t;
    this.waiting = true;
    if (paused) return;
    if (this.exempt) {
      // A wait that began during a seek stays the seek's until a frame plays.
      this.seekOnly = false;
      return;
    }
    // A wait on a link that is already silent is an outage at once.
    if (t - this.lastDataAt >= this.silenceMs) {
      this.outage = true;
      this.exempt = true;
      return;
    }
    if (bufferedAheadMs > RENDERER_WAIT_BUFFER_MS) {
      this.renderer = true;
      return;
    }
    this.stallStart = t;
  }

  /** A frame plays: a wait that lasted long enough is counted. Returns the trigger it makes, if any. */
  onPlaying(): Trigger | null {
    const t = this.now();
    this.graceFrom ??= t;
    this.checkOutage();
    const start = this.countedStart();
    if (start !== null) {
      // The wait that ends a start without evidence (no measurement that the link was too slow) is
      // no stall: a version that cannot start for another reason must not drive Auto down.
      const kept = this.attemptPlayed || this.hasEvidence();
      if (kept && t - start >= STALL_MIN_MS) this.stalls.push({ end: t, duration: t - start });
    }
    this.stallStart = null;
    this.exempt = false;
    this.seekOnly = false;
    this.renderer = false;
    this.waiting = false;
    this.outage = false;
    this.lastDataAt = t;
    this.planPlayed = true;
    this.attemptPlayed = true;
    return this.evaluate();
  }

  /** A pause ends the wait uncounted. */
  onPause(): void {
    this.stallStart = null;
    this.renderer = false;
    this.waiting = false;
  }

  /** A seek ends the wait uncounted and owns the buffering until playback runs again. */
  onSeeking(): void {
    // Before the plan has played, a seek (the start position) is part of the start wait.
    if (!this.planPlayed) return;
    this.stallStart = null;
    this.renderer = false;
    // The wait that was in progress is over (and with it an outage that was flagged for it).
    this.waiting = false;
    this.outage = false;
    this.seekOnly = !this.exempt || this.seekOnly;
    this.exempt = true;
  }

  /**
   * The seek is done. When playback runs then (`playing`: not paused, with data for the next
   * frame) and no wait began during the seek, the exemption ends here; otherwise it ends at the
   * next frame.
   */
  onSeeked(playing: boolean): void {
    if (this.exempt && this.seekOnly && playing) {
      this.exempt = false;
      this.seekOnly = false;
    }
  }

  /** The end of the media, a source reload or a reconnect: no wait counts until the next frame. */
  interrupt(): void {
    this.stallStart = null;
    this.renderer = false;
    this.waiting = false;
    this.outage = false;
    this.exempt = true;
    this.seekOnly = false;
  }

  /** Stall history is dropped; a wait in progress is timed from now, with the grace over. */
  clearHistory(): void {
    this.stalls = [];
    const t = this.now();
    this.graceFrom = Math.min(this.graceFrom ?? t, t - STARTUP_GRACE_MS);
    if (this.stallStart !== null) this.stallStart = t;
  }

  /** Media data arrived (a segment, a range, the buffer grew). True when it ended an outage. */
  onMediaData(): boolean {
    // A wait that was silent for the limit was an outage, even if nobody looked at that moment.
    this.checkOutage();
    this.lastDataAt = this.now();
    if (!this.outage) return false;
    this.outage = false;
    this.exempt = false;
    // The wait goes on, now with a working link: it is timed from here.
    if (this.waiting) this.stallStart = this.lastDataAt;
    return true;
  }

  /** A counted wait is in progress. */
  get stalling(): boolean {
    return this.stallStart !== null && !this.exempt;
  }

  /** A renderer wait is in progress: it may still turn into a stall. */
  get rendererWait(): boolean {
    return this.renderer;
  }

  /**
   * The buffer changed while a wait lasts. A renderer wait whose buffer ran down to
   * `RENDERER_WAIT_BUFFER_MS` becomes a stall, counted from now. More than `RENDERER_WAIT_AMPLE_MS`
   * found during a stall ends it as a renderer wait that stays one until playback runs.
   */
  onBuffered(bufferedAheadMs: number): void {
    if (this.renderer && bufferedAheadMs <= RENDERER_WAIT_BUFFER_MS) {
      this.renderer = false;
      this.stallStart = this.now();
    } else if (this.stallStart !== null && bufferedAheadMs > RENDERER_WAIT_AMPLE_MS) {
      this.stallStart = null;
      this.exempt = true;
    }
  }

  /** Milliseconds until the wait in progress reaches `LONG_STALL_MS`; null when none is. */
  msUntilLongStall(): number | null {
    const start = this.countedStart();
    return start === null ? null : Math.max(0, start + LONG_STALL_MS - this.now());
  }

  /** Whether the history says to act now. It does not consume anything. */
  evaluate(): Trigger | null {
    this.checkOutage();
    if (!this.attemptPlayed && !this.hasEvidence()) return null;
    const t = this.now();
    this.stalls = this.stalls.filter((stall) => stall.end >= t - STALL_WINDOW_MS);
    const start = this.countedStart();
    if (start !== null && t - start >= LONG_STALL_MS) return 'long_stall';
    if (this.stalls.some((stall) => stall.duration >= LONG_STALL_MS)) return 'long_stall';
    if (this.stalls.length >= STALLS_BEFORE_TRIGGER) return 'two_stalls';
    return null;
  }

  /** A wait on a link that has been silent for the limit is an outage: uncounted, not evaluated. */
  private checkOutage(): void {
    if (this.stallStart === null || this.exempt) return;
    if (this.now() - this.lastDataAt < this.silenceMs) return;
    this.stallStart = null;
    this.exempt = true;
    this.seekOnly = false;
    this.outage = true;
  }

  /** Where the wait in progress counts from: its start, or the end of the startup grace. */
  private countedStart(): number | null {
    if (this.stallStart === null || this.exempt) return null;
    return Math.max(this.stallStart, (this.graceFrom ?? this.stallStart) + STARTUP_GRACE_MS);
  }
}

/** What the title remembers between triggers: the answer, the waits and the kept estimate. */
export class BufferingPolicy {
  /** "Keep quality" or "Restore quality" was the viewer's answer at this quality. */
  private answered = false;
  private reofferAt = 0;
  private noLowerUntil = 0;
  private cantLowerShown = false;
  private kept: number | null = null;

  constructor(private readonly now: Clock) {}

  get isAnswered(): boolean {
    return this.answered;
  }

  /** The estimate later Auto replans of this attempt repeat; null when none. */
  get keptEstimate(): number | null {
    return this.kept;
  }

  keepEstimate(kbps: number): void {
    this.kept = kbps;
  }

  dropEstimate(): void {
    this.kept = null;
  }

  /** The viewer answered ("Keep quality", "Restore quality"). */
  answer(): void {
    this.answered = true;
  }

  /** The viewer changed the quality: the answer, the re-offer wait and the kept estimate are gone. */
  qualityChanged(): void {
    this.answered = false;
    this.reofferAt = 0;
    this.kept = null;
  }

  /** A prompt timed out: the next one waits until `REOFFER_MIN_MS` after it first appeared. */
  promptTimedOut(shownAt: number): void {
    this.reofferAt = shownAt + REOFFER_MIN_MS;
  }

  /** "Can't go lower": the plan is left alone. True when the notice is to show (once per title). */
  noLower(): boolean {
    this.noLowerUntil = this.now() + NO_LOWER_COOLDOWN_MS;
    const first = !this.cantLowerShown;
    this.cantLowerShown = true;
    return first;
  }

  /** A lowering that was refused or never adopted: watch again after a minute. */
  rearmLater(): void {
    this.noLowerUntil = Math.max(this.noLowerUntil, this.now() + REARM_AFTER_UNADOPTED_MS);
  }

  /** What keeps a trigger from acting: the answer, or a wait that is not over (ms); 0 when none. */
  blockedForMs(): number {
    const until = Math.max(this.reofferAt, this.noLowerUntil);
    return Math.max(0, until - this.now());
  }
}

/** The bitrate the plan delivers in kbit/s: the recipe's, else the source's; null when unknown. */
export function deliveredKbps(plan: Plan): number | null {
  const recipe = plan.effective_recipe.bitrate_kbps;
  if (typeof recipe === 'number' && recipe > 0) return recipe;
  const source = plan.source.bitrate_kbps;
  return typeof source === 'number' && source > 0 ? source : null;
}

/** The estimate Auto steps down to: 70 % of the delivered bitrate, in whole integers. */
export function stepDownEstimate(deliveredKbit: number): number {
  return Math.floor((deliveredKbit * 7) / 10);
}

/**
 * The highest quality entry below what plays now (the lower of the delivered bitrate and the
 * bitrates of the entry the viewer picked and the entry the plan names), or null.
 */
export function lowerRung(plan: Plan, picked: string): { label: string } | null {
  const entries = plan.available_qualities;
  const ceilings: number[] = [];
  const delivered = deliveredKbps(plan);
  if (delivered !== null) ceilings.push(delivered);
  for (const label of [picked, plan.active_quality]) {
    const bitrate = entries.find((entry) => entry.label === label)?.bitrate_kbps;
    if (typeof bitrate === 'number' && bitrate > 0) ceilings.push(bitrate);
  }
  if (ceilings.length === 0) return null;
  const ceiling = Math.min(...ceilings);
  let best: { label: string; bitrate: number } | null = null;
  for (const entry of entries) {
    const bitrate = entry.bitrate_kbps;
    if (typeof bitrate !== 'number' || bitrate <= 0 || bitrate >= ceiling) continue;
    if (!best || bitrate > best.bitrate) best = { label: entry.label, bitrate };
  }
  return best ? { label: best.label } : null;
}

/** Whether `next` is a lowering of `previous`; a plan that names no bitrate counts as lower. */
export function isLowerPlan(previousKbps: number | null, next: Plan): boolean {
  if ((next.degradation_warnings ?? []).some((w) => w.code === 'quality_reduction_unavailable')) {
    return false;
  }
  const nextKbps = deliveredKbps(next);
  return nextKbps === null || previousKbps === null || nextKbps < previousKbps;
}

/** The player's throughput in kbit/s from hls.js's bit/s estimate; null without one. */
export function throughputKbps(bitsPerSecond: number | null): number | null {
  return bitsPerSecond !== null && bitsPerSecond > 0 ? Math.round(bitsPerSecond / 1000) : null;
}

/** The end of the buffered range that holds the playhead; null when none does. */
export function bufferedEndAround(
  ranges: readonly { start: number; end: number }[],
  currentTime: number,
): number | null {
  const range = ranges.find((r) => r.start <= currentTime + 0.1 && r.end >= currentTime);
  return range ? range.end : null;
}

/** The media buffered past the playhead, in ms. */
export function bufferedAheadMs(
  ranges: readonly { start: number; end: number }[],
  currentTime: number,
): number {
  const end = bufferedEndAround(ranges, currentTime);
  return end === null ? 0 : Math.max(0, (end - currentTime) * 1000);
}

/** What one request says about buffering. `lowering` is the controller's own; `restore` its undo. */
export interface BufferingRequest {
  /** The server's settings know `playback.buffering_quality_mode`: the buffering fields are allowed. */
  feature: boolean;
  mode: BufferingMode;
  /** The quality preference the request sends is `auto`. */
  auto: boolean;
  keptKbps: number | null;
  lowering?: { estimateKbps: number; observedKbps: number | null };
  restore?: boolean;
  /** A quality change that goes back to the quality before one that did not play. */
  fallback?: boolean;
}

export interface BufferingFields {
  bandwidth_estimate_kbps?: number;
  bandwidth_estimate_source?: 'observed_rebuffer';
  observed_throughput_kbps?: number;
  learned_limit?: 'ignore' | 'clear';
}

/**
 * The body fields of a start or replan. The source, the observed throughput and the learned-limit
 * control exist only with the feature; the estimate itself is the older field and goes without it.
 */
export function bufferingFields(request: BufferingRequest): BufferingFields {
  const { feature, lowering } = request;
  if (lowering) {
    return {
      bandwidth_estimate_kbps: lowering.estimateKbps,
      ...(feature
        ? {
            bandwidth_estimate_source: 'observed_rebuffer' as const,
            ...(lowering.observedKbps !== null
              ? { observed_throughput_kbps: lowering.observedKbps }
              : {}),
          }
        : {}),
    };
  }
  if (request.restore) return feature ? { learned_limit: 'clear' } : {};
  return {
    // Later Auto replans repeat the kept estimate, as an earlier observation (no source).
    ...(request.auto && request.keptKbps !== null && !request.fallback
      ? { bandwidth_estimate_kbps: request.keptKbps }
      : {}),
    ...(feature && request.mode === 'never' ? { learned_limit: 'ignore' as const } : {}),
  };
}

/** The features a start or replan advertises. */
export function clientFeatures(base: readonly string[], feature: boolean): string[] {
  return feature ? [...base, BUFFERING_FEATURE] : [...base];
}

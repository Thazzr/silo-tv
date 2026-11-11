// The buffering controller of one title: it feeds the player's events to the stall detector, and
// when playback keeps buffering it lowers the quality, or asks first, or only watches, per the
// profile's mode (src/playback/session/bufferingQuality.ts holds the rules; this class holds the
// timers and talks to the session). The screen shows what it offers (the prompt, the undo pill, the
// notices) and reports the viewer's answers back.
import type { PlayerEngine } from '../engine/PlayerEngine';
import {
  BufferingPolicy,
  StallDetector,
  bufferedAheadMs,
  bufferedEndAround,
  deliveredKbps,
  isLowerPlan,
  lowerRung,
  stepDownEstimate,
  throughputKbps,
  MIN_ESTIMATE_KBPS,
  OUTAGE_NO_DATA_MS,
  OUTAGE_NO_DATA_SEGMENTED_MS,
  REARM_AFTER_UNADOPTED_MS,
  type BufferingMode,
  type Clock,
} from './bufferingQuality';
import type { Plan, ReplanOptions, ReplanResult } from './types';

export interface BufferingOffer {
  /** A question (Lower / Keep), or the undo of a lowering that already happened. */
  kind: 'prompt' | 'undo';
  /** A new offer has a new id; the screen's countdown belongs to it. */
  id: number;
}

export interface BufferingNotice {
  kind: 'cantLower' | 'lowered';
  id: number;
}

/** What the screen shows of the buffering controller. */
export interface BufferingView {
  offer: BufferingOffer | null;
  notice: BufferingNotice | null;
}

export const NO_BUFFERING_VIEW: BufferingView = { offer: null, notice: null };

/** The viewer's answers, and the screen's timeout. */
export type BufferingAnswer = 'lower' | 'keep' | 'restore' | 'expire' | 'hide';

export interface BufferingDeps {
  /** The mode, and whether the server's settings know it (the buffering request fields). */
  settings(): { feature: boolean; mode: BufferingMode };
  plan(): Plan | null;
  /** The quality preference; null before a start decided it (it is `auto` then). */
  quality(): string | null;
  engine(): PlayerEngine | null;
  isStopped(): boolean;
  isReplanning(): boolean;
  recoveryActive(): boolean;
  qualityChange(
    label: string,
    extra?: Pick<ReplanOptions, 'lowering' | 'restore'>,
  ): Promise<ReplanResult>;
  onView(view: BufferingView): void;
  /** Real time in ms; default `Date.now`. */
  now?: Clock;
}

const RENDERER_RECHECK_MS = 500;

type Target = { auto: true; estimateKbps: number } | { auto: false; label: string };

export class BufferingManager {
  private readonly now: Clock;
  private readonly policy: BufferingPolicy;
  private readonly detector: StallDetector;
  private view: BufferingView = NO_BUFFERING_VIEW;
  private seq = 0;
  /** The offer first appeared on screen at this time. */
  private shownAt: number | null = null;
  /** The controller's own replan (a lowering or an undo) is in flight. */
  private busy = false;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;
  private rearmTimer: ReturnType<typeof setTimeout> | null = null;
  /** While a renderer wait lasts, the buffer is looked at again on this interval. */
  private rendererTimer: ReturnType<typeof setInterval> | null = null;
  /** While a wait lasts, the buffered end is sampled on this interval. */
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  /** The buffered end around the playhead at the last sample of this plan. */
  private lastEnd: number | null = null;
  private offEngine: (() => void)[] = [];

  constructor(private readonly deps: BufferingDeps) {
    // Read through `Date` each time, so a clock that is faked later is still the one used.
    this.now = deps.now ?? (() => Date.now());
    this.policy = new BufferingPolicy(this.now);
    this.detector = new StallDetector(this.now, () => this.hasEvidence());
  }

  /** The estimate later Auto replans of this attempt repeat; null when none. */
  get keptKbps(): number | null {
    return this.policy.keptEstimate;
  }

  // --- The player's events -------------------------------------------------------------------

  /** The engine of the video: its media data and its seeks feed the detector. Null detaches. */
  attach(engine: PlayerEngine | null): void {
    for (const off of this.offEngine) off();
    this.offEngine = [];
    if (!engine) return;
    this.offEngine = [
      engine.on('data', () => {
        // Data that ends an outage re-times the wait, so its long-stall timer starts again.
        if (this.detector.onMediaData() && this.detector.stalling) this.armLongStall();
      }),
      // A seek into buffered data raises no `playing`: when playback runs at its end, so does the
      // exemption.
      engine.on('seeked', () => this.detector.onSeeked(!engine.paused && engine.hasFutureData)),
    ];
  }

  waiting(): void {
    const engine = this.deps.engine();
    if (!engine || this.deps.isStopped()) return;
    // The reconnect owns a wait in an outage.
    if (this.deps.recoveryActive()) {
      this.detector.interrupt();
      return;
    }
    // HLS segments can take long to be produced: its silence limit is longer.
    this.detector.setSilenceLimit(
      engine.decoder === 'hlsjs' ? OUTAGE_NO_DATA_SEGMENTED_MS : OUTAGE_NO_DATA_MS,
    );
    // A buffer that grew is media data, whether or not the element said so.
    this.sampleBuffer();
    this.detector.onWaiting(bufferedAheadMs(engine.buffered, engine.currentTime), engine.paused);
    this.armLongStall();
    this.armRenderer();
    this.armSampling();
  }

  playing(): void {
    this.clearWatch();
    if (this.deps.isStopped()) return;
    this.sampleBuffer();
    const trigger = this.detector.onPlaying();
    if (trigger) this.act();
  }

  paused(): void {
    this.clearWatch();
    this.detector.onPause();
  }

  seeking(): void {
    this.clearWatch();
    // The buffered end jumps with the playhead: that is no data.
    this.lastEnd = null;
    this.detector.onSeeking();
  }

  /** The end of the media, or an outage: nothing counts until a frame plays. */
  interrupted(): void {
    this.clearWatch();
    this.detector.interrupt();
  }

  /** A plan was adopted (by this controller or another replan); `reload`: a new source loads. */
  adopted(reload: boolean): void {
    this.clearWatch();
    this.lastEnd = null;
    this.detector.planAdopted(reload);
    // An adoption the controller did not ask for takes the pills away; its own keeps its undo.
    if (!this.busy) this.setOffer(null);
  }

  /** A start: a new attempt. The kept estimate and the pills go; the title's answers stay. */
  started(): void {
    this.clearWatch();
    this.lastEnd = null;
    this.detector.newAttempt();
    this.policy.dropEstimate();
    this.setOffer(null);
  }

  // --- The viewer's quality picks --------------------------------------------------------------

  /** A pick is sent: its pills go, and nothing prompts while it is pending. */
  pickSent(): void {
    this.setOffer(null);
  }

  /** The pick's plan was adopted: the answer, the history and the kept estimate start over. */
  pickApplied(): void {
    this.policy.qualityChanged();
    this.detector.clearHistory();
    this.setOffer(null);
    this.check();
  }

  /** The pick was refused: a long stall in progress is looked at again. */
  pickFailed(): void {
    this.check();
  }

  /** A quality that did not play went back to the quality before: its lowering is forgotten. */
  qualityFellBack(): void {
    this.policy.dropEstimate();
  }

  // --- The screen's side --------------------------------------------------------------------------

  /** The offer is on screen now (its countdown runs from here). */
  shown(id: number): void {
    if (this.view.offer?.id === id && this.shownAt === null) this.shownAt = this.now();
  }

  answer(answer: BufferingAnswer): void {
    const offer = this.view.offer;
    if (!offer) return;
    if (offer.kind === 'prompt') {
      if (answer === 'lower') {
        this.setOffer(null);
        const target = this.target();
        if (target) void this.lower(target);
        else this.cantLower();
      } else if (answer === 'keep') {
        this.policy.answer();
        this.setOffer(null);
      } else if (answer === 'expire') {
        // Not an answer: the history starts over, and the next prompt waits.
        this.policy.promptTimedOut(this.shownAt ?? this.now());
        this.detector.clearHistory();
        this.setOffer(null);
        this.check();
      }
      return;
    }
    if (answer === 'restore') {
      this.setOffer(null);
      this.policy.answer();
      this.policy.dropEstimate();
      void this.undo();
    } else if (answer === 'expire' || answer === 'hide') {
      // Back or the timer only hides the pill; it does not answer the title.
      this.setOffer(null);
      this.check();
    }
  }

  dispose(): void {
    this.attach(null);
    this.clearWatch();
    if (this.rearmTimer) clearTimeout(this.rearmTimer);
    this.rearmTimer = null;
  }

  // --- Acting ---------------------------------------------------------------------------------------

  /** The measured throughput is below the delivered bitrate: the link is the slow part. */
  private hasEvidence(): boolean {
    const plan = this.deps.plan();
    const delivered = plan ? deliveredKbps(plan) : null;
    const measured = throughputKbps(this.deps.engine()?.bandwidthEstimate ?? null);
    return delivered !== null && measured !== null && measured < delivered;
  }

  /** The long-stall timer: the wait in progress reaches the trigger while it still lasts. */
  private armLongStall(): void {
    if (this.longTimer) clearTimeout(this.longTimer);
    if (this.recheckTimer) clearTimeout(this.recheckTimer);
    this.longTimer = null;
    this.recheckTimer = null;
    const wait = this.detector.msUntilLongStall();
    if (wait === null) return;
    this.longTimer = setTimeout(() => {
      this.longTimer = null;
      this.check();
    }, wait);
  }

  /** A renderer wait turns into a stall when the buffer runs down: look at it every 500 ms. */
  private armRenderer(): void {
    if (!this.detector.rendererWait || this.rendererTimer) return;
    this.rendererTimer = setInterval(() => {
      this.sampleBuffer();
      const engine = this.deps.engine();
      if (!engine || !this.detector.rendererWait) {
        this.clearRenderer();
        return;
      }
      this.detector.onBuffered(bufferedAheadMs(engine.buffered, engine.currentTime));
      if (this.detector.stalling) {
        // It is a stall now, counted from here: its long-stall timer starts.
        this.armLongStall();
      }
    }, RENDERER_RECHECK_MS);
  }

  /**
   * Samples the buffered end around the playhead. When it moved forward since the last sample of
   * this plan, that is media data (the doc's "buffered position advances"), reported before any
   * evaluation so a check never declares an outage while the buffer grew.
   */
  private sampleBuffer(): void {
    const engine = this.deps.engine();
    if (!engine) return;
    const end = bufferedEndAround(engine.buffered, engine.currentTime);
    if (end === null) return;
    const grew = this.lastEnd !== null && end > this.lastEnd;
    this.lastEnd = end;
    if (grew && this.detector.onMediaData() && this.detector.stalling) this.armLongStall();
  }

  /** Once a second while a wait lasts, so a slowly growing buffer is seen between the checks. */
  private armSampling(): void {
    if (this.sampleTimer) return;
    this.sampleTimer = setInterval(() => this.sampleBuffer(), 1000);
  }

  private clearRenderer(): void {
    if (this.rendererTimer) clearInterval(this.rendererTimer);
    this.rendererTimer = null;
  }

  private clearWatch(): void {
    if (this.longTimer) clearTimeout(this.longTimer);
    if (this.recheckTimer) clearTimeout(this.recheckTimer);
    if (this.rendererTimer) clearInterval(this.rendererTimer);
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    this.rendererTimer = null;
    this.sampleTimer = null;
    this.longTimer = null;
    this.recheckTimer = null;
  }

  /** Looks at a wait in progress again (a suppression ended, or its timer ran out). */
  private check(): void {
    const engine = this.deps.engine();
    if (!engine || !this.detector.stalling) return;
    this.sampleBuffer();
    this.detector.onBuffered(bufferedAheadMs(engine.buffered, engine.currentTime));
    if (this.detector.evaluate()) {
      this.act();
      return;
    }
    // The wait goes on but is not long enough yet (its history was just cleared, or it was timed
    // again): look at it again when it will be. Nothing to wait for means no timer.
    const wait = this.detector.msUntilLongStall();
    if (wait !== null && wait > 0) this.armLongStall();
  }

  /** The trigger fired: lower, ask, say "can't", or let it be. */
  private act(): void {
    const { deps } = this;
    if (deps.isStopped() || !deps.plan()) return;
    // A suppressed trigger leaves the history as it is.
    if (this.busy || deps.isReplanning() || deps.recoveryActive()) return;
    if (this.view.offer || this.policy.isAnswered) return;
    const wait = this.policy.blockedForMs();
    if (wait > 0) {
      // A wait in progress is looked at again when the suppression ends.
      if (this.detector.stalling) {
        if (this.recheckTimer) clearTimeout(this.recheckTimer);
        this.recheckTimer = setTimeout(() => {
          this.recheckTimer = null;
          this.check();
        }, wait);
      }
      return;
    }
    const { mode } = deps.settings();
    // `never` only watches.
    if (mode === 'never') return;
    const target = this.target();
    if (!target) {
      this.cantLower();
      return;
    }
    // A quality the viewer picked is never lowered without asking.
    if (mode === 'always' && target.auto) void this.lower(target);
    else this.offer('prompt');
  }

  /** Nothing lower to go to: the notice shows once per title, and the plan is left alone for a while. */
  private cantLower(): void {
    if (this.policy.noLower()) this.notice('cantLower');
  }

  /** What a lowering would ask for now, or null when there is nothing lower. */
  private target(): Target | null {
    const plan = this.deps.plan();
    if (!plan) return null;
    const quality = this.deps.quality() ?? 'auto';
    if (quality === 'auto') {
      const delivered = deliveredKbps(plan);
      if (delivered === null) return null;
      const estimateKbps = stepDownEstimate(delivered);
      return estimateKbps >= MIN_ESTIMATE_KBPS ? { auto: true, estimateKbps } : null;
    }
    const rung = lowerRung(plan, quality);
    return rung ? { auto: false, label: rung.label } : null;
  }

  /** A lowering that throws is a lowering that was not applied: watch again in a minute. */
  private async lower(target: Target): Promise<void> {
    try {
      await this.lowerNow(target);
    } catch {
      this.busy = false;
      if (!this.deps.isStopped()) this.rearmLater();
    }
  }

  private async lowerNow(target: Target): Promise<void> {
    const plan = this.deps.plan();
    if (!plan) return;
    const previous = deliveredKbps(plan);
    const keptBefore = this.policy.keptEstimate;
    this.busy = true;
    let result: ReplanResult;
    try {
      if (target.auto) {
        // Kept from the moment the replan is sent; its own request carries it with its source.
        this.policy.keepEstimate(target.estimateKbps);
        result = await this.deps.qualityChange('auto', {
          lowering: {
            estimateKbps: target.estimateKbps,
            observedKbps: throughputKbps(this.deps.engine()?.bandwidthEstimate ?? null),
          },
        });
      } else {
        result = await this.deps.qualityChange(target.label);
      }
    } finally {
      this.busy = false;
    }
    if (this.deps.isStopped()) return;
    if (result.kind === 'busy') {
      // Nothing was sent: nothing is kept.
      if (keptBefore === null) this.policy.dropEstimate();
      else this.policy.keepEstimate(keptBefore);
    }
    if (result.kind !== 'applied') {
      // Keep playing; watch the plan again in a minute, with fresh history and no grace.
      this.rearmLater();
      return;
    }
    const next = this.deps.plan();
    if (!next) return;
    if (!isLowerPlan(previous, next)) {
      this.policy.noLower();
      this.notice('cantLower');
      return;
    }
    if (target.auto) this.offer('undo');
    else this.notice('lowered');
  }

  private async undo(): Promise<void> {
    this.busy = true;
    try {
      await this.deps.qualityChange('auto', { restore: true });
    } catch {
      // Nothing to undo then; the plan keeps playing.
    } finally {
      this.busy = false;
    }
  }

  private rearmLater(): void {
    this.policy.rearmLater();
    if (this.rearmTimer) clearTimeout(this.rearmTimer);
    this.rearmTimer = setTimeout(() => {
      this.rearmTimer = null;
      this.detector.clearHistory();
      this.check();
    }, REARM_AFTER_UNADOPTED_MS);
  }

  // --- The view ---------------------------------------------------------------------------------------

  private offer(kind: BufferingOffer['kind']): void {
    this.seq += 1;
    this.shownAt = null;
    this.emit({ ...this.view, offer: { kind, id: this.seq } });
  }

  private setOffer(offer: null): void {
    if (this.view.offer === null) return;
    this.shownAt = null;
    this.emit({ ...this.view, offer });
  }

  private notice(kind: BufferingNotice['kind']): void {
    this.seq += 1;
    this.emit({ ...this.view, notice: { kind, id: this.seq } });
  }

  private emit(view: BufferingView): void {
    this.view = view;
    this.deps.onView(view);
  }
}

// The stall detector, the title's policy and the request fields, on a fake clock.
import { beforeEach, describe, expect, it } from 'vitest';
import { playbackPlan } from '../../test/playbackFixtures';
import {
  BUFFERING_FEATURE,
  BufferingPolicy,
  LONG_STALL_MS,
  RENDERER_WAIT_AMPLE_MS,
  OUTAGE_NO_DATA_MS,
  OUTAGE_NO_DATA_SEGMENTED_MS,
  NO_LOWER_COOLDOWN_MS,
  REARM_AFTER_UNADOPTED_MS,
  REOFFER_MIN_MS,
  STALL_MIN_MS,
  STALL_WINDOW_MS,
  STARTUP_GRACE_MS,
  StallDetector,
  bufferedAheadMs,
  bufferingFields,
  clientFeatures,
  deliveredKbps,
  isLowerPlan,
  lowerRung,
  stepDownEstimate,
  throughputKbps,
} from './bufferingQuality';
import type { Plan } from './types';

let t = 0;
const now = () => t;
const advance = (ms: number) => {
  t += ms;
};

beforeEach(() => {
  t = 1_000_000;
});

/** A detector for the stall rules: the link never counts as silent. */
const quiet = (detector: StallDetector) => {
  detector.setSilenceLimit(Number.MAX_SAFE_INTEGER);
  return detector;
};

/** A detector whose plan has played and whose startup grace is over. */
function settled(evidence = false) {
  const detector = quiet(new StallDetector(now, () => evidence));
  detector.planAdopted(true);
  detector.onPlaying();
  advance(STARTUP_GRACE_MS + 1);
  return detector;
}

/** One wait of `ms` with nothing buffered; returns what the frame that ends it triggers. */
function stall(detector: StallDetector, ms: number) {
  detector.onWaiting(0, false);
  advance(ms);
  return detector.onPlaying();
}

describe('StallDetector: what counts as a stall', () => {
  it('counts a wait of 1000 ms and not one of 999 ms', () => {
    const short = settled();
    stall(short, STALL_MIN_MS - 1);
    advance(1000);
    // A second short one would trigger if the first had counted.
    expect(stall(short, STALL_MIN_MS - 1)).toBeNull();

    const exact = settled();
    stall(exact, STALL_MIN_MS);
    advance(1000);
    expect(stall(exact, STALL_MIN_MS)).toBe('two_stalls');
  });

  it('does not count the first 10 s of a plan, and counts a stall that runs past them from the end of the grace', () => {
    const detector = quiet(new StallDetector(now, () => false));
    detector.planAdopted(true);
    detector.onPlaying(); // the plan plays from t0
    // A wait of 5 s inside the grace: nothing.
    advance(1000);
    detector.onWaiting(0, false);
    advance(5000);
    expect(detector.onPlaying()).toBeNull();
    // A wait from 8 s to 13 s: 3 s of it count (10 s to 13 s)...
    advance(2000);
    detector.onWaiting(0, false);
    expect(detector.msUntilLongStall()).toBe(STARTUP_GRACE_MS + LONG_STALL_MS - 8000);
    advance(5000);
    detector.onPlaying();
    // ...and so is a second counted stall, which triggers.
    advance(1000);
    expect(stall(detector, 1500)).toBe('two_stalls');
  });

  it('does not count a wait with more than 1000 ms buffered ahead (a renderer wait), and counts one with exactly 1000', () => {
    const detector = settled();
    detector.onWaiting(1001, false);
    advance(8000);
    expect(detector.stalling).toBe(false);
    expect(detector.evaluate()).toBeNull();
    detector.onPlaying();
    // The same wait with exactly 1000 ms ahead is the network's.
    detector.onWaiting(1000, false);
    expect(detector.stalling).toBe(true);
  });

  it('leaves a wait that finds more than 5000 ms buffered to the renderer', () => {
    const detector = settled();
    detector.onWaiting(0, false);
    advance(3000);
    detector.onBuffered(5000);
    expect(detector.stalling).toBe(true);
    detector.onBuffered(5001);
    expect(detector.stalling).toBe(false);
    advance(LONG_STALL_MS);
    expect(detector.evaluate()).toBeNull();
  });

  it('does not count the buffering after a seek, until the next frame, and counts the wait after that', () => {
    const detector = settled();
    detector.onSeeking();
    detector.onWaiting(0, false);
    advance(LONG_STALL_MS + 1000);
    expect(detector.evaluate()).toBeNull();
    expect(detector.onPlaying()).toBeNull();
    // A stall after the seek's frame counts again.
    advance(1000);
    stall(detector, 2000);
    advance(1000);
    expect(stall(detector, 2000)).toBe('two_stalls');
  });

  it('treats a seek made before the plan played as part of the start wait', () => {
    const detector = quiet(new StallDetector(now, () => true));
    detector.planAdopted(true);
    // The player applies the start position before the first frame.
    detector.onSeeking();
    detector.onWaiting(0, false);
    advance(STARTUP_GRACE_MS + LONG_STALL_MS);
    // Not exempt: the wait is timed (from the end of its grace), and has evidence.
    expect(detector.stalling).toBe(true);
    expect(detector.evaluate()).toBe('long_stall');
  });

  it('ends a wait uncounted at a pause, and counts none while paused', () => {
    const detector = settled();
    detector.onWaiting(0, false);
    advance(3000);
    detector.onPause();
    advance(10_000);
    expect(detector.evaluate()).toBeNull();
    detector.onWaiting(0, true);
    advance(10_000);
    expect(detector.evaluate()).toBeNull();
    detector.onPlaying();
    // A wait after resuming from a pause is a stall.
    detector.onWaiting(0, false);
    expect(detector.stalling).toBe(true);
  });

  it('does not count the end of the media, a source reload or an outage until the next frame', () => {
    const detector = settled();
    detector.onWaiting(0, false);
    detector.interrupt();
    advance(LONG_STALL_MS * 2);
    expect(detector.evaluate()).toBeNull();
    // Further waits stay exempt until a frame plays.
    detector.onWaiting(0, false);
    advance(LONG_STALL_MS * 2);
    expect(detector.evaluate()).toBeNull();
    detector.onPlaying();
    detector.onWaiting(0, false);
    expect(detector.stalling).toBe(true);

    const adopted = settled();
    adopted.planAdopted(true);
    adopted.onWaiting(0, false);
    advance(LONG_STALL_MS * 3);
    expect(adopted.evaluate()).toBeNull();
  });
});

describe('StallDetector: when it triggers', () => {
  it('triggers on two counted stalls within 120 s', () => {
    const detector = settled();
    expect(stall(detector, 1500)).toBeNull();
    advance(30_000);
    expect(stall(detector, 1500)).toBe('two_stalls');
  });

  it('forgets a stall that ended more than 120 s ago', () => {
    const detector = settled();
    stall(detector, 1500);
    advance(STALL_WINDOW_MS + 1);
    expect(stall(detector, 1500)).toBeNull();
    // Just inside the window still counts.
    const inside = settled();
    stall(inside, 1500);
    advance(STALL_WINDOW_MS - 1500);
    expect(stall(inside, 1500)).toBe('two_stalls');
  });

  it('triggers at 6 s of one stall while it still lasts, not at 5.999 s', () => {
    const detector = settled();
    detector.onWaiting(0, false);
    expect(detector.msUntilLongStall()).toBe(LONG_STALL_MS);
    advance(LONG_STALL_MS - 1);
    expect(detector.evaluate()).toBeNull();
    expect(detector.msUntilLongStall()).toBe(1);
    advance(1);
    expect(detector.evaluate()).toBe('long_stall');
    expect(detector.msUntilLongStall()).toBe(0);
  });

  it('keeps a long stall that ended on the books for the window', () => {
    const detector = settled();
    expect(stall(detector, LONG_STALL_MS + 100)).toBe('long_stall');
    advance(STALL_WINDOW_MS - 1000);
    expect(detector.evaluate()).toBe('long_stall');
    advance(2000);
    expect(detector.evaluate()).toBeNull();
  });

  it('does not trigger before any plan of the attempt has played without evidence of a slow link', () => {
    const none = quiet(new StallDetector(now, () => false));
    none.planAdopted(true);
    none.onWaiting(0, false);
    advance(STARTUP_GRACE_MS + LONG_STALL_MS + 5000);
    expect(none.evaluate()).toBeNull();

    const measured = quiet(new StallDetector(now, () => true));
    measured.planAdopted(true);
    measured.onWaiting(0, false);
    advance(STARTUP_GRACE_MS + LONG_STALL_MS);
    expect(measured.evaluate()).toBe('long_stall');
  });

  it('does not count the wait that ends a start without evidence, and counts it with', () => {
    const run = (evidence: boolean) => {
      const detector = quiet(new StallDetector(now, () => evidence));
      detector.planAdopted(true);
      detector.onWaiting(0, false);
      advance(STARTUP_GRACE_MS + 2000); // 2 s of it count
      detector.onPlaying();
      advance(1000);
      return stall(detector, 1500);
    };
    expect(run(false)).toBeNull();
    expect(run(true)).toBe('two_stalls');
  });

  it('needs no evidence once the attempt has played, also on a new plan', () => {
    const detector = settled(false);
    detector.planAdopted(true);
    detector.onPlaying();
    advance(STARTUP_GRACE_MS + 1);
    detector.onWaiting(0, false);
    advance(LONG_STALL_MS);
    expect(detector.evaluate()).toBe('long_stall');
  });

  it('starts over for a new attempt: the evidence is needed again', () => {
    const detector = settled(false);
    detector.newAttempt();
    detector.onWaiting(0, false);
    advance(STARTUP_GRACE_MS + LONG_STALL_MS);
    expect(detector.evaluate()).toBeNull();
  });

  it('gives a plan that plays on its own grace and no history', () => {
    const detector = settled();
    stall(detector, 1500);
    advance(1000);
    detector.planAdopted(false);
    // The stall before the adoption is gone, and the grace starts now.
    detector.onWaiting(0, false);
    expect(detector.msUntilLongStall()).toBe(STARTUP_GRACE_MS + LONG_STALL_MS);
    advance(STARTUP_GRACE_MS + 2000);
    expect(detector.onPlaying()).toBeNull();
  });

  it('clearHistory drops the stalls and times a wait in progress from now, without grace', () => {
    const detector = settled();
    stall(detector, 1500);
    advance(1000);
    detector.onWaiting(0, false);
    advance(4000);
    detector.clearHistory();
    expect(detector.msUntilLongStall()).toBe(LONG_STALL_MS);
    advance(LONG_STALL_MS);
    expect(detector.evaluate()).toBe('long_stall');
    // The earlier stall is gone: this one alone is not two.
    const other = settled();
    stall(other, 1500);
    other.clearHistory();
    advance(1000);
    expect(stall(other, 1500)).toBeNull();
  });
});

describe('BufferingPolicy', () => {
  it('holds an answer until the viewer changes the quality, and drops the kept estimate then', () => {
    const policy = new BufferingPolicy(now);
    policy.keepEstimate(7000);
    policy.answer();
    expect(policy.isAnswered).toBe(true);
    expect(policy.keptEstimate).toBe(7000);
    policy.qualityChanged();
    expect(policy.isAnswered).toBe(false);
    expect(policy.keptEstimate).toBeNull();
  });

  it('keeps a timed-out prompt from coming back for 120 s after it first appeared', () => {
    const policy = new BufferingPolicy(now);
    const shownAt = t;
    advance(15_000);
    policy.promptTimedOut(shownAt);
    expect(policy.blockedForMs()).toBe(REOFFER_MIN_MS - 15_000);
    advance(REOFFER_MIN_MS - 15_000);
    expect(policy.blockedForMs()).toBe(0);
  });

  it('a quality change ends the re-offer wait', () => {
    const policy = new BufferingPolicy(now);
    policy.promptTimedOut(t);
    policy.qualityChanged();
    expect(policy.blockedForMs()).toBe(0);
  });

  it("shows the can't-go-lower notice once per title and leaves the plan alone for 300 s each time", () => {
    const policy = new BufferingPolicy(now);
    expect(policy.noLower()).toBe(true);
    expect(policy.blockedForMs()).toBe(NO_LOWER_COOLDOWN_MS);
    advance(NO_LOWER_COOLDOWN_MS);
    expect(policy.blockedForMs()).toBe(0);
    expect(policy.noLower()).toBe(false);
    expect(policy.blockedForMs()).toBe(NO_LOWER_COOLDOWN_MS);
  });

  it('watches a plan again after a minute when its lowering was not adopted', () => {
    const policy = new BufferingPolicy(now);
    policy.rearmLater();
    expect(policy.blockedForMs()).toBe(REARM_AFTER_UNADOPTED_MS);
    // It never shortens a longer wait.
    policy.noLower();
    policy.rearmLater();
    expect(policy.blockedForMs()).toBe(NO_LOWER_COOLDOWN_MS);
  });

  it('drops the kept estimate on request', () => {
    const policy = new BufferingPolicy(now);
    policy.keepEstimate(1234);
    policy.dropEstimate();
    expect(policy.keptEstimate).toBeNull();
  });
});

const plan = (overrides: Partial<Plan> = {}) => playbackPlan(overrides);
const rung = (label: string, bitrate_kbps?: number) => ({
  label,
  preserves_source: false,
  ...(bitrate_kbps !== undefined ? { bitrate_kbps } : {}),
});

describe('the pure helpers', () => {
  it("takes the recipe's bitrate, else the source's, else none", () => {
    const withRecipe = plan({
      effective_recipe: { video_codec: 'h264', audio_codec: 'aac', bitrate_kbps: 6000 },
    });
    withRecipe.source.bitrate_kbps = 9000;
    expect(deliveredKbps(withRecipe)).toBe(6000);
    const sourceOnly = plan();
    sourceOnly.source.bitrate_kbps = 9000;
    expect(deliveredKbps(sourceOnly)).toBe(9000);
    expect(deliveredKbps(plan())).toBeNull();
    const zero = plan({
      effective_recipe: { video_codec: 'h264', audio_codec: 'aac', bitrate_kbps: 0 },
    });
    expect(deliveredKbps(zero)).toBeNull();
  });

  it('steps down to 70 % in exact integers', () => {
    expect(stepDownEstimate(22120)).toBe(15484);
    expect(stepDownEstimate(10_000)).toBe(7000);
    expect(stepDownEstimate(143)).toBe(100);
    expect(stepDownEstimate(142)).toBe(99);
  });

  it('picks the highest rung below the lower of what plays and the entries named', () => {
    const entries = [
      rung('2160p', 40_000),
      rung('1080p', 8000),
      rung('720p', 4000),
      rung('480p', 1500),
    ];
    const playing = plan({ available_qualities: entries });
    playing.source.bitrate_kbps = 30_000;
    // Delivered 30 Mbit/s, the picked entry 8000: below 8000 is 720p.
    expect(lowerRung(playing, '1080p')).toEqual({ label: '720p' });
    expect(lowerRung(playing, '720p')).toEqual({ label: '480p' });
    // The lowest has nothing below.
    expect(lowerRung(playing, '480p')).toBeNull();
    // A cap lowered the encode below the picked entry: the rung below must be below what plays.
    const capped = plan({ available_qualities: entries, active_quality: '1080p' });
    capped.effective_recipe.bitrate_kbps = 3000;
    expect(lowerRung(capped, '1080p')).toEqual({ label: '480p' });
  });

  it('ignores entries with no bitrate and gives null without anything to compare', () => {
    const unnamed = plan({ available_qualities: [rung('1080p'), rung('720p', 4000)] });
    expect(lowerRung(unnamed, '1080p')).toBeNull();
    const named = plan({
      available_qualities: [rung('1080p'), rung('720p', 4000), rung('480p', 1500)],
    });
    named.source.bitrate_kbps = 9000;
    expect(lowerRung(named, '1080p')).toEqual({ label: '720p' });
  });

  it('says a plan is lower when its bitrate is, or when it names none, unless it could not reduce', () => {
    const lower = plan({
      effective_recipe: { video_codec: 'h264', audio_codec: 'aac', bitrate_kbps: 5000 },
    });
    expect(isLowerPlan(8000, lower)).toBe(true);
    expect(isLowerPlan(5000, lower)).toBe(false);
    expect(isLowerPlan(4000, lower)).toBe(false);
    expect(isLowerPlan(8000, plan())).toBe(true);
    expect(isLowerPlan(null, lower)).toBe(true);
    const unavailable = plan({
      degradation_warnings: [{ code: 'quality_reduction_unavailable', message: 'x' }],
    });
    expect(isLowerPlan(8000, unavailable)).toBe(false);
  });

  it('turns bit/s into kbit/s and has none for nothing', () => {
    expect(throughputKbps(4_000_000)).toBe(4000);
    expect(throughputKbps(null)).toBeNull();
    expect(throughputKbps(0)).toBeNull();
  });

  it('measures what is buffered past the playhead', () => {
    expect(bufferedAheadMs([{ start: 0, end: 12 }], 10)).toBe(2000);
    expect(bufferedAheadMs([{ start: 0, end: 10 }], 10)).toBe(0);
    expect(bufferedAheadMs([{ start: 20, end: 30 }], 10)).toBe(0);
    expect(bufferedAheadMs([], 10)).toBe(0);
  });
});

describe('the request fields', () => {
  const base = { feature: true, mode: 'always' as const, auto: true, keptKbps: null };

  it('advertises the feature only when the server knows the setting', () => {
    expect(clientFeatures(['playback_plan_v3'], true)).toEqual([
      'playback_plan_v3',
      BUFFERING_FEATURE,
    ]);
    expect(clientFeatures(['playback_plan_v3'], false)).toEqual(['playback_plan_v3']);
  });

  it('sends the estimate with its source and the observed throughput for a lowering', () => {
    expect(
      bufferingFields({ ...base, lowering: { estimateKbps: 7000, observedKbps: 4000 } }),
    ).toEqual({
      bandwidth_estimate_kbps: 7000,
      bandwidth_estimate_source: 'observed_rebuffer',
      observed_throughput_kbps: 4000,
    });
    expect(
      bufferingFields({ ...base, lowering: { estimateKbps: 7000, observedKbps: null } }),
    ).toEqual({ bandwidth_estimate_kbps: 7000, bandwidth_estimate_source: 'observed_rebuffer' });
  });

  it('sends only the estimate, no source or throughput, without the feature', () => {
    expect(
      bufferingFields({
        ...base,
        feature: false,
        lowering: { estimateKbps: 7000, observedKbps: 4000 },
      }),
    ).toEqual({ bandwidth_estimate_kbps: 7000 });
  });

  it('repeats the kept estimate on Auto without a source, and never on a picked quality or a fallback', () => {
    expect(bufferingFields({ ...base, keptKbps: 7000 })).toEqual({ bandwidth_estimate_kbps: 7000 });
    expect(bufferingFields({ ...base, keptKbps: 7000, auto: false })).toEqual({});
    expect(bufferingFields({ ...base, keptKbps: 7000, fallback: true })).toEqual({});
    expect(bufferingFields({ ...base, keptKbps: null })).toEqual({});
  });

  it('clears the learned limit on a restore, and sends no estimate', () => {
    expect(bufferingFields({ ...base, keptKbps: 7000, restore: true })).toEqual({
      learned_limit: 'clear',
    });
    expect(bufferingFields({ ...base, feature: false, restore: true })).toEqual({});
  });

  it('ignores the learned limit in never mode, only with the feature', () => {
    expect(bufferingFields({ ...base, mode: 'never' })).toEqual({ learned_limit: 'ignore' });
    expect(bufferingFields({ ...base, mode: 'never', feature: false })).toEqual({});
    expect(bufferingFields({ ...base, mode: 'ask' })).toEqual({});
    expect(bufferingFields({ ...base, mode: 'always' })).toEqual({});
  });
});

describe('StallDetector: the end of a seek', () => {
  it('ends the exemption at seeked when playback runs, so the next wait counts', () => {
    const detector = settled();
    detector.onSeeking();
    detector.onSeeked(true);
    stall(detector, 2000);
    advance(1000);
    expect(stall(detector, 2000)).toBe('two_stalls');
  });

  it('keeps it when the element is paused or has no data for the next frame at seeked', () => {
    const detector = settled();
    detector.onSeeking();
    detector.onSeeked(false);
    detector.onWaiting(0, false);
    advance(LONG_STALL_MS + 1000);
    expect(detector.evaluate()).toBeNull();
    detector.onPlaying();
    // The frame ends it: the next wait counts.
    detector.onWaiting(0, false);
    expect(detector.stalling).toBe(true);
  });

  it('leaves a wait that began during the seek uncounted, even when seeked finds playback running', () => {
    const detector = settled();
    detector.onSeeking();
    detector.onWaiting(0, false);
    detector.onSeeked(true);
    advance(LONG_STALL_MS + 1000);
    expect(detector.evaluate()).toBeNull();
    expect(detector.stalling).toBe(false);
  });

  it('does not end an interruption at seeked', () => {
    const detector = settled();
    detector.interrupt();
    detector.onSeeking();
    detector.onSeeked(true);
    detector.onWaiting(0, false);
    advance(LONG_STALL_MS + 1000);
    expect(detector.evaluate()).toBeNull();
  });
});

describe('StallDetector: a renderer wait that runs low', () => {
  it('becomes a stall, counted from that moment, when the buffer falls to 1000 ms', () => {
    const detector = settled();
    detector.onWaiting(3000, false);
    expect(detector.rendererWait).toBe(true);
    advance(4000);
    detector.onBuffered(1001);
    expect(detector.stalling).toBe(false);
    expect(detector.rendererWait).toBe(true);
    detector.onBuffered(1000);
    expect(detector.rendererWait).toBe(false);
    expect(detector.stalling).toBe(true);
    expect(detector.msUntilLongStall()).toBe(LONG_STALL_MS);
    advance(LONG_STALL_MS - 1);
    expect(detector.evaluate()).toBeNull();
    advance(1);
    expect(detector.evaluate()).toBe('long_stall');
  });

  it('is counted from the conversion, not from when the wait began', () => {
    const detector = settled();
    detector.onWaiting(3000, false);
    advance(4000);
    detector.onBuffered(500);
    advance(STALL_MIN_MS - 1);
    expect(detector.onPlaying()).toBeNull();
    // The 4 s before the conversion did not count: a second 999 ms one is no pair either.
    advance(1000);
    detector.onWaiting(3000, false);
    advance(1000);
    detector.onBuffered(0);
    advance(STALL_MIN_MS);
    expect(detector.onPlaying()).toBeNull();
    advance(1000);
    stall(detector, STALL_MIN_MS);
    advance(1000);
    expect(stall(detector, STALL_MIN_MS)).toBe('two_stalls');
  });

  it('does not convert a wait that ended at a frame, a pause or a seek', () => {
    const detector = settled();
    detector.onWaiting(3000, false);
    detector.onPlaying();
    detector.onBuffered(0);
    expect(detector.stalling).toBe(false);
    detector.onWaiting(3000, false);
    detector.onSeeking();
    detector.onBuffered(0);
    expect(detector.stalling).toBe(false);
  });

  it('keeps a stall that found ample media a renderer wait until playback runs', () => {
    const detector = settled();
    detector.onWaiting(0, false);
    detector.onBuffered(RENDERER_WAIT_AMPLE_MS + 1);
    expect(detector.stalling).toBe(false);
    detector.onBuffered(0);
    expect(detector.stalling).toBe(false);
    advance(LONG_STALL_MS * 2);
    expect(detector.evaluate()).toBeNull();
  });
});

describe('StallDetector: an outage', () => {
  /** Plays, past the grace, with data arriving now. */
  function flowing(limit = OUTAGE_NO_DATA_MS) {
    const detector = new StallDetector(now, () => false);
    detector.setSilenceLimit(limit);
    detector.planAdopted(true);
    detector.onPlaying();
    advance(STARTUP_GRACE_MS + 1);
    detector.onMediaData();
    return detector;
  }

  it('ends a wait uncounted after 4000 ms without data on direct play', () => {
    const detector = flowing();
    detector.onWaiting(0, false);
    advance(OUTAGE_NO_DATA_MS - 1);
    expect(detector.evaluate()).toBeNull();
    expect(detector.stalling).toBe(true);
    advance(1);
    expect(detector.evaluate()).toBeNull();
    expect(detector.stalling).toBe(false);
    advance(LONG_STALL_MS);
    expect(detector.onPlaying()).toBeNull();
    // The silent wait counted for nothing: one more stall is not a pair.
    advance(1000);
    expect(stall(detector, 1500)).toBeNull();
  });

  it('turns the 6 s stall into an outage at 4 s of silence, and keeps it a stall while data arrives', () => {
    const silent = flowing();
    silent.onWaiting(0, false);
    advance(LONG_STALL_MS);
    expect(silent.evaluate()).toBeNull();
    const fed = flowing();
    fed.onWaiting(0, false);
    for (let i = 0; i < 6; i += 1) {
      advance(1000);
      fed.onMediaData();
    }
    expect(fed.evaluate()).toBe('long_stall');
  });

  it('waits 15 s on segmented delivery', () => {
    const detector = flowing(OUTAGE_NO_DATA_SEGMENTED_MS);
    detector.onWaiting(0, false);
    advance(LONG_STALL_MS);
    // 6 s of silence is no outage there: the stall triggers.
    expect(detector.evaluate()).toBe('long_stall');
    const other = flowing(OUTAGE_NO_DATA_SEGMENTED_MS);
    other.onWaiting(0, false);
    advance(OUTAGE_NO_DATA_SEGMENTED_MS - 1);
    expect(other.stalling).toBe(true);
    advance(1);
    expect(other.evaluate()).toBeNull();
    expect(other.stalling).toBe(false);
  });

  it('is an outage at once for a wait that begins on a link already silent', () => {
    const detector = flowing();
    advance(OUTAGE_NO_DATA_MS);
    detector.onWaiting(0, false);
    expect(detector.stalling).toBe(false);
    advance(LONG_STALL_MS * 2);
    expect(detector.evaluate()).toBeNull();
  });

  it('ends when media data arrives, and the wait is timed again from then', () => {
    const detector = flowing();
    detector.onWaiting(0, false);
    advance(OUTAGE_NO_DATA_MS);
    detector.evaluate();
    expect(detector.stalling).toBe(false);
    expect(detector.onMediaData()).toBe(true);
    expect(detector.stalling).toBe(true);
    expect(detector.msUntilLongStall()).toBe(LONG_STALL_MS);
    // Data that arrives outside an outage ends nothing.
    expect(detector.onMediaData()).toBe(false);
  });

  it('ends when playback runs', () => {
    const detector = flowing();
    detector.onWaiting(0, false);
    advance(OUTAGE_NO_DATA_MS + 1000);
    detector.evaluate();
    detector.onPlaying();
    detector.onWaiting(0, false);
    expect(detector.stalling).toBe(true);
  });
});

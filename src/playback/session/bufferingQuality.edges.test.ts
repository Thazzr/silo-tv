// Edge cases of the stall detector and the pure helpers, pinned with literal numbers: what a
// changed constant, a missing reset or a flipped comparison would break.
import { beforeEach, describe, expect, it } from 'vitest';
import { playbackPlan } from '../../test/playbackFixtures';
import {
  BUFFERING_FEATURE,
  MIN_ESTIMATE_KBPS,
  NO_LOWER_COOLDOWN_MS,
  OUTAGE_NO_DATA_MS,
  OUTAGE_NO_DATA_SEGMENTED_MS,
  PROMPT_MS,
  REARM_AFTER_UNADOPTED_MS,
  RENDERER_WAIT_AMPLE_MS,
  RENDERER_WAIT_BUFFER_MS,
  REOFFER_MIN_MS,
  STALLS_BEFORE_TRIGGER,
  STALL_MIN_MS,
  STALL_WINDOW_MS,
  STARTUP_GRACE_MS,
  LONG_STALL_MS,
  StallDetector,
  bufferedAheadMs,
  bufferedEndAround,
  deliveredKbps,
  lowerRung,
  stepDownEstimate,
  throughputKbps,
} from './bufferingQuality';

let t = 0;
const now = () => t;
const advance = (ms: number) => {
  t += ms;
};
beforeEach(() => {
  t = 1_000_000;
});

const quiet = (detector: StallDetector) => {
  detector.setSilenceLimit(Number.MAX_SAFE_INTEGER);
  return detector;
};

function settled(evidence = false) {
  const detector = quiet(new StallDetector(now, () => evidence));
  detector.planAdopted(true);
  detector.onPlaying();
  advance(10_001);
  return detector;
}

function stall(detector: StallDetector, ms: number) {
  detector.onWaiting(0, false);
  advance(ms);
  return detector.onPlaying();
}

/** A plan that plays, past its grace, with data arriving now, on the real silence limit. */
function flowing() {
  const detector = new StallDetector(now, () => false);
  detector.planAdopted(true);
  detector.onPlaying();
  advance(10_001);
  detector.onMediaData();
  return detector;
}

const rung = (label: string, bitrate_kbps?: number) => ({
  label,
  preserves_source: false,
  ...(bitrate_kbps !== undefined ? { bitrate_kbps } : {}),
});

describe('the constants', () => {
  it("are the values of Silo's design doc, in literal numbers", () => {
    expect({
      STALL_MIN_MS,
      LONG_STALL_MS,
      STALL_WINDOW_MS,
      STALLS_BEFORE_TRIGGER,
      STARTUP_GRACE_MS,
      RENDERER_WAIT_BUFFER_MS,
      RENDERER_WAIT_AMPLE_MS,
      PROMPT_MS,
      REOFFER_MIN_MS,
      NO_LOWER_COOLDOWN_MS,
      REARM_AFTER_UNADOPTED_MS,
      MIN_ESTIMATE_KBPS,
      OUTAGE_NO_DATA_MS,
      OUTAGE_NO_DATA_SEGMENTED_MS,
      BUFFERING_FEATURE,
    }).toEqual({
      STALL_MIN_MS: 1000,
      LONG_STALL_MS: 6000,
      STALL_WINDOW_MS: 120_000,
      STALLS_BEFORE_TRIGGER: 2,
      STARTUP_GRACE_MS: 10_000,
      RENDERER_WAIT_BUFFER_MS: 1000,
      RENDERER_WAIT_AMPLE_MS: 5000,
      PROMPT_MS: 15_000,
      REOFFER_MIN_MS: 120_000,
      NO_LOWER_COOLDOWN_MS: 300_000,
      REARM_AFTER_UNADOPTED_MS: 60_000,
      MIN_ESTIMATE_KBPS: 100,
      OUTAGE_NO_DATA_MS: 4000,
      OUTAGE_NO_DATA_SEGMENTED_MS: 15_000,
      BUFFERING_FEATURE: 'buffering_quality_v1',
    });
  });

  it('count a stall from 1000 ms and a window of 120000 ms, with literal times', () => {
    const short = settled();
    stall(short, 999);
    advance(1000);
    expect(stall(short, 999)).toBeNull();
    const exact = settled();
    stall(exact, 1000);
    advance(1000);
    expect(stall(exact, 1000)).toBe('two_stalls');
    const old = settled();
    stall(old, 1500);
    advance(120_001);
    expect(stall(old, 1500)).toBeNull();
  });
});

describe('StallDetector: edges', () => {
  it('a second waiting during a stall does not restart its timer', () => {
    const detector = settled();
    detector.onWaiting(0, false);
    advance(3000);
    detector.onWaiting(0, false);
    advance(3000);
    expect(detector.evaluate()).toBe('long_stall');
  });

  it('a second waiting with nothing buffered keeps a renderer wait a renderer wait', () => {
    const detector = settled();
    detector.onWaiting(3000, false);
    detector.onWaiting(0, false);
    expect(detector.rendererWait).toBe(true);
    expect(detector.stalling).toBe(false);
  });

  it("a wait that began during a seek stays the seek's through a second waiting after seeked", () => {
    const detector = settled();
    detector.onSeeking();
    detector.onWaiting(0, false);
    detector.onSeeked(true);
    detector.onWaiting(0, false);
    advance(7000);
    expect(detector.evaluate()).toBeNull();
  });

  it('a wait on a silent link sets the outage: data ends it and the wait is timed from then', () => {
    const detector = flowing();
    advance(4000);
    detector.onWaiting(0, false);
    expect(detector.stalling).toBe(false);
    expect(detector.onMediaData()).toBe(true);
    expect(detector.stalling).toBe(true);
    expect(detector.msUntilLongStall()).toBe(6000);
  });

  it('a renderer wait ends at a pause', () => {
    const detector = settled();
    detector.onWaiting(3000, false);
    detector.onPause();
    detector.onBuffered(0);
    expect(detector.stalling).toBe(false);
  });

  it('a seek ends a stall or a renderer wait in progress, and seeked leaves nothing to count', () => {
    const stalled = settled();
    stalled.onWaiting(0, false);
    stalled.onSeeking();
    stalled.onSeeked(true);
    advance(7000);
    expect(stalled.evaluate()).toBeNull();
    const renderer = settled();
    renderer.onWaiting(3000, false);
    renderer.onSeeking();
    renderer.onSeeked(true);
    renderer.onBuffered(0);
    expect(renderer.stalling).toBe(false);
    expect(renderer.rendererWait).toBe(false);
  });

  it('two seeks in a row end at seeked, and the next stall counts', () => {
    const detector = settled();
    detector.onSeeking();
    detector.onSeeking();
    detector.onSeeked(true);
    stall(detector, 2000);
    advance(1000);
    expect(stall(detector, 2000)).toBe('two_stalls');
  });

  it('a seek after an interruption does not end it at seeked', () => {
    const detector = settled();
    detector.interrupt();
    detector.onSeeking();
    detector.onSeeked(true);
    detector.onWaiting(0, false);
    advance(7000);
    expect(detector.evaluate()).toBeNull();
  });

  it('a plan that plays on starts over: silence, stall and renderer wait in progress', () => {
    const silent = flowing();
    advance(3000);
    silent.planAdopted(false);
    advance(3000);
    silent.onWaiting(0, false);
    expect(silent.stalling).toBe(true);

    const stalled = settled();
    stalled.onWaiting(0, false);
    stalled.planAdopted(false);
    expect(stalled.stalling).toBe(false);
    const renderer = settled();
    renderer.onWaiting(3000, false);
    renderer.planAdopted(false);
    expect(renderer.rendererWait).toBe(false);
  });

  it('an adoption clears an outage', () => {
    const detector = flowing();
    detector.onWaiting(0, false);
    advance(4000);
    detector.evaluate();
    detector.planAdopted(false);
    expect(detector.onMediaData()).toBe(false);
  });

  it('the grace of a reload starts at its first frame, not at its adoption', () => {
    const detector = settled();
    detector.planAdopted(true);
    advance(20_000);
    detector.onPlaying();
    detector.onWaiting(0, false);
    expect(detector.msUntilLongStall()).toBe(16_000);
  });

  it('clearHistory 2 s into a plan ends the grace', () => {
    const detector = quiet(new StallDetector(now, () => false));
    detector.planAdopted(true);
    detector.onPlaying();
    advance(2000);
    detector.clearHistory();
    detector.onWaiting(0, false);
    expect(detector.msUntilLongStall()).toBe(6000);
  });

  it('a buffer report with no wait does nothing', () => {
    const detector = settled();
    detector.onBuffered(6000);
    detector.onWaiting(0, false);
    expect(detector.stalling).toBe(true);
  });

  it('a finished stall of exactly 6000 ms is a long stall', () => {
    expect(stall(settled(), 6000)).toBe('long_stall');
    expect(stall(settled(), 5999)).toBeNull();
  });

  it('a frame after 5 s of silence counts no stall', () => {
    const detector = flowing();
    detector.onWaiting(0, false);
    advance(5000);
    expect(detector.onPlaying()).toBeNull();
    advance(1000);
    expect(stall(detector, 1500)).toBeNull();
  });

  it('a seek or an interruption ends the wait an outage was flagged for: later data re-times nothing', () => {
    for (const end of ['seek', 'interrupt'] as const) {
      const detector = flowing();
      detector.onWaiting(0, false);
      advance(4000);
      detector.evaluate();
      if (end === 'seek') detector.onSeeking();
      else detector.interrupt();
      expect(detector.onMediaData()).toBe(false);
      expect(detector.stalling).toBe(false);
    }
  });

  it('silence with no wait is no outage', () => {
    const detector = flowing();
    advance(10_000);
    detector.evaluate();
    expect(detector.onMediaData()).toBe(false);
  });

  it('a new attempt alone resets silence, grace, stalls and exemptions', () => {
    const silent = new StallDetector(now, () => false);
    silent.newAttempt();
    advance(3000);
    silent.newAttempt();
    advance(3000);
    silent.onWaiting(0, false);
    expect(silent.stalling).toBe(true);

    const graced = settled();
    graced.newAttempt();
    graced.onWaiting(0, false);
    expect(graced.msUntilLongStall()).toBe(16_000);

    const counted = settled(true);
    stall(counted, 1500);
    counted.newAttempt();
    counted.onPlaying();
    advance(10_001);
    expect(stall(counted, 1500)).toBeNull();

    const exempt = settled(true);
    exempt.interrupt();
    exempt.newAttempt();
    exempt.onWaiting(0, false);
    expect(exempt.stalling).toBe(true);
  });
});

describe('the pure helpers: edges', () => {
  it('steps down 145 to 101', () => {
    expect(stepDownEstimate(145)).toBe(101);
  });

  it('takes the entry the plan names as a ceiling', () => {
    const named = playbackPlan({
      available_qualities: [rung('1080p', 8000), rung('720p', 4000), rung('480p', 1500)],
      active_quality: '720p',
    });
    named.source.bitrate_kbps = 30_000;
    expect(lowerRung(named, '1080p')).toEqual({ label: '480p' });
  });

  it('does not take a picked entry with bitrate 0 as a ceiling, and never offers one as the rung', () => {
    const zero = playbackPlan({ available_qualities: [rung('x', 0), rung('720p', 4000)] });
    zero.source.bitrate_kbps = 9000;
    expect(lowerRung(zero, 'x')).toEqual({ label: '720p' });
    const onlyZero = playbackPlan({ available_qualities: [rung('z', 0), rung('720p', 4000)] });
    onlyZero.source.bitrate_kbps = 3000;
    expect(lowerRung(onlyZero, '720p')).toBeNull();
  });

  it('gives the highest rung below the ceiling for entries in ascending order', () => {
    const ascending = playbackPlan({
      available_qualities: [rung('480p', 1500), rung('720p', 4000), rung('1080p', 8000)],
    });
    ascending.source.bitrate_kbps = 5000;
    expect(lowerRung(ascending, 'auto')).toEqual({ label: '720p' });
  });

  it('has no delivered bitrate for a source of 0 without a recipe bitrate', () => {
    const zero = playbackPlan();
    zero.source.bitrate_kbps = 0;
    expect(deliveredKbps(zero)).toBeNull();
  });

  it('rounds the throughput to the nearest kbit/s', () => {
    expect(throughputKbps(1_999_600)).toBe(2000);
    expect(throughputKbps(1_999_400)).toBe(1999);
  });

  it('finds a range that starts 0.1 s after the playhead, and not one 0.2 s after', () => {
    expect(bufferedAheadMs([{ start: 10.1, end: 20 }], 10)).toBe(10_000);
    expect(bufferedAheadMs([{ start: 10.2, end: 20 }], 10)).toBe(0);
    expect(bufferedEndAround([{ start: 10.1, end: 20 }], 10)).toBe(20);
    expect(bufferedEndAround([{ start: 10.2, end: 20 }], 10)).toBeNull();
  });

  it('gives 0 for a range that ends at the playhead, and the end of the range that holds it', () => {
    expect(bufferedAheadMs([{ start: 0, end: 10 }], 10)).toBe(0);
    expect(
      bufferedEndAround(
        [
          { start: 0, end: 5 },
          { start: 10, end: 20 },
        ],
        12,
      ),
    ).toBe(20);
  });
});

describe('edges, round 5', () => {
  it('an interruption after a seek is an interruption: seeked does not end it', () => {
    const detector = settled();
    detector.onSeeking();
    detector.interrupt();
    detector.onSeeked(true);
    detector.onWaiting(0, false);
    advance(7000);
    expect(detector.evaluate()).toBeNull();
  });

  it('a plan that plays on has its grace from its adoption: 30 s later a 2 s wait counts', () => {
    const detector = settled();
    detector.planAdopted(false);
    advance(30_000);
    stall(detector, 2000);
    advance(1000);
    expect(stall(detector, 2000)).toBe('two_stalls');
  });

  it('a range that ends exactly at the playhead gives that end', () => {
    expect(bufferedEndAround([{ start: 0, end: 10 }], 10)).toBe(10);
  });
});

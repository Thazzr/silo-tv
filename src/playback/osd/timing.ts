// The player controls' timings and the pure rules behind them, kept apart from React so each can
// be tested on its own.
import type { Heading } from '../usePlaybackSession';
import type { TimeRange } from '../engine/PlayerEngine';

/** The overlay hides this long after the last key or pointer activity. */
export const OSD_HIDE_MS = 5_000;
/** Rapid skips add up and commit as one seek this long after the last press. */
export const SKIP_COMMIT_MS = 200;
/** A direction key held this long turns into scrubbing. */
export const HOLD_MS = 300;
/** While a direction key stays held in scrub mode, the rate steps up this often. */
export const HOLD_STEP_MS = 1_000;
/** A repeat of a held key arrives sooner than this; a later keydown is a new press (no keyup seen). */
export const HOLD_GAP_MS = 800;
/** How often the scrub target moves. */
export const SCRUB_TICK_MS = 100;
/** The buffering spinner waits this long before it appears, and stays at least this long. */
export const SPINNER_DELAY_MS = 500;
export const SPINNER_MIN_MS = 500;
/** A committed skip still counts as the position for this long (the seek is in flight). */
export const COMMIT_MEMORY_MS = 1_500;

export const SCRUB_RATES = [2, 4, 8, 16] as const;

/**
 * The next signed scrub rate after a press in `direction`. From standstill a press starts at 2×;
 * the same direction goes faster up to 16×; the opposite direction slows down and, below 2×,
 * reverses.
 */
export function stepRate(current: number, direction: 1 | -1): number {
  if (current === 0) return direction * SCRUB_RATES[0];
  const magnitude = Math.abs(current);
  const index = SCRUB_RATES.findIndex((rate) => rate === magnitude);
  if (Math.sign(current) === direction) {
    return direction * SCRUB_RATES[Math.min(SCRUB_RATES.length - 1, index + 1)]!;
  }
  if (index <= 0) return direction * SCRUB_RATES[0];
  return -direction * SCRUB_RATES[index - 1]!;
}

export function clampTime(seconds: number, duration: number): number {
  const upper = duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(upper, seconds));
}

/** Where the data ahead of `position` ends, on the same timeline as `position` (the source's). */
export function bufferedUntil(
  ranges: readonly TimeRange[],
  engineTime: number,
  position: number,
): number {
  const range = ranges.find((r) => engineTime >= r.start - 0.5 && engineTime <= r.end);
  return range ? position + (range.end - engineTime) : position;
}

/** The overlay's two title lines: the series (or nothing) above the title; episodes carry numbers. */
export function headingLines(
  heading: Heading | null,
  fallbackTitle: string,
): { series: string | null; title: string } {
  if (!heading) return { series: null, title: fallbackTitle };
  const numbers: string[] = [];
  if (heading.seasonNumber !== undefined) numbers.push(`S${heading.seasonNumber}`);
  if (heading.episodeNumber !== undefined) numbers.push(`E${heading.episodeNumber}`);
  const title = [...numbers, heading.title].join(' · ');
  return { series: heading.seriesTitle ?? null, title };
}

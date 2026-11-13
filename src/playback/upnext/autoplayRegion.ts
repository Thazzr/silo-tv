// Where the next episode may start by itself, as Silo's web player decides it. Read for behaviour
// only; the code is this project's own.
import type { Segment } from '../skip/segments';

/** A stretch of the playing file, in source seconds. */
export interface TimeRange {
  start: number;
  end: number;
}

/**
 * The stretch from where the credits (or, when the profile allows it, the preview) begin to the
 * end of the title: leaving the episode only once every unmarked scene has played. Markers chain
 * backwards from the end (each must reach the start of the one after it, give or take a second for
 * rounding), so a credits marker with a scene after it is not a region. Null when no marker
 * reaches the end.
 */
export function autoplayRegion(
  segments: readonly Segment[],
  duration: number,
  allowPreview: boolean,
): TimeRange | null {
  if (duration <= 0) return null;
  let start = duration;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    if (segment.kind !== 'credits' && !(allowPreview && segment.kind === 'preview')) continue;
    if (segment.end >= start - 1) start = Math.min(start, segment.start);
  }
  return start < duration ? { start, end: duration } : null;
}

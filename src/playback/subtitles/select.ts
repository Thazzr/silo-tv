import type { Cue } from './webvtt';

/**
 * The cues showing at `time` (seconds on the source's timeline). `offsetMs` shifts the subtitles
 * later (positive) or earlier (negative), as a subtitle delay setting will. A cue is on screen
 * from its start up to, but not including, its end. `cues` must be sorted by start.
 */
export function activeCues(cues: readonly Cue[], time: number, offsetMs = 0): Cue[] {
  const t = time - offsetMs / 1000;
  const active: Cue[] = [];
  for (const cue of cues) {
    if (cue.start > t) break;
    if (cue.end > t) active.push(cue);
  }
  return active;
}

/** True when both lists hold the same cue objects, so a re-render can be skipped. */
export function sameCues(a: readonly Cue[], b: readonly Cue[]): boolean {
  return a.length === b.length && a.every((cue, index) => cue === b[index]);
}

// The one rule for where a title resumes, shared by the detail page, the cards and the player.

/** A saved position counts as a resume point past this many seconds ... */
export const RESUME_MIN_SECONDS = 30;
/** ... and while more than this many seconds of the item are left. */
export const RESUME_END_SECONDS = 5;

interface Progress {
  position_seconds?: number;
  duration_seconds?: number;
}

/**
 * Where "Resume" starts, in whole seconds, or null when the item plays from the start. The saved
 * position must pass 30 s and be more than 5 s from the end, whether or not the server counts the
 * item played (the server keeps the position of a rewatch that stopped partway). `fallbackSeconds`
 * is the runtime to measure the end by when the watch state carries no duration.
 */
export function resumePoint(state: Progress | undefined, fallbackSeconds?: number): number | null {
  const position = state?.position_seconds ?? 0;
  if (position <= RESUME_MIN_SECONDS) return null;
  const total = state?.duration_seconds || fallbackSeconds || 0;
  if (total > 0 && total - position <= RESUME_END_SECONDS) return null;
  return Math.floor(position);
}

/** A resume point moved back by the "Rewind on resume" setting, never before the start. */
export function rewound(point: number, rewindSeconds: number): number {
  return Math.max(0, point - rewindSeconds);
}

/**
 * How a playback starts, decided by whoever opens the player:
 * - `resume`: at the resume point of the fresh watch state, rewound; from 0 without one. No prompt.
 * - `beginning`: from 0, explicitly. No prompt.
 * - `ask` (the default): with a resume point the player asks, else from 0.
 */
export type StartIntent = { kind: 'resume' } | { kind: 'beginning' } | { kind: 'ask' };

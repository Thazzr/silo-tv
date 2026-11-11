// What the action row of a detail page says and does, as pure functions of the item's state.
import type { MessageKey } from '../../i18n';
import type { ItemDetail } from './info';

/** What OK on the primary button does. */
export type PrimaryMode =
  /** Plays from the start (or lets the player decide when the watch state is not known yet). */
  | 'play'
  /** Plays from the resume point without asking. */
  | 'resume'
  /** Opens the "Resume playback?" dialog (a movie with one version and a resume point). */
  | 'ask'
  /** Nothing to play: the button is disabled. */
  | 'none';

export interface PrimaryAction {
  label: MessageKey;
  mode: PrimaryMode;
  /** The share of the title already played (0 to 1), drawn inside the button; null for none. */
  fill: number | null;
  /** "Play from beginning" lives in the More menu: the button resumes without a dialog. */
  startOverInMenu: boolean;
}

/** The share of `totalSeconds` that `seconds` is, within 0 to 1 (0 without a known total). */
export function playedShare(seconds: number, totalSeconds: number): number {
  return totalSeconds > 0 ? Math.min(1, Math.max(0, seconds / totalSeconds)) : 0;
}

/**
 * The primary button, as Silo's web app words it. A movie with a resume point shows "Play" with a
 * progress fill and asks what to do when it has one version; with several versions it says
 * "Resume" and resumes at once (the web puts "Play from beginning" into the More menu then). A
 * series says what its play target is: the episode in progress, the next one, or the first.
 * `resumeSeconds` is the app's own resume point (`resumePoint`), so the button resumes exactly
 * when the player would.
 */
export function primaryAction(input: {
  detail: ItemDetail;
  series: boolean;
  /** Whether something plays: the item itself, or a series' target episode. */
  playable: boolean;
  resumeSeconds: number | null;
  totalSeconds: number;
}): PrimaryAction {
  const { detail, series, playable, resumeSeconds, totalSeconds } = input;
  if (series) {
    const user = detail.user_data;
    let label: MessageKey = 'detail.startFromFirst';
    if (!playable) label = 'detail.browseSeries';
    else if ((user?.in_progress_count ?? 0) > 0) label = 'detail.resume';
    else if ((user?.watched_count ?? 0) > 0 && !user?.played) label = 'detail.playNext';
    return {
      label,
      mode: !playable ? 'none' : resumeSeconds !== null ? 'resume' : 'play',
      fill: null,
      startOverInMenu: false,
    };
  }
  if (resumeSeconds === null) {
    return { label: 'detail.play', mode: 'play', fill: null, startOverInMenu: false };
  }
  const fill = playedShare(resumeSeconds, totalSeconds);
  return detail.versions.length > 1
    ? { label: 'detail.resume', mode: 'resume', fill, startOverInMenu: true }
    : { label: 'detail.play', mode: 'ask', fill, startOverInMenu: false };
}

/**
 * Whether the title counts as watched for the toggle. A movie with a saved position counts as not
 * watched, even when the server also marks it played (a rewatch stopped partway): the toggle then
 * records a play, and "Mark unwatched" in the More menu clears the progress.
 */
export function watchedState(
  detail: ItemDetail,
  series: boolean,
): { played: boolean; hasProgress: boolean; label: MessageKey } {
  const hasProgress = !series && (detail.user_data?.position_seconds ?? 0) > 0;
  const played = !hasProgress && (detail.user_data?.played ?? false);
  let label: MessageKey;
  if (series) label = played ? 'detail.markSeriesUnwatched' : 'detail.markSeriesWatched';
  else label = played ? 'detail.markUnwatched' : 'detail.markWatched';
  return { played, hasProgress, label };
}

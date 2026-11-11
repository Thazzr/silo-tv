import { memo, type ReactNode } from 'react';
import {
  useProfileSetting,
  type SubtitleAppearance,
} from '../../features/settings/profileSettings';
import type { Plan } from '../session/types';
import { subtitleStyles } from './appearance';
import { activeCues, sameCues } from './select';
import { useSubtitleCues } from './useSubtitleCues';
import type { Cue, Run } from './webvtt';

export interface SubtitleOverlayProps {
  cues: readonly Cue[];
  /** The playhead on the source's timeline, in seconds. */
  position: number;
  /** Subtitle delay in ms (positive = later). */
  offsetMs?: number;
  appearance: SubtitleAppearance;
  /** The player controls are open: bottom positions rise above them. */
  lifted: boolean;
}

function RunView({ run }: { run: Run }) {
  // Text nodes only: the cue's words are never parsed as markup.
  let node: ReactNode = run.text;
  if (run.underline) node = <u>{node}</u>;
  if (run.bold) node = <b>{node}</b>;
  if (run.italic) node = <i>{node}</i>;
  return <>{node}</>;
}

interface LinesProps {
  cues: readonly Cue[];
  appearance: SubtitleAppearance;
  lifted: boolean;
}

// The position changes about four times a second, the cue set rarely: the comparator keeps the
// block (and its DOM) untouched until the set, the look or the lift changes.
const Lines = memo(
  function Lines({ cues, appearance, lifted }: LinesProps) {
    const styles = subtitleStyles(appearance, lifted);
    return (
      <div
        className="player-subtitles"
        data-testid="player-subtitles"
        data-lifted={lifted}
        data-position={appearance.position}
        style={styles.block}
      >
        {cues.flatMap((cue, c) =>
          cue.lines.map((line, l) => (
            <p key={`${c}-${l}`} className="player-subtitle-line" style={styles.line}>
              {line.map((run, r) => (
                <RunView key={r} run={run} />
              ))}
            </p>
          )),
        )}
      </div>
    );
  },
  (a, b) => a.lifted === b.lifted && a.appearance === b.appearance && sameCues(a.cues, b.cues),
);

/** Draws the cues showing at the playhead, below the player controls. */
export function SubtitleOverlay({
  cues,
  position,
  offsetMs = 0,
  appearance,
  lifted,
}: SubtitleOverlayProps) {
  const shown = activeCues(cues, position, offsetMs);
  if (shown.length === 0) return null;
  return <Lines cues={shown} appearance={appearance} lifted={lifted} />;
}

/** The player's subtitles: the plan's sidecar, drawn in the profile's appearance. */
export function PlayerSubtitles({
  plan,
  position,
  lifted,
  offsetMs = 0,
}: {
  plan: Plan;
  position: number;
  lifted: boolean;
  /** Subtitle delay in ms (positive = later). */
  offsetMs?: number;
}) {
  const cues = useSubtitleCues(plan);
  const appearance = useProfileSetting('playback.subtitle_appearance').value;
  return (
    <SubtitleOverlay
      cues={cues}
      position={position}
      offsetMs={offsetMs}
      appearance={appearance}
      lifted={lifted}
    />
  );
}

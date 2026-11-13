import { useRef, type MouseEvent } from 'react';
import { formatClock } from '../format';
import { bandOf, type Segment } from '../skip/segments';

export interface ScrubberProps {
  /** Seconds shown by the playhead: the pending target while a skip or scrub is pending. */
  position: number;
  duration: number;
  /** Seconds up to which the data is loaded; 0 when unknown. */
  bufferedEnd: number;
  focused: boolean;
  scrubbing: boolean;
  label: string;
  /** The Magic Remote pointer is over the scrubber. */
  onHover(): void;
  /** The pointer's fraction (0-1) of the track while it is over the scrubber; null when it leaves. */
  onHoverMove(fraction: number | null): void;
  /** Where chapters start, as fractions (0-1) of the track; the first second is not among them. */
  chapterTicks: readonly number[];
  /** Intro, recap, credits and preview: tinted stretches of the track, under the progress. */
  segments: readonly Segment[];
  /** The segment under the preview time, if any: it stands out as a taller pill. */
  activeSegment: Segment | null;
  /** A click: the fraction (0-1) of the track where it landed. */
  onSeek(fraction: number): void;
}

const ratioOf = (seconds: number, duration: number) =>
  duration > 0 ? Math.max(0, Math.min(1, seconds / duration)) : 0;

/** The progress bar with the buffered range; a click on it seeks to that point. */
export function Scrubber({
  position,
  duration,
  bufferedEnd,
  focused,
  scrubbing,
  label,
  onHover,
  onHoverMove,
  chapterTicks,
  segments,
  activeSegment,
  onSeek,
}: ScrubberProps) {
  const track = useRef<HTMLDivElement>(null);
  const ratio = ratioOf(position, duration);
  const pill = activeSegment ? bandOf(activeSegment, duration) : null;

  const fractionAt = (e: MouseEvent): number | null => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return null;
    return Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
  };
  const click = (e: MouseEvent) => {
    const fraction = fractionAt(e);
    if (fraction !== null) onSeek(fraction);
  };
  const move = (e: MouseEvent) => {
    onHover();
    onHoverMove(fractionAt(e));
  };

  return (
    <div
      className="player-scrubber"
      role="slider"
      tabIndex={-1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={formatClock(position)}
      data-focus-key="scrubber"
      data-focused={focused}
      data-scrubbing={scrubbing}
      data-testid="player-scrubber"
      onClick={click}
      onMouseMove={move}
      onMouseLeave={() => onHoverMove(null)}
    >
      <div className="player-scrubber-track" ref={track}>
        <div className="player-scrubber-rail">
          <div
            className="player-scrubber-buffered"
            style={{ transform: `scaleX(${ratioOf(bufferedEnd, duration)})` }}
          />
          {segments.map((segment) => {
            // The highlighted one is drawn as the pill below, not twice.
            const band = segment === activeSegment ? null : bandOf(segment, duration);
            return band ? (
              <div
                key={`${band.kind}-${segment.start}-${segment.end}`}
                className="player-scrubber-band"
                data-testid="player-scrubber-band"
                data-kind={band.kind}
                style={{ left: `${band.start * 100}%`, width: `${(band.end - band.start) * 100}%` }}
              />
            ) : null;
          })}
        </div>
        {pill ? (
          <div
            className="player-scrubber-pill"
            data-testid="player-scrubber-pill"
            data-kind={pill.kind}
            style={{ left: `${pill.start * 100}%`, width: `${(pill.end - pill.start) * 100}%` }}
          />
        ) : null}
        {/* Clips the progress to the rail's rounded ends, above the pill. */}
        <div className="player-scrubber-played">
          <div className="player-scrubber-fill" style={{ transform: `scaleX(${ratio})` }} />
        </div>
      </div>
      {chapterTicks.map((fraction) => (
        <div
          key={fraction}
          className="player-scrubber-tick"
          data-testid="player-chapter-tick"
          style={{ left: `${fraction * 100}%` }}
        />
      ))}
      <div className="player-scrubber-thumb" style={{ left: `${ratio * 100}%` }} />
    </div>
  );
}

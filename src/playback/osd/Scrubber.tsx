import { useRef, type MouseEvent } from 'react';
import { formatClock } from '../format';
import type { Band } from '../skip/segments';

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
  /** Intro, recap and credits: ranges (fractions 0-1) drawn on the track under the progress. */
  bands: readonly Band[];
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
  bands,
  onSeek,
}: ScrubberProps) {
  const track = useRef<HTMLDivElement>(null);
  const ratio = ratioOf(position, duration);

  const fractionAt = (e: MouseEvent): number | null => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return null;
    return Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
  };
  const click = (e: MouseEvent) => {
    const fraction = fractionAt(e);
    if (fraction !== null) onSeek(fraction);
  };
  const move = (e: MouseEvent) => onHoverMove(fractionAt(e));

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
      onMouseEnter={onHover}
      onClick={click}
      onMouseMove={move}
      onMouseLeave={() => onHoverMove(null)}
    >
      <div className="player-scrubber-track" ref={track}>
        <div
          className="player-scrubber-buffered"
          style={{ transform: `scaleX(${ratioOf(bufferedEnd, duration)})` }}
        />
        {bands.map((band) => (
          <div
            key={`${band.kind}-${band.start}-${band.end}`}
            className="player-scrubber-band"
            data-testid="player-scrubber-band"
            data-kind={band.kind}
            style={{ left: `${band.start * 100}%`, width: `${(band.end - band.start) * 100}%` }}
          />
        ))}
        <div className="player-scrubber-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      {/* Outside the track (which clips) so the ticks can stand a little taller than it. */}
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

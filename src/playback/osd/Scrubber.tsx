import { useRef, type MouseEvent } from 'react';
import { formatClock } from '../format';

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
  onSeek,
}: ScrubberProps) {
  const track = useRef<HTMLDivElement>(null);
  const ratio = ratioOf(position, duration);

  const click = (e: MouseEvent) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    onSeek(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)));
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
      onMouseEnter={onHover}
      onClick={click}
    >
      <div className="player-scrubber-track" ref={track}>
        <div
          className="player-scrubber-buffered"
          style={{ transform: `scaleX(${ratioOf(bufferedEnd, duration)})` }}
        />
        <div className="player-scrubber-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <div className="player-scrubber-thumb" style={{ left: `${ratio * 100}%` }} />
    </div>
  );
}

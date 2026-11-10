import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import { CloseIcon, OptionsIcon, PauseIcon, PlayIcon, SkipIcon } from './icons';
import { PreviewCard } from './PreviewCard';
import { chapterTickFractions, type Chapter } from './previewMath';
import type { Band } from '../skip/segments';
import { Scrubber } from './Scrubber';
import type { TrickplayImages } from './useTrickplay';

export type OsdFocus =
  'video' | 'scrubber' | 'skipBack' | 'playPause' | 'skipForward' | 'options' | 'close' | 'pill';
/** The round buttons, left to right as the 5-way keys walk them. */
export const OSD_BUTTONS = ['skipBack', 'playPause', 'skipForward', 'options', 'close'] as const;
export type OsdButton = (typeof OSD_BUTTONS)[number];

export interface PlayerOsdProps {
  visible: boolean;
  series: string | null;
  title: string;
  /** The playhead as shown: the pending skip or scrub target while there is one. */
  position: number;
  duration: number;
  bufferedEnd: number;
  focus: OsdFocus;
  paused: boolean;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  scrub: { rate: number; target: number } | null;
  /** A skip is pending: `position` is its target, not where the video is. */
  skipPending: boolean;
  /** The playing file's chapters (ticks on the track, a title on the preview card). */
  chapters: readonly Chapter[];
  /** Intro, recap and credits as bands on the track (fractions 0-1). */
  bands?: readonly Band[];
  /** The scrub previews, when the file has them and they have loaded. */
  previews: TrickplayImages | undefined;
  onFocus(focus: OsdFocus): void;
  onSeekFraction(fraction: number): void;
  onAction(button: OsdButton): void;
}

const NO_BANDS: readonly Band[] = [];

/** The on-screen controls: titles, scrubber, time row and the round buttons. */
export function PlayerOsd(props: PlayerOsdProps) {
  const t = useT();
  const { visible, focus, paused, position, duration, scrub } = props;
  const buttons = useRef<Partial<Record<OsdButton, HTMLButtonElement | null>>>({});
  const root = useRef<HTMLDivElement>(null);

  // DOM focus follows the overlay's own focus, without scrolling anything.
  useEffect(() => {
    // The skip pill is outside the overlay and focuses itself.
    if (focus === 'pill') return;
    if (!visible || focus === 'video') {
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.current?.contains(active)) active.blur();
      return;
    }
    const element =
      focus === 'scrubber'
        ? root.current?.querySelector<HTMLElement>('[data-focus-key="scrubber"]')
        : buttons.current[focus];
    element?.focus({ preventScroll: true });
  }, [visible, focus]);

  const remaining = Math.max(0, duration - position);
  const ticks = useMemo(
    () => chapterTickFractions(props.chapters, duration),
    [props.chapters, duration],
  );

  // The pointer's position on the scrubber. A hidden overlay forgets it: the pointer may still
  // rest there when the overlay comes back, and a card at a stale spot would be wrong.
  const [hover, setHover] = useState<number | null>(null);
  if (!visible && hover !== null) setHover(null);
  const hoverTime = hover !== null ? hover * duration : null;
  const cardTime = hoverTime ?? (scrub ? scrub.target : props.skipPending ? position : null);
  const wrap = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const cardShown = cardTime !== null && duration > 0;
  useLayoutEffect(() => {
    if (cardShown && wrap.current) setTrackWidth(wrap.current.offsetWidth);
  }, [cardShown]);

  const button = (name: OsdButton, label: string, icon: ReactNode) => (
    <button
      key={name}
      ref={(el) => {
        buttons.current[name] = el;
      }}
      type="button"
      className="player-btn"
      tabIndex={-1}
      aria-label={label}
      data-focus-key={name}
      data-focused={focus === name}
      data-testid={`player-btn-${name}`}
      onMouseEnter={() => props.onFocus(name)}
      onClick={() => props.onAction(name)}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="player-osd"
      ref={root}
      data-visible={visible}
      aria-hidden={visible ? undefined : true}
      data-testid="player-osd"
    >
      <div className="player-osd-body">
        {/* The card stands where the heading is: the heading gives way while it shows. */}
        {props.series ? (
          <p className="player-osd-series" data-covered={cardShown}>
            {props.series}
          </p>
        ) : null}
        <h1 className="player-osd-title" data-covered={cardShown}>
          {props.title}
        </h1>
        <div className="player-osd-scrubwrap" ref={wrap}>
          {cardShown ? (
            <PreviewCard
              time={cardTime}
              centerX={(Math.max(0, Math.min(duration, cardTime)) / duration) * trackWidth}
              trackWidth={trackWidth}
              images={props.previews}
              chapters={props.chapters}
              scrub={scrub}
            />
          ) : null}
          <Scrubber
            position={position}
            duration={duration}
            bufferedEnd={props.bufferedEnd}
            focused={focus === 'scrubber'}
            scrubbing={scrub !== null}
            label={t('player.osd.position')}
            chapterTicks={ticks}
            bands={props.bands ?? NO_BANDS}
            onHover={() => props.onFocus('scrubber')}
            onHoverMove={setHover}
            onSeek={props.onSeekFraction}
          />
        </div>
        <div className="player-osd-times">
          <span data-testid="player-time">{formatClock(position)}</span>
          <span data-testid="player-remaining">−{formatClock(remaining)}</span>
        </div>
        <div className="player-osd-buttons">
          <div className="player-osd-group">
            {button(
              'skipBack',
              t('player.osd.skipBack', { seconds: props.skipBackSeconds }),
              <SkipIcon seconds={props.skipBackSeconds} forward={false} />,
            )}
            {button(
              'playPause',
              paused ? t('player.osd.play') : t('player.osd.pause'),
              paused ? <PlayIcon /> : <PauseIcon />,
            )}
            {button(
              'skipForward',
              t('player.osd.skipForward', { seconds: props.skipForwardSeconds }),
              <SkipIcon seconds={props.skipForwardSeconds} forward />,
            )}
          </div>
          {/* Up Next joins left of Options in a later package. */}
          <div className="player-osd-group">
            {button('options', t('player.osd.options'), <OptionsIcon />)}
            {button('close', t('player.osd.close'), <CloseIcon />)}
          </div>
        </div>
      </div>
    </div>
  );
}

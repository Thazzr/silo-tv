import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import { CloseIcon, PauseIcon, PlayIcon, ScrubIcon, SkipIcon } from './icons';
import { Scrubber } from './Scrubber';

export type OsdFocus = 'video' | 'scrubber' | 'skipBack' | 'playPause' | 'skipForward' | 'close';
/** The round buttons, left to right as the 5-way keys walk them. */
export const OSD_BUTTONS = ['skipBack', 'playPause', 'skipForward', 'close'] as const;
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
  onFocus(focus: OsdFocus): void;
  onSeekFraction(fraction: number): void;
  onAction(button: OsdButton): void;
}

/** The on-screen controls: titles, scrubber, time row and the round buttons. */
export function PlayerOsd(props: PlayerOsdProps) {
  const t = useT();
  const { visible, focus, paused, position, duration, scrub } = props;
  const buttons = useRef<Partial<Record<OsdButton, HTMLButtonElement | null>>>({});
  const root = useRef<HTMLDivElement>(null);

  // DOM focus follows the overlay's own focus, without scrolling anything.
  useEffect(() => {
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
  const rateLabel = scrub ? `${Math.abs(scrub.rate)}×` : '';

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
        {props.series ? <p className="player-osd-series">{props.series}</p> : null}
        <h1 className="player-osd-title">{props.title}</h1>
        <div className="player-osd-scrub-row">
          {scrub ? (
            <p
              className="player-osd-scrub"
              data-testid="player-scrub"
              data-rate={scrub.rate}
              aria-label={t('player.osd.scrubbing', { rate: rateLabel })}
            >
              <ScrubIcon forward={scrub.rate > 0} />
              <span>{rateLabel}</span>
              <span className="player-osd-scrub-time">{formatClock(scrub.target)}</span>
            </p>
          ) : null}
        </div>
        <Scrubber
          position={position}
          duration={duration}
          bufferedEnd={props.bufferedEnd}
          focused={focus === 'scrubber'}
          scrubbing={scrub !== null}
          label={t('player.osd.position')}
          onHover={() => props.onFocus('scrubber')}
          onSeek={props.onSeekFraction}
        />
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
          {/* Options and Up Next join here in later packages. */}
          <div className="player-osd-group">
            {button('close', t('player.osd.close'), <CloseIcon />)}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLanguage, useT, type MessageKey } from '../../i18n';
import { timeParts, type TimeFormat, type TimeMode } from '../timeDisplay';
import { isPopover, type OsdMenu } from '../menus/usePanelState';
import {
  AudioIcon,
  ChaptersIcon,
  CloseIcon,
  GearIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  SkipIcon,
  SubtitlesIcon,
} from './icons';
import { PreviewCard } from './PreviewCard';
import { chapterTickFractions, type Chapter } from './previewMath';
import type { Band } from '../skip/segments';
import { Scrubber } from './Scrubber';
import type { TrickplayImages } from './useTrickplay';

/** The round transport buttons in the middle of the row. */
export const TRANSPORT_BUTTONS = ['skipBack', 'playPause', 'skipForward'] as const;
export type OsdButton = (typeof TRANSPORT_BUTTONS)[number];
/** Everything a press can act on: a transport button, Exit or a menu button. */
export type OsdAction = OsdButton | 'close' | OsdMenu;
export type OsdFocus = 'video' | 'scrubber' | 'pill' | OsdAction;

/**
 * The button row as the 5-way keys walk it: the transport buttons, then the menu buttons that are
 * present (a menu the playing file has nothing for is not in `menus`).
 */
export const buttonRow = (menus: readonly OsdMenu[]): OsdAction[] => [
  ...TRANSPORT_BUTTONS,
  ...menus,
];

/** What the menu buttons look like. */
const MENU_BUTTON: Partial<Record<OsdMenu, { label: MessageKey; icon: ReactNode }>> = {
  audio: { label: 'player.menu.audio', icon: <AudioIcon /> },
  subtitles: { label: 'player.menu.subtitles', icon: <SubtitlesIcon /> },
  chapters: { label: 'player.menu.chapters', icon: <ChaptersIcon /> },
  settings: { label: 'player.menu.settings', icon: <GearIcon /> },
  info: { label: 'player.menu.info', icon: <InfoIcon /> },
};

export interface PlayerOsdProps {
  visible: boolean;
  /** The first line: the series for an episode, else the title. */
  title: string;
  /** Leads the second line (episode numbers and title, or the year); the times follow it. */
  detail: string;
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
  /** The playing file's chapters (the ticks on the track). */
  chapters: readonly Chapter[];
  /** Intro, recap and credits as bands on the track (fractions 0-1). */
  bands?: readonly Band[];
  /** The scrub previews, when the file has them and they have loaded. */
  previews: TrickplayImages | undefined;
  /** The menu buttons to show, in order. */
  menus: readonly OsdMenu[];
  /** The open menu, if any. */
  openMenu: OsdMenu | null;
  /** The settings button's second line: the quality in use. */
  qualityText: string | null;
  /** What the clock above the scrubber says, and how it writes the end time. */
  timeMode: TimeMode;
  timeFormat: TimeFormat;
  /** The open popover (rendered above its button); null for Info and when none is open. */
  popover: ReactNode;
  /**
   * The Info panel while it is open. It renders inside the overlay, so it stands above the
   * overlay's gradient and below the preview card, and fades with the overlay.
   */
  info?: ReactNode;
  onFocus(focus: OsdFocus): void;
  onSeekFraction(fraction: number): void;
  onAction(action: OsdAction): void;
}

const NO_BANDS: readonly Band[] = [];

/** The wall clock, read where the clock line is drawn: the end time moves with the position. */
const wallClock = () => Date.now();

/**
 * The on-screen controls: Exit at the top left, and at the bottom the scrubber and one row with
 * the title block on the left, the transport buttons in the middle and the menu buttons on the
 * right.
 */
export function PlayerOsd(props: PlayerOsdProps) {
  const t = useT();
  const lang = useLanguage();
  const { visible, focus, paused, position, duration, scrub, openMenu } = props;
  const buttons = useRef<Partial<Record<OsdAction, HTMLButtonElement | null>>>({});
  const root = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const popoverOpen = isPopover(openMenu);

  // A hidden overlay is aria-hidden, and Chromium refuses that while a descendant has the focus
  // (and warns). So the focus leaves first, then the attribute goes on, both before paint. The
  // attribute is set here and not in the markup, because React would apply it before this runs.
  useLayoutEffect(() => {
    for (const el of [root.current, top.current]) {
      if (!el) continue;
      if (visible) {
        el.removeAttribute('aria-hidden');
        continue;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && el.contains(active)) active.blur();
      el.setAttribute('aria-hidden', 'true');
    }
  }, [visible]);

  // DOM focus follows the overlay's own focus, without scrolling anything.
  useEffect(() => {
    // The skip pill is outside the overlay and focuses itself.
    if (focus === 'pill') return;
    if (!visible || focus === 'video') {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('.player-osd, .player-osd-top')) {
        active.blur();
      }
      return;
    }
    // An open popover's row holds the DOM focus; the button gets it back when the popover closes.
    if (popoverOpen) return;
    const element =
      focus === 'scrubber'
        ? root.current?.querySelector<HTMLElement>('[data-focus-key="scrubber"]')
        : buttons.current[focus];
    element?.focus({ preventScroll: true });
  }, [visible, focus, popoverOpen]);

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

  const button = (
    name: OsdAction,
    label: string,
    content: ReactNode,
    options: {
      className?: string;
      testId?: string;
      /** A menu button: whether its menu is open, and whether it opens a popover. */
      menu?: { open: boolean; popover: boolean };
    } = {},
  ) => {
    const { className, testId, menu } = options;
    return (
      <button
        key={name}
        ref={(el) => {
          buttons.current[name] = el;
        }}
        type="button"
        className={className ?? 'player-btn'}
        tabIndex={-1}
        aria-label={label}
        data-focus-key={name}
        data-focused={focus === name && !(menu?.popover && menu.open)}
        data-open={menu?.open ? true : undefined}
        data-testid={testId ?? `player-btn-${name}`}
        onMouseEnter={() => props.onFocus(name)}
        onClick={() => props.onAction(name)}
        aria-haspopup={menu?.popover ? 'menu' : undefined}
        aria-expanded={menu?.popover ? menu.open : undefined}
        aria-pressed={menu && !menu.popover ? menu.open : undefined}
      >
        {content}
      </button>
    );
  };

  const menuButton = (menu: OsdMenu) => {
    const look = MENU_BUTTON[menu];
    if (!look) return null;
    const label = t(look.label);
    const popover = isPopover(menu);
    const open = openMenu === menu;
    return (
      <div key={menu} className="player-menu-anchor">
        {open && props.popover ? <div className="player-popover">{props.popover}</div> : null}
        {button(
          menu,
          label,
          menu === 'settings' && props.qualityText ? (
            <>
              {look.icon}
              <span className="player-btn-label" data-testid="player-quality-label">
                {props.qualityText}
              </span>
            </>
          ) : (
            look.icon
          ),
          {
            className:
              menu === 'settings' && props.qualityText
                ? 'player-btn player-btn-wide'
                : 'player-btn',
            menu: { open, popover },
          },
        )}
      </div>
    );
  };

  const meta = (
    <p className="player-osd-meta" data-testid="player-meta">
      {props.detail ? (
        <span className="player-osd-detail" data-testid="player-detail">
          {props.detail}
        </span>
      ) : null}
    </p>
  );

  // Right-aligned directly above the scrubber (the preview card stands above it); never shrinks.
  const parts = timeParts(props.timeMode, position, duration, wallClock(), props.timeFormat, lang);
  const ends = parts.endsAt !== null ? t('player.osd.endsAt', { time: parts.endsAt }) : null;
  const clock = (
    <p className="player-osd-clock" data-testid="player-clock" data-mode={props.timeMode}>
      {parts.position !== null ? (
        <>
          <span data-testid="player-time">{parts.position}</span>
          {' / '}
          <span data-testid="player-total">{parts.total}</span>
        </>
      ) : null}
      {parts.remaining !== null ? (
        <span data-testid="player-remaining">{parts.remaining}</span>
      ) : null}
      {ends !== null ? (
        <>
          {parts.position !== null ? ' · ' : null}
          <span data-testid="player-ends">{ends}</span>
        </>
      ) : null}
    </p>
  );

  return (
    <>
      <div className="player-osd-top" ref={top} data-visible={visible} data-testid="player-osd-top">
        {button(
          'close',
          t('player.osd.exit'),
          <>
            <CloseIcon />
            <span>{t('player.osd.exit')}</span>
          </>,
          { className: 'player-exit', testId: 'player-btn-close' },
        )}
      </div>
      <div className="player-osd" ref={root} data-visible={visible} data-testid="player-osd">
        {props.info}
        <div className="player-osd-body">
          <div className="player-osd-scrubwrap" ref={wrap}>
            {cardShown ? (
              <PreviewCard
                time={cardTime}
                centerX={(Math.max(0, Math.min(duration, cardTime)) / duration) * trackWidth}
                trackWidth={trackWidth}
                images={props.previews}
                scrub={scrub}
              />
            ) : null}
            {clock}
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
          <div className="player-osd-row">
            <div className="player-osd-titles">
              <h1 className="player-osd-title">{props.title}</h1>
              {meta}
            </div>
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
              {/* The next-episode button joins here in a later package. */}
            </div>
            <div className="player-osd-group player-osd-menus">{props.menus.map(menuButton)}</div>
          </div>
        </div>
      </div>
    </>
  );
}

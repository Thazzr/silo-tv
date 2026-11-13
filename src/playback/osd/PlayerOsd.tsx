import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLanguage, useT, type MessageKey } from '../../i18n';
import { timeParts, type TimeFormat, type TimeMode } from '../timeDisplay';
import { isPopover, type OsdMenu } from '../menus/usePanelState';
import {
  AudioLines,
  Captions,
  CaptionsOff,
  Info,
  ListVideo,
  Pause,
  Play,
  Settings,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { PreviewCard } from './PreviewCard';
import { chapterTickFractions, chapterTitleAt, type Chapter } from './previewMath';
import { segmentUnder, type Segment } from '../skip/segments';
import { Scrubber } from './Scrubber';
import { SkipGlyph } from './SkipGlyph';
import type { TrickplayImages } from './useTrickplay';

/** The transport buttons that are always there: back, play or pause, forward. */
export type OsdButton = 'skipBack' | 'playPause' | 'skipForward';
/** Everything a press can act on: a transport button, Exit or a menu button. */
export type OsdAction = OsdButton | 'prevEpisode' | 'nextEpisode' | 'close' | OsdMenu;
export type OsdFocus = 'video' | 'scrubber' | 'pill' | OsdAction;

/**
 * Which episode buttons an episode has: the slot of a missing neighbour is an empty spacer, so
 * the row keeps its shape. A movie has no slots at all (`null`).
 */
export interface EpisodeSlots {
  previous: boolean;
  next: boolean;
}

/**
 * The button row as the 5-way keys walk it: previous episode, back, play, forward, next episode
 * (a spacer is not in it), then the menu buttons that are present (a menu the playing file has
 * nothing for is not in `menus`).
 */
export const buttonRow = (
  menus: readonly OsdMenu[],
  episodes: EpisodeSlots | null,
): OsdAction[] => [
  ...(episodes?.previous ? (['prevEpisode'] as const) : []),
  'skipBack',
  'playPause',
  'skipForward',
  ...(episodes?.next ? (['nextEpisode'] as const) : []),
  ...menus,
];

/** The glyph of the menu buttons, at the size they draw. */
const GLYPH = 32;

/** What a menu button looks like; the Subtitles glyph is crossed out while no subtitle plays. */
function menuLook(menu: OsdMenu, subtitlesOn: boolean): { label: MessageKey; icon: ReactNode } {
  switch (menu) {
    case 'audio':
      return { label: 'player.menu.audio', icon: <AudioLines size={GLYPH} /> };
    case 'subtitles':
      return {
        label: 'player.menu.subtitles',
        icon: subtitlesOn ? <Captions size={GLYPH} /> : <CaptionsOff size={GLYPH} />,
      };
    case 'chapters':
      return { label: 'player.menu.chapters', icon: <ListVideo size={GLYPH} /> };
    case 'settings':
      return { label: 'player.menu.settings', icon: <Settings size={GLYPH} /> };
    case 'info':
      return { label: 'player.menu.info', icon: <Info size={GLYPH} /> };
  }
}

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
  /** The playing file's chapters (the ticks on the track, the name on the card). */
  chapters: readonly Chapter[];
  /** Intro, recap, credits and preview of the playing file (the tints on the track). */
  segments: readonly Segment[];
  /** The scrub previews, when the file has them and they have loaded. */
  previews: TrickplayImages | undefined;
  /** The menu buttons to show, in order. */
  menus: readonly OsdMenu[];
  /** The episode buttons' slots; null for a movie. */
  episodes: EpisodeSlots | null;
  /** A subtitle track plays: the Subtitles button wears its dot. */
  subtitlesOn: boolean;
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
  const { segments } = props;
  const segmentAtCard = cardShown ? segmentUnder(segments, cardTime) : null;
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
        onMouseMove={() => props.onFocus(name)}
        onClick={() => props.onAction(name)}
        aria-haspopup={menu?.popover ? 'menu' : undefined}
        aria-expanded={menu?.popover ? menu.open : undefined}
        aria-pressed={menu && !menu.popover ? menu.open : undefined}
      >
        {content}
      </button>
    );
  };

  /** The slot of an episode button that has no target: the same footprint, nothing to see or focus. */
  const spacer = (name: 'prevEpisode' | 'nextEpisode') => (
    <span
      key={name}
      className="player-btn-spacer"
      aria-hidden="true"
      data-testid={`player-spacer-${name}`}
    />
  );

  const menuButton = (menu: OsdMenu) => {
    const look = menuLook(menu, props.subtitlesOn);
    const label = t(look.label);
    const popover = isPopover(menu);
    const open = openMenu === menu;
    const pill = menu === 'settings' && props.qualityText;
    return (
      <div key={menu} className="player-menu-anchor">
        {open && props.popover ? <div className="player-popover">{props.popover}</div> : null}
        {button(
          menu,
          label,
          <>
            {look.icon}
            {pill ? (
              <span className="player-btn-label" data-testid="player-quality-label">
                {props.qualityText}
              </span>
            ) : null}
            {menu === 'subtitles' && props.subtitlesOn ? (
              <span className="player-btn-dot" data-testid="player-subtitles-dot" />
            ) : null}
          </>,
          {
            className: pill
              ? 'player-btn player-btn-tool player-btn-wide'
              : 'player-btn player-btn-tool',
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
    <p
      className="player-osd-clock"
      data-testid="player-clock"
      data-mode={props.timeMode}
      data-hidden={popoverOpen}
    >
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
            <X size={32} />
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
                chapterTitle={chapterTitleAt(props.chapters, cardTime)}
                segment={segmentAtCard}
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
              segments={segments}
              activeSegment={segmentAtCard}
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
            <div className="player-osd-group player-osd-transport">
              {props.episodes
                ? props.episodes.previous
                  ? button(
                      'prevEpisode',
                      t('player.osd.prevEpisode'),
                      <SkipBack size={30} fill="currentColor" />,
                      { className: 'player-btn player-btn-small' },
                    )
                  : spacer('prevEpisode')
                : null}
              {button(
                'skipBack',
                t('player.osd.skipBack', { seconds: props.skipBackSeconds }),
                <SkipGlyph seconds={props.skipBackSeconds} forward={false} />,
                { className: 'player-btn player-btn-small' },
              )}
              {button(
                'playPause',
                paused ? t('player.osd.play') : t('player.osd.pause'),
                paused ? (
                  <Play size={40} fill="currentColor" strokeWidth={0} />
                ) : (
                  <Pause size={40} fill="currentColor" strokeWidth={0} />
                ),
                { className: 'player-btn player-btn-play' },
              )}
              {button(
                'skipForward',
                t('player.osd.skipForward', { seconds: props.skipForwardSeconds }),
                <SkipGlyph seconds={props.skipForwardSeconds} forward />,
                { className: 'player-btn player-btn-small' },
              )}
              {props.episodes
                ? props.episodes.next
                  ? button(
                      'nextEpisode',
                      t('player.osd.nextEpisode'),
                      <SkipForward size={30} fill="currentColor" />,
                      { className: 'player-btn player-btn-small' },
                    )
                  : spacer('nextEpisode')
                : null}
            </div>
            <div className="player-osd-group player-osd-menus">{props.menus.map(menuButton)}</div>
          </div>
        </div>
      </div>
    </>
  );
}

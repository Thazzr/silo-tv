import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlatform } from '../../platform';
import type { PlayerEngine } from '../engine/PlayerEngine';
import { isPopover, type OsdMenu } from '../menus/usePanelState';
import { buttonRow, type EpisodeSlots, type OsdAction, type OsdFocus } from './PlayerOsd';
import { clampTime, HOLD_GAP_MS, HOLD_MS, HOLD_STEP_MS } from './timing';
import { useOsdVisibility } from './useOsdVisibility';
import { useScrub, type ScrubState } from './useScrub';
import { useSkipAccumulator } from './useSkipAccumulator';

interface Args {
  engine: PlayerEngine | null;
  /** The first frame has played; before that only Back works. */
  started: boolean;
  paused: boolean;
  /** A stall: waiting for data while not paused. */
  buffering: boolean;
  /** The reported position (source timeline) from the last time update. */
  position: number;
  duration: number;
  /** The live position on the source's timeline. */
  read(): number | null;
  seekTo(sourceSeconds: number): void;
  leave(): void;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  /** The menu buttons that are present, in the order of the row. */
  menus: readonly OsdMenu[];
  /** Which episode buttons the row has (a spacer is not one); null for a movie. */
  episodes: EpisodeSlots | null;
  /** A press on an episode button: the screen stops this session and opens that episode. */
  onEpisode(which: 'previous' | 'next'): void;
  /**
   * The open menu, which lives above the player so it survives a reload of the stream. While a
   * popover is open the keys are the menu's: only the media keys still act here.
   */
  panel: {
    open: OsdMenu | null;
    show(menu: OsdMenu): void;
    hide(): void;
    /** The button a menu that just closed after a pick leaves this view to land on. */
    arrival(): OsdMenu | null;
  };
  /**
   * The corner pill (the skip pill, or the buffering prompt or undo pill that waits for its slot):
   * whether it shows and holds the focus, and its actions.
   */
  pill: {
    shown: boolean;
    holdsFocus: boolean;
    activate(): void;
    /** Hides it (for its segment, or answers "Keep quality"); false when none was showing. */
    dismiss(): boolean;
    /** Left or Right between the pill's own buttons; false when it has none to move to. */
    move?(direction: 'left' | 'right'): boolean;
  };
}

export interface PlayerControls {
  visible: boolean;
  focus: OsdFocus;
  /** The playhead as the overlay shows it. */
  shownPosition: number;
  scrub: ScrubState | null;
  /** A skip is waiting for its commit: `shownPosition` is its target. */
  skipPending: boolean;
  setFocus(focus: OsdFocus): void;
  action(action: OsdAction): void;
  seekToFraction(fraction: number): void;
  /**
   * Back: close the open menu or Info, else cancel scrubbing, else dismiss the skip pill, else
   * hide the overlay, else leave.
   */
  back(): void;
  /** Closes the open menu; the focus lands on its button and the overlay stays. */
  closeMenu(): void;
  /**
   * Left or Right in an open popover: it closes and the focus moves to the neighbouring button,
   * without opening that button's menu.
   */
  menuSide(direction: 'left' | 'right'): void;
  /** Pointer movement over the player. */
  pointerMoved(): void;
  /** A click on the video itself: it closes an open menu, else toggles play. */
  videoClicked(): void;
}

/** A direction key that is still down: its repeats are a hold, not new presses. */
interface Held {
  key: string;
  since: number;
  seen: number;
  stepped: number;
}

/** Everything the player's controls do: overlay visibility and focus, skips, scrubbing, keys. */
export function usePlayerControls(args: Args): PlayerControls {
  const { engine, started, paused, buffering, position, duration } = args;
  // A player that reloads its stream under an open menu starts with the overlay up on its button.
  // So does one that loads for a pick that just closed its menu: the focus returns to the button.
  const [landed] = useState(() => args.panel.arrival());
  const [overlayFocus, setFocusState] = useState<OsdFocus>(args.panel.open ?? landed ?? 'video');

  const skip = useSkipAccumulator({
    read: args.read,
    duration,
    commit: args.seekTo,
  });
  const scrub = useScrub(duration);
  const menuOpen = args.panel.open !== null;
  const osd = useOsdVisibility(
    paused || buffering || scrub.state !== null || skip.pending !== null || menuOpen,
    menuOpen || landed !== null,
  );
  // A hidden overlay (also one that hid by itself when idle) leaves the focus on the video, except
  // for a new skip pill, which holds it for its first seconds. A pill that is gone leaves the
  // overlay's focus on the scrubber.
  const focus: OsdFocus = osd.visible
    ? overlayFocus === 'pill' && !args.pill.shown
      ? 'scrubber'
      : overlayFocus
    : args.pill.holdsFocus
      ? 'pill'
      : 'video';

  const latest = useRef({ args, skip, scrub, osd, focus });
  useEffect(() => {
    latest.current = { args, skip, scrub, osd, focus };
  });
  const held = useRef<Held | null>(null);
  // Tap or hold on the scrubber. Once any keyup has been seen since the player opened, the remote
  // delivers keyups and a direction key is decided by them (KEYUP RULE): a keyup within HOLD_MS
  // is a tap, no keyup by then (or a repeated keydown) is a hold. Until one has been seen we
  // cannot know that, so the fallback for a TV without keyups applies (REPEAT RULE): a press is a
  // tap at once and repeated keydowns turn into a hold. TV check item: does webOS send keyup?
  const keyupSeen = useRef(false);
  const holdTimer = useRef<{
    key: string;
    direction: 1 | -1;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const clearHoldTimer = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current.timer);
    holdTimer.current = null;
  }, []);
  useEffect(() => clearHoldTimer, [clearHoldTimer]);
  const visibleRef = useRef(menuOpen || landed !== null);
  useEffect(() => {
    visibleRef.current = osd.visible;
  }, [osd.visible]);

  const openOsd = useCallback(() => {
    setFocusState('scrubber');
    latest.current.osd.show();
  }, []);

  const hideOsd = useCallback(() => {
    latest.current.osd.hide();
    setFocusState('video');
  }, []);

  /** Opens a menu (or Info) from its button; the one that is already open closes instead. */
  const toggleMenu = useCallback(
    (menu: OsdMenu) => {
      const { args: a, osd: o } = latest.current;
      clearHoldTimer();
      if (a.panel.open === menu) a.panel.hide();
      else a.panel.show(menu);
      setFocusState(menu);
      o.poke();
    },
    [clearHoldTimer],
  );

  /** The blue key: Info opens with the overlay up and the focus on its button, or closes again. */
  const toggleInfo = useCallback(() => {
    const { args: a, osd: o } = latest.current;
    clearHoldTimer();
    const closing = a.panel.open === 'info';
    if (closing) a.panel.hide();
    else a.panel.show('info');
    setFocusState('info');
    if (closing) o.poke();
    else o.show();
  }, [clearHoldTimer]);

  const closeMenu = useCallback(() => {
    const { args: a, osd: o } = latest.current;
    const open = a.panel.open;
    a.panel.hide();
    if (open) setFocusState(open);
    o.show();
  }, []);

  /** Closes the open menu and moves the focus to its neighbour in the row (or to the pill). */
  const menuSide = useCallback((direction: 'left' | 'right') => {
    const { args: a, osd: o } = latest.current;
    const open = a.panel.open;
    if (!open) return;
    const row = buttonRow(a.menus, a.episodes);
    // A popover always has both neighbours: the transport buttons on its left and Info, which is
    // always present and always last, on its right.
    const neighbour = row[row.indexOf(open) + (direction === 'right' ? 1 : -1)]!;
    a.panel.hide();
    setFocusState(neighbour);
    o.poke();
  }, []);

  // A pause shows the overlay, so the state is visible at once (not behind a menu).
  useEffect(() => {
    if (started && paused && !visibleRef.current && !latest.current.args.panel.open) openOsd();
  }, [started, paused, openOsd]);

  const togglePlay = useCallback(() => {
    if (!engine) return;
    if (engine.paused) void engine.play();
    else engine.pause();
  }, [engine]);

  /** Enters scrub mode (from the pending target, else the live position) or steps its rate. */
  const startScrub = useCallback((direction: 1 | -1) => {
    const { args: a, skip: s, scrub: sc } = latest.current;
    const from = sc.state?.target ?? s.peek() ?? a.read() ?? 0;
    s.cancel();
    sc.press(direction, from);
  }, []);

  const commitScrub = useCallback(() => {
    const { scrub: sc, skip: s } = latest.current;
    const target = sc.commit();
    if (target !== null) s.commitNow(target);
  }, []);

  const action = useCallback(
    (button: OsdAction) => {
      const { args: a, skip: s } = latest.current;
      switch (button) {
        case 'skipBack':
          s.add(-a.skipBackSeconds);
          break;
        case 'skipForward':
          s.add(a.skipForwardSeconds);
          break;
        case 'playPause':
          togglePlay();
          break;
        case 'prevEpisode':
          a.onEpisode('previous');
          break;
        case 'nextEpisode':
          a.onEpisode('next');
          break;
        case 'close':
          a.leave();
          break;
        default:
          // The rest are the menu buttons.
          toggleMenu(button);
          break;
      }
    },
    [togglePlay, toggleMenu],
  );

  const seekToFraction = useCallback((fraction: number) => {
    const { args: a, skip: s, scrub: sc } = latest.current;
    sc.cancel();
    s.commitNow(clampTime(fraction * a.duration, a.duration));
  }, []);

  const back = useCallback(() => {
    const { scrub: sc, osd: o, args: a } = latest.current;
    if (a.panel.open) closeMenu();
    else if (sc.active()) sc.cancel();
    else if (a.pill.dismiss()) return;
    else if (o.visible) hideOsd();
    else a.leave();
  }, [hideOsd, closeMenu]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = getPlatform().mapKey(e);
      if (!key || key === 'back') return;
      const { args: a, skip: s, scrub: sc, osd: o, focus: current } = latest.current;
      if (isPopover(a.panel.open)) {
        // The menu's own keys (arrows, OK) are left alone; the media keys act as ever, without
        // touching the overlay.
        switch (key) {
          case 'playPause':
            e.preventDefault();
            togglePlay();
            break;
          case 'play':
            e.preventDefault();
            if (engine?.paused) togglePlay();
            break;
          case 'pause':
            e.preventDefault();
            if (engine && !engine.paused) togglePlay();
            break;
          case 'stop':
            e.preventDefault();
            a.leave();
            break;
          case 'blue':
            e.preventDefault();
            toggleInfo();
            break;
        }
        return;
      }
      e.preventDefault();
      // The player owns these keys. A press that opens a menu must not also reach the menu's first
      // row, which takes the focus a moment later: the navigation would count it as OK there.
      e.stopImmediatePropagation();
      // Before the first frame nothing but Back (and the Info, for a load that hangs) acts.
      if (!a.started) {
        if (key === 'blue') toggleInfo();
        return;
      }
      const wasVisible = o.visible;
      const scrubbing = sc.active();
      const touch = () => (wasVisible ? o.poke() : openOsd());

      // Keys that act at once, whether or not the overlay is open.
      switch (key) {
        case 'playPause':
          touch();
          if (scrubbing) commitScrub();
          else togglePlay();
          return;
        case 'play':
          touch();
          if (scrubbing) commitScrub();
          if (engine?.paused) togglePlay();
          return;
        case 'pause':
          touch();
          if (engine && !engine.paused) togglePlay();
          return;
        case 'stop':
          a.leave();
          return;
        case 'blue':
          toggleInfo();
          return;
        default:
          break;
      }
      // OK on a pill that holds the focus acts; Left and Right move between a prompt's buttons;
      // any other key only opens the overlay.
      if (!wasVisible) {
        if (key === 'enter' && current === 'pill') a.pill.activate();
        else if ((key === 'left' || key === 'right') && current === 'pill' && a.pill.move?.(key)) {
          return;
        } else openOsd();
        return;
      }
      o.poke();

      const direction: 1 | -1 | 0 =
        key === 'left' || key === 'rewind' ? -1 : key === 'right' || key === 'fastForward' ? 1 : 0;
      const now = Date.now();
      const prior = held.current;
      const repeat =
        direction !== 0 && (e.repeat || (prior?.key === key && now - prior.seen < HOLD_GAP_MS));
      if (direction !== 0) {
        if (repeat && prior?.key === key) prior.seen = now;
        else held.current = { key, since: now, seen: now, stepped: now };
      }

      if (scrubbing) {
        if (direction !== 0) {
          // A press steps the rate; a held key steps it once per HOLD_STEP_MS.
          const h = held.current!;
          if (!repeat || now - h.stepped >= HOLD_STEP_MS) {
            h.stepped = now;
            startScrub(direction);
          }
        } else if (key === 'enter') {
          commitScrub();
        }
        return;
      }

      if (key === 'rewind' || key === 'fastForward') {
        startScrub(direction as 1 | -1);
        return;
      }

      if (current === 'scrubber') {
        if (direction !== 0) {
          if (keyupSeen.current) {
            // KEYUP RULE: nothing is added on keydown.
            if (!repeat) {
              clearHoldTimer();
              const timer = setTimeout(() => {
                holdTimer.current = null;
                startScrub(direction);
              }, HOLD_MS);
              holdTimer.current = { key, direction, timer };
            } else if (holdTimer.current) {
              clearHoldTimer();
              startScrub(direction);
            }
          } else if (!repeat) {
            // REPEAT RULE (no keyup seen yet): a press is a tap at once.
            s.add(direction < 0 ? -a.skipBackSeconds : a.skipForwardSeconds);
          } else if (now - held.current!.since >= HOLD_MS) {
            held.current!.stepped = now;
            startScrub(direction);
          }
        } else if (key === 'enter') {
          togglePlay();
        } else if (key === 'down') {
          setFocusState('playPause');
        } else if (key === 'up') {
          setFocusState('close');
        }
        return;
      }

      // On Exit, top left: Down returns to the scrubber, Enter leaves; nothing else moves.
      if (current === 'close') {
        if (key === 'down') setFocusState('scrubber');
        else if (key === 'enter') a.leave();
        return;
      }

      // On the corner pill, which stands right of the last button (Info is always present and last).
      if (current === 'pill') {
        if ((key === 'left' || key === 'right') && a.pill.move?.(key)) return;
        if (key === 'left') setFocusState('info');
        else if (key === 'up') setFocusState('scrubber');
        else if (key === 'enter') a.pill.activate();
        return;
      }

      // On the button row: the transport buttons, then the menu buttons; the ends hold.
      const row = buttonRow(a.menus, a.episodes);
      const index = row.indexOf(current as OsdAction);
      if (index < 0) {
        // The button is gone (its menu left with a new stream): back to the scrubber.
        setFocusState('scrubber');
        return;
      }
      if (key === 'left' || key === 'right') {
        const step = key === 'right' ? 1 : -1;
        const target = row[index + step];
        if (target === undefined) {
          // Right of the last button: the skip pill when it shows, else the end holds.
          if (key === 'right' && a.pill.shown) {
            if (a.panel.open === current) a.panel.hide();
            setFocusState('pill');
          }
          return;
        }
        // Leaving the button of an open Info closes it.
        if (a.panel.open === current) a.panel.hide();
        setFocusState(target);
      } else if (key === 'up') {
        setFocusState('scrubber');
      } else if (key === 'enter') {
        action(current as OsdAction);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keyupSeen.current = true;
      const key = getPlatform().mapKey(e);
      if (key && held.current?.key === key) held.current = null;
      // Released before HOLD_MS: a tap.
      const pendingHold = holdTimer.current;
      if (key && pendingHold?.key === key) {
        clearHoldTimer();
        const { args: a, skip: s } = latest.current;
        s.add(pendingHold.direction < 0 ? -a.skipBackSeconds : a.skipForwardSeconds);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [engine, openOsd, startScrub, commitScrub, togglePlay, action, clearHoldTimer, toggleInfo]);

  const pointerMoved = useCallback(() => {
    // A menu is open: the overlay stays up on its own until it closes.
    if (!latest.current.args.started || latest.current.args.panel.open) return;
    if (visibleRef.current) latest.current.osd.poke();
    else openOsd();
  }, [openOsd]);

  const videoClicked = useCallback(() => {
    const { started: playing, panel } = latest.current.args;
    // A click outside the menu closes it, and is not also a play or pause.
    if (panel.open) {
      closeMenu();
      return;
    }
    if (!playing || visibleRef.current) return;
    togglePlay();
  }, [togglePlay, closeMenu]);

  return {
    visible: osd.visible,
    focus,
    shownPosition: scrub.state?.target ?? skip.pending ?? position,
    scrub: scrub.state,
    skipPending: skip.pending !== null,
    setFocus: setFocusState,
    action,
    seekToFraction,
    back,
    closeMenu,
    menuSide,
    pointerMoved,
    videoClicked,
  };
}

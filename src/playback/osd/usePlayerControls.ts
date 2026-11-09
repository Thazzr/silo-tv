import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlatform } from '../../platform';
import type { PlayerEngine } from '../engine/PlayerEngine';
import { OSD_BUTTONS, type OsdButton, type OsdFocus } from './PlayerOsd';
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
  toggleDiagnostics(): void;
  skipBackSeconds: number;
  skipForwardSeconds: number;
}

export interface PlayerControls {
  visible: boolean;
  focus: OsdFocus;
  /** The playhead as the overlay shows it. */
  shownPosition: number;
  scrub: ScrubState | null;
  setFocus(focus: OsdFocus): void;
  action(button: OsdButton): void;
  seekToFraction(fraction: number): void;
  /** Back: cancel scrubbing, else hide the overlay, else leave. */
  back(): void;
  /** Pointer movement over the player. */
  pointerMoved(): void;
  /** A click on the video itself. */
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
  const [overlayFocus, setFocusState] = useState<OsdFocus>('video');

  const skip = useSkipAccumulator({
    read: args.read,
    duration,
    commit: args.seekTo,
  });
  const scrub = useScrub(duration);
  const osd = useOsdVisibility(
    paused || buffering || scrub.state !== null || skip.pending !== null,
  );
  // A hidden overlay (also one that hid by itself when idle) leaves the focus on the video.
  const focus: OsdFocus = osd.visible ? overlayFocus : 'video';

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
  const visibleRef = useRef(false);
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

  // A pause shows the overlay, so the state is visible at once.
  useEffect(() => {
    if (started && paused && !visibleRef.current) openOsd();
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
    (button: OsdButton) => {
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
        case 'close':
          a.leave();
          break;
      }
    },
    [togglePlay],
  );

  const seekToFraction = useCallback((fraction: number) => {
    const { args: a, skip: s, scrub: sc } = latest.current;
    sc.cancel();
    s.commitNow(clampTime(fraction * a.duration, a.duration));
  }, []);

  const back = useCallback(() => {
    const { scrub: sc, osd: o, args: a } = latest.current;
    if (sc.active()) sc.cancel();
    else if (o.visible) hideOsd();
    else a.leave();
  }, [hideOsd]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = getPlatform().mapKey(e);
      if (!key || key === 'back') return;
      const { args: a, skip: s, scrub: sc, osd: o, focus: current } = latest.current;
      e.preventDefault();
      // Before the first frame nothing but Back (and the diagnostics) acts.
      if (!a.started) {
        if (key === 'blue') a.toggleDiagnostics();
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
          touch();
          a.toggleDiagnostics();
          return;
        default:
          break;
      }
      // Any other key only opens the overlay.
      if (!wasVisible) {
        openOsd();
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
        }
        return;
      }

      // On the buttons.
      const index = OSD_BUTTONS.indexOf(current as OsdButton);
      if (key === 'left') {
        setFocusState(OSD_BUTTONS[Math.max(0, index - 1)]!);
      } else if (key === 'right') {
        setFocusState(OSD_BUTTONS[Math.min(OSD_BUTTONS.length - 1, index + 1)]!);
      } else if (key === 'up') {
        setFocusState('scrubber');
      } else if (key === 'enter') {
        action(current as OsdButton);
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
  }, [engine, openOsd, startScrub, commitScrub, togglePlay, action, clearHoldTimer]);

  const pointerMoved = useCallback(() => {
    if (!latest.current.args.started) return;
    if (visibleRef.current) latest.current.osd.poke();
    else openOsd();
  }, [openOsd]);

  const videoClicked = useCallback(() => {
    if (!latest.current.args.started || visibleRef.current) return;
    togglePlay();
  }, [togglePlay]);

  return {
    visible: osd.visible,
    focus,
    shownPosition: scrub.state?.target ?? skip.pending ?? position,
    scrub: scrub.state,
    setFocus: setFocusState,
    action,
    seekToFraction,
    back,
    pointerMoved,
    videoClicked,
  };
}

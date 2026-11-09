// The Magic Remote wheel as Up and Down. Every list of the app scrolls by moving the focus (rows
// and grids by transform, the text dialog on Up and Down, tall screens through the adapter), so the
// wheel does not scroll anything itself: it presses the arrow key, and everything an arrow press
// does (FocusGroup handlers, index navigation, the library's search) applies unchanged.
import { useEffect } from 'react';

/** Wheel movement that makes one step; a notch of the Magic Remote wheel reports about 100. */
export const WHEEL_STEP_PX = 100;
/** The shortest time between two steps, so a fast spin does not flood the screen with presses. */
export const WHEEL_MIN_INTERVAL_MS = 120;
/** A pause this long forgets movement that did not add up to a step. */
export const WHEEL_IDLE_RESET_MS = 300;
// deltaMode 1 (lines) and 2 (pages) are rare in Chromium but possible with a mouse; three lines
// then count as one notch.
const LINE_PX = 34;

/** Deltas in pixels, whatever the unit of the event. */
export function wheelDeltaPx(delta: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * pageHeight;
  return delta;
}

export interface WheelStepper {
  /** The step the movement completes: 1 (down), -1 (up) or 0 (not yet, or too soon). */
  add(deltaPx: number, now: number): -1 | 0 | 1;
}

export function createWheelStepper(): WheelStepper {
  let acc = 0;
  let lastEvent = -Infinity;
  let lastStep = -Infinity;
  return {
    add(deltaPx, now) {
      if (now - lastEvent > WHEEL_IDLE_RESET_MS || Math.sign(deltaPx) !== Math.sign(acc)) acc = 0;
      lastEvent = now;
      acc += deltaPx;
      if (Math.abs(acc) < WHEEL_STEP_PX) return 0;
      const direction = acc > 0 ? 1 : -1;
      // Too soon: the movement stays and completes the step at the first event after the pause.
      if (now - lastStep < WHEEL_MIN_INTERVAL_MS) return 0;
      lastStep = now;
      acc = 0;
      return direction;
    },
  };
}

let suspended = 0;

/** Turns the wheel off until the returned function is called (screens with their own keys). */
export function suspendWheel(): () => void {
  suspended += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspended -= 1;
  };
}

/** The wheel does nothing while the calling component is mounted (the player, the probe). */
export function useWheelSuspended(): void {
  useEffect(() => suspendWheel(), []);
}

function pressArrow(direction: 1 | -1): void {
  const target = document.activeElement ?? document.body;
  // The key codes of NAV_KEYS in init.ts (not imported: init starts this listener).
  const keyCode = direction === 1 ? 40 : 38;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      keyCode,
      key: direction === 1 ? 'ArrowDown' : 'ArrowUp',
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Starts listening on the window; returns the function that stops it. */
export function startWheelNavigation(): () => void {
  const stepper = createWheelStepper();
  const onWheel = (e: WheelEvent) => {
    if (suspended > 0 || e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      return;
    }
    // Nothing may scroll natively: the lists move by focus.
    e.preventDefault();
    const step = stepper.add(wheelDeltaPx(e.deltaY, e.deltaMode, window.innerHeight), Date.now());
    if (step !== 0) pressArrow(step);
  };
  // Not passive: preventDefault must be allowed.
  window.addEventListener('wheel', onWheel, { passive: false });
  return () => window.removeEventListener('wheel', onWheel);
}

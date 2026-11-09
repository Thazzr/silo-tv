import { act, fireEvent } from '@testing-library/react';

export const KEY = { left: 37, up: 38, right: 39, down: 40, enter: 13, back: 461 } as const;

const LAYOUT_STALE_MS = 17;

/**
 * Presses a key and waits until the spatial navigation has moved the focus: the service measures
 * and decides asynchronously, so the new focus is only there a few promise ticks later.
 *
 * Before the key, pending React effects are flushed: an element registers with the navigation in
 * an effect, which on a loaded machine can run after its DOM node is already visible to a test
 * that waited for it. A key pressed in that gap would not find the element.
 *
 * The service also re-measures an element only when its last measurement is older than 16 ms
 * (its LAYOUT_STALE_TIME). jsdom has no layout, so the fake layout of a group depends on the
 * elements inside it, and a group measured while still empty keeps that box if a loaded machine
 * runs mount, data and key within one burst. Waiting out the window makes every key see a fresh box.
 */
export async function pressKey(keyCode: number, target: Element | Window = window): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, LAYOUT_STALE_MS));
  });
  await act(async () => {
    fireEvent.keyDown(target, { keyCode });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

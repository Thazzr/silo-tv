import { act, fireEvent } from '@testing-library/react';

export const KEY = { left: 37, up: 38, right: 39, down: 40, enter: 13, back: 461 } as const;

/**
 * Presses a key and waits until the spatial navigation has moved the focus: the service measures
 * and decides asynchronously, so the new focus is only there a few promise ticks later.
 */
export async function pressKey(keyCode: number, target: Element | Window = window): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(target, { keyCode });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

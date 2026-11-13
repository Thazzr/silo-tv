import { act, fireEvent } from '@testing-library/react';
import { expect, type Mock } from 'vitest';
import { getCurrentFocusKey } from '../app/nav';

/** Presses the remote's Play key (415) on the element that has the focus. */
export async function pressPlayKey(): Promise<void> {
  const focused = document.querySelector(`[data-focus-key="${getCurrentFocusKey()}"]`);
  if (!focused) throw new Error('nothing has the focus');
  await act(async () => {
    fireEvent.keyDown(focused, { keyCode: 415 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The Play key on a card starts the player on `contentId` from where it left off, without asking
 * and without opening the card's page.
 */
export function expectPlayedFromCard(onPlay: Mock, onOpenDetail: Mock, contentId: string): void {
  expect(onPlay).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ content_id: contentId }),
    { kind: 'resume' },
  );
  expect(onOpenDetail).not.toHaveBeenCalled();
}

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { onPlayKey } from './playKey';

function renderCard(play: () => void) {
  render(
    <button type="button" onKeyDown={onPlayKey(play)}>
      card
    </button>,
  );
  return screen.getByRole('button', { name: 'card' });
}

describe('onPlayKey', () => {
  it('plays on the remote Play key (415) and keeps the press from going on', () => {
    const play = vi.fn();
    const card = renderCard(play);
    const notCancelled = fireEvent.keyDown(card, { keyCode: 415 });
    expect(play).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(false);
  });

  it.each([
    ['OK', 13],
    ['Back', 461],
    ['Pause', 19],
    ['Play/Pause', 179],
    ['Right', 39],
  ])('does not play on %s', (_name, keyCode) => {
    const play = vi.fn();
    const card = renderCard(play);
    fireEvent.keyDown(card, { keyCode });
    expect(play).not.toHaveBeenCalled();
  });
});

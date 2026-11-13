import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KEY, pressKey } from '../../test/keys';
import { FocusGroup, Focusable, focusFromPointer, getCurrentFocusKey, setFocus } from '.';

function setup() {
  render(
    <FocusGroup focusKey="g">
      <Focusable focusKey="a" autoFocus>
        alpha
      </Focusable>
      <Focusable focusKey="b">beta</Focusable>
      <Focusable focusKey="c">gamma</Focusable>
    </FocusGroup>,
  );
}

const hover = async (name: string, focusKey: string) => {
  fireEvent.mouseMove(screen.getByText(name));
  await waitFor(() => expect(getCurrentFocusKey()).toBe(focusKey));
};

describe('where the focus came from', () => {
  it('is not the pointer for a focus that code or keys set', async () => {
    setup();
    await waitFor(() => expect(getCurrentFocusKey()).toBe('a'));
    expect(focusFromPointer()).toBe(false);
  });

  it('is the pointer after the pointer entered an element', async () => {
    setup();
    await waitFor(() => expect(getCurrentFocusKey()).toBe('a'));
    await hover('beta', 'b');
    expect(focusFromPointer()).toBe(true);
  });

  it('is the keys again with the next key press, also when the focus stays where it is', async () => {
    setup();
    await waitFor(() => expect(getCurrentFocusKey()).toBe('a'));
    await hover('beta', 'b');
    // Left from "beta" goes nowhere inside this group; the press alone ends the pointer's turn.
    await pressKey(KEY.left);
    expect(focusFromPointer()).toBe(false);
    await hover('gamma', 'c');
    expect(focusFromPointer()).toBe(true);
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe('b');
    expect(focusFromPointer()).toBe(false);
  });

  it('is not the pointer for a programmatic focus after a pointer focus', async () => {
    setup();
    await waitFor(() => expect(getCurrentFocusKey()).toBe('a'));
    await hover('beta', 'b');
    await act(async () => {
      await setFocus('c');
    });
    expect(getCurrentFocusKey()).toBe('c');
    expect(focusFromPointer()).toBe(false);
    // Back on the element the pointer had focused: still the code's focus, not the pointer's.
    await act(async () => {
      await setFocus('b');
    });
    expect(focusFromPointer()).toBe(false);
  });

  it('counts the synthesised arrow press of the wheel as keys', async () => {
    setup();
    await waitFor(() => expect(getCurrentFocusKey()).toBe('a'));
    await hover('beta', 'b');
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { keyCode: KEY.down, key: 'ArrowDown', bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(focusFromPointer()).toBe(false);
  });
});

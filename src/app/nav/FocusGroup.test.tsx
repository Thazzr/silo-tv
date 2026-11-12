import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { KEY, pressKey } from '../../test/keys';
import { FocusGroup, Focusable, Navigator } from '.';

function setup(onFocusWithin: (within: boolean) => void) {
  render(
    <Navigator
      initial="home"
      renderScreen={() => (
        <main>
          <Focusable focusKey="above" autoFocus>
            above
          </Focusable>
          <FocusGroup focusKey="group" enterable onFocusWithin={onFocusWithin}>
            <Focusable focusKey="inside-1">one</Focusable>
            <Focusable focusKey="inside-2">two</Focusable>
          </FocusGroup>
          <FocusGroup focusKey="other" enterable>
            <Focusable focusKey="outside">outside</Focusable>
          </FocusGroup>
        </main>
      )}
    />,
  );
}

describe('FocusGroup: onFocusWithin', () => {
  it('says true when the focus enters the group, stays true inside it, and says false when it leaves', async () => {
    const onFocusWithin = vi.fn<(within: boolean) => void>();
    setup(onFocusWithin);
    await waitFor(() => expect(screen.getByText('above')).toHaveFocus());
    expect(onFocusWithin).not.toHaveBeenCalledWith(true);

    await pressKey(KEY.down);
    expect(screen.getByText('one')).toHaveFocus();
    await waitFor(() => expect(onFocusWithin).toHaveBeenLastCalledWith(true));
    const callsInside = onFocusWithin.mock.calls.length;

    await pressKey(KEY.down);
    expect(screen.getByText('two')).toHaveFocus();
    // Moving on inside the group is not a change.
    expect(onFocusWithin.mock.calls.length).toBe(callsInside);

    await pressKey(KEY.down);
    expect(screen.getByText('outside')).toHaveFocus();
    await waitFor(() => expect(onFocusWithin).toHaveBeenLastCalledWith(false));
  });
});

describe('FocusGroup: a changed onFocusWithin', () => {
  it('calls the one it was last given, not the one it had when it mounted', async () => {
    const first = vi.fn<(within: boolean) => void>();
    const second = vi.fn<(within: boolean) => void>();
    const swap: { to: () => void } = { to: () => undefined };
    function Screen() {
      const [callback, setCallback] = useState(() => first);
      useEffect(() => {
        swap.to = () => setCallback(() => second);
      }, []);
      return (
        <main>
          <Focusable focusKey="above" autoFocus>
            above
          </Focusable>
          <FocusGroup focusKey="group" enterable onFocusWithin={callback}>
            <Focusable focusKey="inside">inside</Focusable>
          </FocusGroup>
        </main>
      );
    }
    render(<Navigator initial="home" renderScreen={() => <Screen />} />);
    await waitFor(() => expect(screen.getByText('above')).toHaveFocus());
    act(() => swap.to());
    await pressKey(KEY.down);
    expect(screen.getByText('inside')).toHaveFocus();
    await waitFor(() => expect(second).toHaveBeenLastCalledWith(true));
    expect(first).not.toHaveBeenCalledWith(true);
  });
});

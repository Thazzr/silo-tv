import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KEY, pressKey } from '../../test/keys';
import { FocusGroup, Focusable, FocusableInput, FocusTrackerContext, Navigator } from '.';

function setup(onPick: (name: string) => void = () => undefined) {
  render(
    <Navigator
      initial="home"
      renderScreen={() => (
        <main>
          <Focusable focusKey="a" autoFocus onClick={() => onPick('a')}>
            alpha
          </Focusable>
          <Focusable focusKey="b" onClick={() => onPick('b')}>
            beta
          </Focusable>
          <Focusable focusKey="c" disabled onClick={() => onPick('c')}>
            gamma
          </Focusable>
          <Focusable focusKey="d" onClick={() => onPick('d')}>
            delta
          </Focusable>
          <Focusable focusKey="e" onClick={() => onPick('e')}>
            epsilon
          </Focusable>
          <FocusableInput focusKey="field" aria-label="field" />
        </main>
      )}
    />,
  );
}

describe('pointer and 5-way share one focus state', () => {
  it('focuses an element when the pointer enters it', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('alpha')).toHaveFocus());
    fireEvent.mouseEnter(screen.getByText('delta'));
    await waitFor(() => expect(screen.getByText('delta')).toHaveFocus());
  });

  it('activates an element on click', () => {
    const onPick = vi.fn();
    setup(onPick);
    fireEvent.click(screen.getByText('beta'));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('continues arrow navigation from the hovered element', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('alpha')).toHaveFocus());
    fireEvent.mouseEnter(screen.getByText('delta'));
    await waitFor(() => expect(screen.getByText('delta')).toHaveFocus());
    await pressKey(KEY.down);
    expect(screen.getByText('epsilon')).toHaveFocus();
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    // Up from "delta" skips the disabled "gamma" and lands on "beta", not on "alpha".
    expect(screen.getByText('beta')).toHaveFocus();
  });

  it('does not focus a disabled element under the pointer', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('alpha')).toHaveFocus());
    fireEvent.mouseEnter(screen.getByText('gamma'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('alpha')).toHaveFocus();
  });

  it('follows DOM focus that did not come from the navigation', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('alpha')).toHaveFocus());
    screen.getByText('delta').focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await pressKey(KEY.down);
    expect(screen.getByText('epsilon')).toHaveFocus();
  });
});

describe('keys', () => {
  it('OK clicks the focused element exactly once and cancels the native click', async () => {
    const onPick = vi.fn();
    setup(onPick);
    await waitFor(() => expect(screen.getByText('alpha')).toHaveFocus());
    const event = new KeyboardEvent('keydown', { keyCode: KEY.enter, cancelable: true });
    window.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('a');
    expect(event.defaultPrevented).toBe(true);
  });

  it('skips a disabled element with the arrow keys', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('alpha')).toHaveFocus());
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    expect(screen.getByText('delta')).toHaveFocus();
  });

  it('leaves Enter to a text field (the form submits, nothing is clicked)', async () => {
    const onPick = vi.fn();
    setup(onPick);
    const field = screen.getByLabelText('field');
    field.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const event = new KeyboardEvent('keydown', {
      keyCode: KEY.enter,
      cancelable: true,
      bubbles: true,
    });
    field.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(event.defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
  });

  it.each([KEY.left, KEY.right])(
    'leaves keyCode %i to a text field and keeps the focus on it',
    async (keyCode) => {
      setup();
      const field = screen.getByLabelText('field');
      field.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const event = new KeyboardEvent('keydown', { keyCode, cancelable: true, bubbles: true });
      field.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(event.defaultPrevented).toBe(false);
      expect(field).toHaveFocus();
    },
  );

  it('still moves up and down out of a text field', async () => {
    setup();
    const field = screen.getByLabelText('field');
    field.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await pressKey(KEY.up, field);
    expect(screen.getByText('epsilon')).toHaveFocus();
  });
});

describe('focus reports', () => {
  it('onFocused and the tracker hear every focus change, from keys and from the pointer', async () => {
    const own = vi.fn();
    const tracked: string[] = [];
    render(
      <Navigator
        initial="home"
        renderScreen={() => (
          <FocusTrackerContext.Provider value={(key) => tracked.push(key)}>
            <Focusable focusKey="a" autoFocus onFocused={own}>
              alpha
            </Focusable>
            <Focusable focusKey="b">beta</Focusable>
          </FocusTrackerContext.Provider>
        )}
      />,
    );
    await waitFor(() => expect(screen.getByText('alpha')).toHaveFocus());
    expect(own).toHaveBeenCalledTimes(1);
    await pressKey(KEY.down);
    expect(screen.getByText('beta')).toHaveFocus();
    expect(own).toHaveBeenCalledTimes(1);
    await pressKey(KEY.up);
    expect(own).toHaveBeenCalledTimes(2);
    fireEvent.mouseEnter(screen.getByText('beta'));
    await waitFor(() => expect(screen.getByText('beta')).toHaveFocus());
    expect(tracked).toEqual(['a', 'b', 'a', 'b']);
  });
});

describe('FocusGroup', () => {
  function Two({ saveLast }: { saveLast?: boolean }) {
    return (
      <Navigator
        initial="home"
        renderScreen={() => (
          <main>
            <FocusGroup
              focusKey="top"
              enterable
              preferredChildFocusKey="t2"
              saveLastFocusedChild={saveLast}
            >
              <Focusable focusKey="t1" autoFocus data-rect="0,0,100,100">
                t1
              </Focusable>
              <Focusable focusKey="t2" data-rect="200,0,100,100">
                t2
              </Focusable>
            </FocusGroup>
            <FocusGroup focusKey="below" enterable>
              <Focusable focusKey="c1" data-rect="0,500,100,100">
                c1
              </Focusable>
            </FocusGroup>
          </main>
        )}
      />
    );
  }

  it('an enterable group is entered from the group above, at its preferred child', async () => {
    render(<Two saveLast={false} />);
    await waitFor(() => expect(screen.getByText('t1')).toHaveFocus());
    await pressKey(KEY.down);
    expect(screen.getByText('c1')).toHaveFocus();
    await pressKey(KEY.up);
    // Not the last focused child (it is not saved), but the preferred one.
    expect(screen.getByText('t2')).toHaveFocus();
  });
});

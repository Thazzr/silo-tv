import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useFocusNavigation } from './focus';

function List({
  onBack,
  onPick,
  extra = false,
}: {
  onBack?: () => void;
  onPick?: (name: string) => void;
  extra?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusNavigation(ref, onBack);
  return (
    <div ref={ref}>
      <button data-focusable onClick={() => onPick?.('one')}>
        one
      </button>
      <button data-focusable onClick={() => onPick?.('two')}>
        two
      </button>
      <button data-focusable disabled>
        skipped
      </button>
      <button data-focusable onClick={() => onPick?.('three')}>
        three
      </button>
      <input data-focusable aria-label="field" />
      {extra ? (
        <button data-focusable data-autofocus>
          extra
        </button>
      ) : null}
    </div>
  );
}

const press = (keyCode: number, target: Element | Window = window) =>
  fireEvent.keyDown(target, { keyCode });
const DOWN = 40;
const UP = 38;
const ENTER = 13;

describe('useFocusNavigation', () => {
  it('focuses the first element on mount', () => {
    render(<List />);
    expect(screen.getByText('one')).toHaveFocus();
  });

  it('prefers an element marked data-autofocus', () => {
    render(<List extra />);
    expect(screen.getByText('extra')).toHaveFocus();
  });

  it('moves focus to a data-autofocus element that appears later, once', async () => {
    const { rerender } = render(<List />);
    expect(screen.getByText('one')).toHaveFocus();
    rerender(<List extra />);
    await vi.waitFor(() => expect(screen.getByText('extra')).toHaveFocus());
    // The user moves on; unrelated changes must not pull focus back.
    press(UP);
    expect(screen.getByLabelText('field')).toHaveFocus();
    rerender(<List extra onPick={() => undefined} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByLabelText('field')).toHaveFocus();
  });

  it('moves down and up, skips disabled elements and stays within bounds', () => {
    render(<List />);
    press(UP);
    expect(screen.getByText('one')).toHaveFocus();
    press(DOWN);
    expect(screen.getByText('two')).toHaveFocus();
    press(DOWN);
    expect(screen.getByText('three')).toHaveFocus();
    press(DOWN);
    expect(screen.getByLabelText('field')).toHaveFocus();
    press(DOWN);
    expect(screen.getByLabelText('field')).toHaveFocus();
    press(UP);
    expect(screen.getByText('three')).toHaveFocus();
  });

  it('prevents the default scroll of the arrow keys', () => {
    render(<List />);
    const event = new KeyboardEvent('keydown', { keyCode: DOWN, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('activates the focused element on Enter, exactly once', () => {
    const onPick = vi.fn();
    render(<List onPick={onPick} />);
    press(DOWN);
    const event = new KeyboardEvent('keydown', { keyCode: ENTER, cancelable: true });
    window.dispatchEvent(event);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('two');
    // The default action (the browser's own click) is cancelled so it cannot double-fire.
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Enter to a text field', () => {
    const onPick = vi.fn();
    render(<List onPick={onPick} />);
    const field = screen.getByLabelText('field');
    field.focus();
    const event = new KeyboardEvent('keydown', { keyCode: ENTER, cancelable: true, bubbles: true });
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('focuses an element when the pointer enters it', () => {
    render(<List />);
    expect(screen.getByText('one')).toHaveFocus();
    fireEvent.mouseOver(screen.getByText('three'));
    expect(screen.getByText('three')).toHaveFocus();
  });

  it.each([461, 27])('calls the back handler for keyCode %i', (keyCode) => {
    const onBack = vi.fn();
    render(<List onBack={onBack} />);
    const event = new KeyboardEvent('keydown', { keyCode, cancelable: true });
    window.dispatchEvent(event);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets Backspace edit a text field instead of going back', () => {
    const onBack = vi.fn();
    render(<List onBack={onBack} />);
    const field = screen.getByLabelText('field');
    field.focus();
    fireEvent.keyDown(field, { keyCode: 8 });
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByText('one'), { keyCode: 8 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('moves focus back into the container when the focused element disappears', async () => {
    const { rerender } = render(<List extra />);
    expect(screen.getByText('extra')).toHaveFocus();
    rerender(<List />);
    await vi.waitFor(() => expect(screen.getByText('one')).toHaveFocus());
  });

  it('removes its key listener on unmount', () => {
    const onBack = vi.fn();
    const { unmount } = render(<List onBack={onBack} />);
    unmount();
    press(461);
    expect(onBack).not.toHaveBeenCalled();
  });
});

function Pad() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusNavigation(ref);
  return (
    <div ref={ref}>
      <button data-focusable>top</button>
      <div data-columns="3">
        {['1', '2', '3', '4', '5', '6', '7'].map((d) => (
          <button key={d} data-focusable>
            {d}
          </button>
        ))}
      </div>
      <button data-focusable>bottom</button>
    </div>
  );
}

describe('useFocusNavigation in a grid', () => {
  it('moves by column with up and down and by one with left and right', () => {
    render(<Pad />);
    press(DOWN);
    expect(screen.getByText('1')).toHaveFocus();
    press(DOWN);
    expect(screen.getByText('4')).toHaveFocus();
    press(39);
    expect(screen.getByText('5')).toHaveFocus();
    press(DOWN);
    expect(screen.getByText('bottom')).toHaveFocus();
    press(UP);
    expect(screen.getByText('7')).toHaveFocus();
    press(UP);
    expect(screen.getByText('4')).toHaveFocus();
    press(UP);
    expect(screen.getByText('1')).toHaveFocus();
    press(UP);
    expect(screen.getByText('top')).toHaveFocus();
  });

  it('leaves the grid downward from the last row and upward from the first', () => {
    render(<Pad />);
    press(DOWN);
    expect(screen.getByText('1')).toHaveFocus();
    press(37);
    expect(screen.getByText('1')).toHaveFocus();
    press(UP);
    expect(screen.getByText('top')).toHaveFocus();
  });
});

function InputInGrid() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusNavigation(ref);
  return (
    <div ref={ref} data-columns="3">
      <button data-focusable>left</button>
      <input data-focusable aria-label="cell" />
      <button data-focusable>right</button>
    </div>
  );
}

describe('useFocusNavigation with a text field', () => {
  it.each([37, 39])('keeps focus on the input and does not prevent keyCode %i', (keyCode) => {
    render(<InputInGrid />);
    const input = screen.getByLabelText('cell');
    input.focus();
    const event = new KeyboardEvent('keydown', { keyCode, cancelable: true, bubbles: true });
    input.dispatchEvent(event);
    expect(input).toHaveFocus();
    expect(event.defaultPrevented).toBe(false);
  });
});

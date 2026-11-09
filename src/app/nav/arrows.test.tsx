import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KEY, pressKey } from '../../test/keys';
import { FocusGroup, Focusable, getCurrentFocusKey, moveFocusTo, setFocus, stackArrows } from '.';
import { spySpatialSearch } from './testing';

describe('arrow handlers of a FocusGroup', () => {
  it('hear the direction and the focused key; a handled press skips the library search', async () => {
    const onArrow = vi.fn(() => true);
    render(
      <FocusGroup focusKey="g" onArrow={onArrow}>
        <Focusable focusKey="a" autoFocus>
          a
        </Focusable>
        <Focusable focusKey="b">b</Focusable>
      </FocusGroup>,
    );
    await pressKey(KEY.down);
    expect(onArrow).toHaveBeenCalledWith('down', 'a');
    expect(getCurrentFocusKey()).toBe('a');
    const search = spySpatialSearch();
    await pressKey(KEY.down);
    expect(search.count).toBe(0);
    search.restore();
  });

  it('pass a declined press to the group above, then to the library', async () => {
    const inner = vi.fn(() => false);
    const outer = vi.fn((direction: string) => direction === 'down' && moveFocusTo('c'));
    render(
      <FocusGroup focusKey="outer" onArrow={outer}>
        <FocusGroup focusKey="inner" onArrow={inner}>
          <Focusable focusKey="a" autoFocus>
            a
          </Focusable>
          <Focusable focusKey="b">b</Focusable>
        </FocusGroup>
        <Focusable focusKey="c">c</Focusable>
      </FocusGroup>,
    );
    await pressKey(KEY.down);
    expect(inner).toHaveBeenCalledWith('down', 'a');
    expect(outer).toHaveBeenCalledWith('down', 'a');
    expect(getCurrentFocusKey()).toBe('c');
    // Both decline Up: the library's search runs.
    const search = spySpatialSearch();
    await pressKey(KEY.up);
    expect(search.count).toBeGreaterThan(0);
    search.restore();
  });

  it('drop a press whose target is not mounted: the focus stays and the library does not search', async () => {
    render(
      <FocusGroup focusKey="g" onArrow={() => moveFocusTo('missing')}>
        <Focusable focusKey="a" autoFocus>
          a
        </Focusable>
        <Focusable focusKey="b">b</Focusable>
      </FocusGroup>,
    );
    const search = spySpatialSearch();
    try {
      await pressKey(KEY.down);
      expect(getCurrentFocusKey()).toBe('a');
      expect(search.count).toBe(0);
    } finally {
      search.restore();
    }
  });

  it('leave an element that does not exist alone instead of pointing the focus at nothing', async () => {
    render(
      <FocusGroup focusKey="g" onArrow={() => moveFocusTo('missing')}>
        <Focusable focusKey="a" autoFocus>
          a
        </Focusable>
      </FocusGroup>,
    );
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('a');
  });
});

describe('stackArrows', () => {
  function Stack() {
    return (
      <FocusGroup focusKey="stack" onArrow={stackArrows(['one', 'two', 'three'])}>
        {['one', 'two', 'three'].map((key) => (
          <FocusGroup key={key} focusKey={key} enterable saveLastFocusedChild>
            <Focusable focusKey={`${key}-x`} autoFocus={key === 'one'}>
              {`${key} x`}
            </Focusable>
            <Focusable focusKey={`${key}-y`}>{`${key} y`}</Focusable>
          </FocusGroup>
        ))}
      </FocusGroup>
    );
  }

  it('goes to the next block with Down and back with Up, onto the block’s saved child, and leaves the ends alone', async () => {
    render(<Stack />);
    await act(async () => {
      await setFocus('one-y');
    });
    expect(screen.getByText('one y')).toHaveFocus();
    const search = spySpatialSearch();
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe('two-x');
    await pressKey(KEY.down);
    await pressKey(KEY.up);
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe('one-y');
    expect(search.count).toBe(0);
    // Up from the first block is not decided here.
    await pressKey(KEY.up);
    expect(search.count).toBeGreaterThan(0);
    search.restore();
  });
});

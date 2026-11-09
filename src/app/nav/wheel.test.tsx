import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusGroup, Focusable, focusFromPointer, getCurrentFocusKey, suspendWheel } from '.';
import { spySpatialSearch } from './testing';
import {
  WHEEL_IDLE_RESET_MS,
  WHEEL_MIN_INTERVAL_MS,
  createWheelStepper,
  wheelDeltaPx,
} from './wheel';

describe('wheelDeltaPx', () => {
  it('keeps pixels and turns lines and pages into pixels', () => {
    expect(wheelDeltaPx(100, 0, 1080)).toBe(100);
    expect(wheelDeltaPx(3, 1, 1080)).toBeGreaterThanOrEqual(100);
    expect(wheelDeltaPx(1, 2, 1080)).toBe(1080);
  });
});

describe('createWheelStepper', () => {
  it('makes one step per 100 px, in the direction of the movement', () => {
    const s = createWheelStepper();
    expect(s.add(60, 0)).toBe(0);
    expect(s.add(60, 10)).toBe(1);
    expect(s.add(-100, 1000)).toBe(-1);
  });

  it('does not step before 100 px have added up', () => {
    const s = createWheelStepper();
    expect(s.add(99, 0)).toBe(0);
  });

  it('allows at most one step per 120 ms and gives one step, not ten, for what was spun in between', () => {
    const s = createWheelStepper();
    expect(s.add(100, 0)).toBe(1);
    expect(s.add(500, 50)).toBe(0);
    expect(s.add(500, 100)).toBe(0);
    expect(s.add(100, WHEEL_MIN_INTERVAL_MS)).toBe(1);
    // The 1000 px spun inside the window gave one step later, not ten.
    expect(s.add(10, WHEEL_MIN_INTERVAL_MS + 10)).toBe(0);
    expect(s.add(10, 2 * WHEEL_MIN_INTERVAL_MS + 20)).toBe(0);
  });

  it('forgets movement of the other direction', () => {
    const s = createWheelStepper();
    expect(s.add(80, 0)).toBe(0);
    expect(s.add(-80, 10)).toBe(0);
    // 80 up is all that counts now; 80 down earlier must not complete it.
    expect(s.add(-30, 20)).toBe(-1);
  });

  it('forgets movement after a pause', () => {
    const s = createWheelStepper();
    expect(s.add(80, 0)).toBe(0);
    expect(s.add(80, WHEEL_IDLE_RESET_MS + 1)).toBe(0);
    expect(s.add(80, WHEEL_IDLE_RESET_MS + 2)).toBe(1);
  });
});

describe('wheel navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(100_000);
  });
  afterEach(() => vi.useRealTimers());

  async function wheel(init: WheelEventInit): Promise<WheelEvent> {
    const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
    // As pressKey does: let effects register and the service's layout cache go stale.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 17));
    });
    await act(async () => {
      window.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return event;
  }

  function renderGroup(onArrow = vi.fn(() => true)) {
    render(
      <FocusGroup focusKey="g" onArrow={onArrow}>
        <Focusable focusKey="a" autoFocus>
          a
        </Focusable>
        <Focusable focusKey="b">b</Focusable>
      </FocusGroup>,
    );
    return onArrow;
  }

  it('presses Down through the arrow path of the focused element, and Up for the other way', async () => {
    const onArrow = renderGroup();
    await wheel({ deltaY: 100 });
    expect(onArrow).toHaveBeenCalledWith('down', 'a');
    vi.setSystemTime(Date.now() + 1000);
    await wheel({ deltaY: -100 });
    expect(onArrow).toHaveBeenLastCalledWith('up', 'a');
  });

  it('presses Down from an element the pointer focused, and the press ends the pointer focus', async () => {
    const onArrow = renderGroup();
    fireEvent.mouseEnter(screen.getByText('b'));
    await waitFor(() => expect(getCurrentFocusKey()).toBe('b'));
    expect(focusFromPointer()).toBe(true);
    await wheel({ deltaY: 100 });
    expect(onArrow).toHaveBeenCalledWith('down', 'b');
    expect(focusFromPointer()).toBe(false);
  });

  it('presses nothing before 100 px, and ignores horizontal movement', async () => {
    const onArrow = renderGroup();
    await wheel({ deltaY: 50 });
    const sideways = await wheel({ deltaX: 300, deltaY: 100 });
    expect(onArrow).not.toHaveBeenCalled();
    expect(sideways.defaultPrevented).toBe(false);
  });

  it('prevents the default action of a handled wheel, even before a step is complete', async () => {
    renderGroup();
    expect((await wheel({ deltaY: 30 })).defaultPrevented).toBe(true);
  });

  it('reaches the library search when no group decides the press, like an arrow key', async () => {
    renderGroup(vi.fn(() => false));
    const search = spySpatialSearch();
    await wheel({ deltaY: 100 });
    expect(search.count).toBeGreaterThan(0);
    search.restore();
  });

  it('does nothing while the wheel is suspended', async () => {
    const onArrow = renderGroup();
    const resume = suspendWheel();
    const event = await wheel({ deltaY: 100 });
    expect(onArrow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    resume();
    vi.setSystemTime(Date.now() + 1000);
    await wheel({ deltaY: 100 });
    expect(onArrow).toHaveBeenCalledTimes(1);
  });

  it('counts line-based wheels in pixels', async () => {
    const onArrow = renderGroup();
    await wheel({ deltaY: 3, deltaMode: 1 });
    expect(onArrow).toHaveBeenCalledWith('down', 'a');
  });

  it('stops listening when the navigation is destroyed', async () => {
    const { destroyNavigation } = await import('.');
    const onArrow = renderGroup();
    destroyNavigation();
    const event = await wheel({ deltaY: 100 });
    expect(onArrow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('presses Down on the document body when nothing has the focus yet', async () => {
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(`${e.keyCode}@${(e.target as Element).tagName}`);
    window.addEventListener('keydown', spy);
    (document.activeElement as HTMLElement | null)?.blur();
    await wheel({ deltaY: 100 });
    window.removeEventListener('keydown', spy);
    expect(seen).toEqual(['40@BODY']);
  });
});

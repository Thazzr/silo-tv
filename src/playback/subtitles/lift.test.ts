import { afterEach, describe, expect, it } from 'vitest';
import { LIFT_GAP_PX, liftAbove, measureLift } from './lift';

describe('liftAbove', () => {
  it('lifts a bottom block by the overlay body plus the gap', () => {
    // The block rests 54 px from the bottom; the body's top edge is 354 px up.
    expect(liftAbove(54, 354)).toBe(300 + LIFT_GAP_PX);
  });

  it('lifts only as far as needed, and not at all when the block already clears the body', () => {
    expect(liftAbove(238, 354)).toBe(354 + LIFT_GAP_PX - 238);
    expect(liftAbove(600, 354)).toBe(0);
  });
});

interface Geometry {
  parentHeight: number;
  parentRectHeight?: number;
  /** The body's top edge in screen pixels (y down). */
  bodyTop: number;
  blockOffsetTop: number;
  blockHeight: number;
}

function layout(g: Geometry): HTMLElement {
  const rectHeight = g.parentRectHeight ?? g.parentHeight;
  const parent = document.createElement('div');
  const block = document.createElement('div');
  const body = document.createElement('div');
  body.className = 'player-osd-body';
  parent.append(block, body);
  document.body.append(parent);
  Object.defineProperty(parent, 'clientHeight', { value: g.parentHeight });
  parent.getBoundingClientRect = () =>
    ({ top: 0, bottom: rectHeight, height: rectHeight }) as DOMRect;
  body.getBoundingClientRect = () => ({ top: g.bodyTop }) as DOMRect;
  Object.defineProperty(block, 'offsetTop', { value: g.blockOffsetTop });
  Object.defineProperty(block, 'offsetHeight', { value: g.blockHeight });
  return block;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('measureLift', () => {
  // A 1080 px screen. The block rests on the bottom safe edge (54 px up); the overlay body is
  // 300 px tall above the same 54 px padding, so its top edge is at y = 726.
  const bottom: Geometry = {
    parentHeight: 1080,
    bodyTop: 726,
    blockOffsetTop: 1026 - 100,
    blockHeight: 100,
  };

  it('lifts a bottom block by the body height plus the gap, not to the middle', () => {
    expect(measureLift(layout(bottom), 'bottom')).toBe(300 + LIFT_GAP_PX);
  });

  it('never moves a top block', () => {
    expect(measureLift(layout({ ...bottom, blockOffsetTop: 54, blockHeight: 100 }), 'top')).toBe(0);
  });

  it('lifts a lower-third block only when the overlay would cover it', () => {
    // Rests 238 px up, below the body's top edge (354 px up): covered.
    const covered = layout({ ...bottom, blockOffsetTop: 1080 - 238 - 100 });
    expect(measureLift(covered, 'lower-third')).toBe(354 + LIFT_GAP_PX - 238);
    // A shorter body (top edge 200 px up) leaves it alone.
    const clear = layout({ ...bottom, bodyTop: 880, blockOffsetTop: 1080 - 238 - 100 });
    expect(measureLift(clear, 'lower-third')).toBe(0);
  });

  it('measures in layout pixels when the whole app is scaled', () => {
    const scaled = layout({ ...bottom, parentRectHeight: 720, bodyTop: 726 * (720 / 1080) });
    expect(measureLift(scaled, 'bottom')).toBe(300 + LIFT_GAP_PX);
  });

  it('is 0 without an overlay in the DOM', () => {
    const parent = document.createElement('div');
    const block = document.createElement('div');
    parent.append(block);
    document.body.append(parent);
    Object.defineProperty(parent, 'clientHeight', { value: 1080 });
    expect(measureLift(block, 'bottom')).toBe(0);
  });
});

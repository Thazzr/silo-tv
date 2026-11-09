// The layout adapter of the spatial navigation: how the service measures an element and how it
// gives one the DOM focus. Two things differ from the library's default adapter.
//
//  1. A card of a row or grid is not measured through the DOM. Rows and grids place their cards
//     with plain arithmetic (src/ui/media/layout.ts) and write the result on the slot as
//     `data-nav-rect="x,y,width,height"`; reading that attribute costs no layout. The default
//     adapter walks the offsetParent chain of the card and of its parent on every focus change
//     (twice, for the element that is left and the one that is reached), which on the TV was the
//     single largest cost of a key press (CPU profile, webOS 24).
//  2. DOM focus never scrolls on its own (`domNodeFocusOptions.preventScroll`, see init.ts). The
//     boxes that scroll with a transform must not be scrolled natively, and the ones that do
//     scroll (a long list in a panel, a tall screen) are brought to the focused element here, in
//     one place, instead of by each screen.
import { BaseWebAdapter } from '@noriginmedia/norigin-spatial-navigation';
import { focusFromPointer } from './origin';

/** Attribute of a card's slot: its box in the coordinates of its group, "x,y,width,height". */
export const NAV_RECT_ATTR = 'data-nav-rect';
/**
 * Marks a box that is scrolled by a transform, so it must never scroll natively. Value "box": the
 * box positions everything inside it itself (row strip, grid viewport), nothing in it needs a
 * scroll position. Any other value ("page"): a page-sized box (Home, a detail page); a scrollable
 * element between the focused one and the box, such as a row of season pills, still scrolls.
 */
export const TRANSFORM_SCROLLED_ATTR = 'data-transform-scrolled';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function slotBox(node: HTMLElement | null | undefined): Box | null {
  const slot = node?.closest<HTMLElement>(`[${NAV_RECT_ATTR}]`);
  const parts = slot?.getAttribute(NAV_RECT_ATTR)?.split(',').map(Number);
  if (!parts || parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts as [number, number, number, number];
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
}

/**
 * How far `inner` lies outside `outer` along one axis, so that adding the result to the scroll
 * position brings it in: negative when it starts before, positive when it ends after. An element
 * larger than the room shows its start.
 */
function overshoot(innerStart: number, innerEnd: number, outerStart: number, outerEnd: number) {
  if (innerStart < outerStart || innerEnd - innerStart > outerEnd - outerStart) {
    return innerStart - outerStart;
  }
  if (innerEnd > outerEnd) return innerEnd - outerEnd;
  return 0;
}

/**
 * Room kept between the focused element and the edge it is scrolled to: a focused element grows
 * (scale 1.04 to 1.05) and casts a shadow, so flush with the edge it would be cut.
 */
const EDGE_MARGIN = 24;

function canScroll(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
  const style = getComputedStyle(el);
  const scrolls = (value: string) => value !== 'visible' && value !== 'clip';
  return scrolls(style.overflowX) || scrolls(style.overflowY);
}

/** What native focus scrolling did before (scroll the nearest way, honour scroll-padding), by hand. */
export function scrollFocusedIntoView(node: HTMLElement): void {
  if (node.closest(`[${TRANSFORM_SCROLLED_ATTR}="box"]`)) return;
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (el.hasAttribute(TRANSFORM_SCROLLED_ATTR)) return;
    if (el === document.body || el === document.documentElement) break;
    if (!canScroll(el)) continue;
    const box = el.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const m = EDGE_MARGIN;
    el.scrollTop += overshoot(rect.top, rect.bottom, box.top + m, box.bottom - m);
    el.scrollLeft += overshoot(rect.left, rect.right, box.left + m, box.right - m);
  }
  const root = document.scrollingElement;
  if (!root || root.scrollHeight <= root.clientHeight) return;
  // The document: the same, inside the window minus its scroll padding.
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const rect = node.getBoundingClientRect();
  const dy = overshoot(rect.top, rect.bottom, pad, window.innerHeight - EDGE_MARGIN);
  if (dy !== 0) root.scrollTop += dy;
}

export class NavAdapter extends BaseWebAdapter {
  constructor(...args: ConstructorParameters<typeof BaseWebAdapter>) {
    super(...args);
    const measureDom = this.measureLayout;
    this.measureLayout = (component) => {
      const box = slotBox(component.node);
      return box ? Promise.resolve({ ...box, node: component.node }) : measureDom(component);
    };
    const focusDom = this.focusNode;
    this.focusNode = (component) => {
      focusDom(component);
      // Hover moves the focus where it is; only keys and code bring the element into view.
      if (component.node && !focusFromPointer()) scrollFocusedIntoView(component.node);
    };
  }
}

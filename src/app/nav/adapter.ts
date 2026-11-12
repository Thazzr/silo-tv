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

/**
 * The room to keep on one side of a focused element: `EDGE_MARGIN`, or more when the stylesheet
 * asks for it with `scroll-margin` (a list whose last rows must stay inside the safe area).
 */
function edgeMargin(node: HTMLElement, side: 'Top' | 'Bottom'): number {
  const asked = parseFloat(getComputedStyle(node)[`scrollMargin${side}`]);
  return Math.max(EDGE_MARGIN, Number.isFinite(asked) ? asked : 0);
}

function canScroll(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
  const style = getComputedStyle(el);
  const scrolls = (value: string) => value !== 'visible' && value !== 'clip';
  return scrolls(style.overflowX) || scrolls(style.overflowY);
}

/** Whether the element stays where it is on screen while its page scrolls (a sticky or fixed bar). */
function staysOnScreen(el: Element, scope: ParentNode): boolean {
  // Only what lies between the element and the scrolling box counts: a dialog's own fixed
  // backdrop is above the box and moves nothing inside it.
  const stop = scope === document ? document.documentElement : scope;
  for (let up: Element | null = el; up && up !== stop; up = up.parentElement) {
    const { position } = getComputedStyle(up);
    if (position === 'sticky' || position === 'fixed') return true;
  }
  return false;
}

/**
 * The bottom edge of the focusable element that lies above `node` in `scope`, or null when
 * there is none. Focusable means what the navigation joined (`data-focus-key`), not every
 * `tabindex`. It has to come before `node` in the document and end above where `node` starts, so a
 * neighbour in the same row is not "above". Bars that stay on screen and elements that take no
 * room do not count.
 */
function precedingFocusableBottom(scope: ParentNode, node: HTMLElement): number | null {
  const top = node.getBoundingClientRect().top;
  const all = scope.querySelectorAll<HTMLElement>('[data-focus-key]:not(:disabled)');
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const other = all[i]!;
    if (!(other.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const rect = other.getBoundingClientRect();
    if (rect.bottom > top || (rect.width === 0 && rect.height === 0) || staysOnScreen(other, scope))
      continue;
    return rect.bottom;
  }
  return null;
}

/**
 * How far to scroll a box, or the document, vertically for the focused element: the way the room
 * needs. Where the element is the first focusable one of the box, or the way is up, it goes
 * further up so that what lies between the focusable element above and this one shows too (a
 * heading, a note, a setting's name), or all the way to the top when none is above. The focused
 * element wins: it never moves out of the room at the bottom. `edgeTop` is where the visible
 * part starts, `scrolled` how far the box is scrolled now, `aboveBottom` the bottom edge of the
 * focusable element before the focused one, if any.
 */
function verticalScroll(
  rect: { top: number; bottom: number },
  room: { top: number; bottom: number },
  edgeTop: number,
  scrolled: number,
  aboveBottom: number | null,
): number {
  const needed = overshoot(rect.top, rect.bottom, room.top, room.bottom);
  if (needed >= 0 && aboveBottom !== null) return needed;
  const wished = aboveBottom === null ? scrolled : edgeTop - aboveBottom;
  return -Math.max(-needed, Math.min(wished, room.bottom - rect.bottom));
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
    const room = {
      top: box.top + edgeMargin(node, 'Top'),
      bottom: box.bottom - edgeMargin(node, 'Bottom'),
    };
    el.scrollTop += verticalScroll(
      rect,
      room,
      box.top,
      el.scrollTop,
      precedingFocusableBottom(el, node),
    );
    el.scrollLeft += overshoot(rect.left, rect.right, box.left + m, box.right - m);
  }
  const root = document.scrollingElement;
  if (!root || root.scrollHeight <= root.clientHeight) return;
  // The document: the same, inside the window minus its scroll padding.
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const rect = node.getBoundingClientRect();
  const room = { top: pad, bottom: window.innerHeight - edgeMargin(node, 'Bottom') };
  const dy = verticalScroll(
    rect,
    room,
    pad,
    root.scrollTop,
    precedingFocusableBottom(document, node),
  );
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

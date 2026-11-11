import type { SubtitleAppearance } from '../../features/settings/profileSettings';

/** The overlay's bottom block: the scrubber, the title line and the control row. */
export const OSD_BODY_SELECTOR = '.player-osd-body';

/** Space kept between the subtitles' bottom edge and the top of the overlay's bottom block. */
export const LIFT_GAP_PX = 24;

/**
 * How far a subtitle block must rise to clear the overlay, in layout pixels.
 *
 * @param restBottom Distance from the screen's bottom edge to the block's bottom edge at rest.
 * @param bodyTop Distance from the screen's bottom edge to the top of the overlay's bottom block.
 *
 * Zero when the block already sits above the block plus the gap (a lower-third position the
 * overlay does not reach).
 */
export function liftAbove(restBottom: number, bodyTop: number): number {
  return Math.max(0, Math.round(bodyTop + LIFT_GAP_PX - restBottom));
}

/**
 * Measures the lift of a rendered subtitle block against the overlay's bottom block in the same
 * player. Top-positioned subtitles never move. Returns 0 when the overlay is not in the DOM.
 * Everything is converted to layout pixels, so the app's 720p scale does not matter.
 */
export function measureLift(block: HTMLElement, position: SubtitleAppearance['position']): number {
  if (position === 'top') return 0;
  const parent = block.parentElement;
  const body = parent?.querySelector<HTMLElement>(OSD_BODY_SELECTOR);
  if (!parent || !body || parent.clientHeight === 0) return 0;
  const parentRect = parent.getBoundingClientRect();
  const scale = parentRect.height / parent.clientHeight || 1;
  const bodyTop = (parentRect.bottom - body.getBoundingClientRect().top) / scale;
  // offsetTop ignores the block's own transform, and the block is anchored by its bottom edge.
  const restBottom = parent.clientHeight - (block.offsetTop + block.offsetHeight);
  return liftAbove(restBottom, bodyTop);
}

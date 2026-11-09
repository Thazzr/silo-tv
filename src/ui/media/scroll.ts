// The scroll model of rows and grids: which item is the first one on screen, and which items are
// mounted. Both follow the focus and depend on nothing but numbers.

/**
 * The first visible index after the focus moved to `focused`: unchanged while the focused item
 * is on screen, otherwise just far enough that it is. Never scrolls past the last full screen.
 */
export function nextScrollIndex(
  scroll: number,
  focused: number,
  visible: number,
  count: number,
): number {
  let next = scroll;
  if (focused < next) next = focused;
  else if (focused > next + visible - 1) next = focused - visible + 1;
  return Math.max(0, Math.min(next, Math.max(0, count - visible)));
}

/**
 * The indices to mount: the visible ones with a little room on both sides, and the focused one
 * wherever it is (it must exist for the focus to stay on it).
 */
export function mountedIndices(
  scroll: number,
  focused: number,
  visible: number,
  count: number,
  before: number,
  after: number,
): number[] {
  const start = Math.max(0, scroll - before);
  const end = Math.min(count, scroll + visible + after);
  const indices: number[] = [];
  for (let i = start; i < end; i += 1) indices.push(i);
  if (focused >= 0 && focused < count && (focused < start || focused >= end)) {
    indices.push(focused);
    indices.sort((a, b) => a - b);
  }
  return indices;
}

/**
 * Focusing an element can scroll an overflow-hidden box on its own, which would fight the
 * transform that scrolls the rows and the grid. This puts such a box back at its origin; use it
 * as the `onScroll` of every clipping box that holds focusable cards.
 */
export function keepAtOrigin(e: {
  currentTarget: { scrollTop: number; scrollLeft: number };
}): void {
  e.currentTarget.scrollTop = 0;
  e.currentTarget.scrollLeft = 0;
}

/** What rows and grids remember of the focus while another screen covers them: one index per id. */
export class FocusIndexMemory {
  private readonly indices = new Map<string, number>();

  get(id: string): number | undefined {
    return this.indices.get(id);
  }

  set(id: string, index: number): void {
    this.indices.set(id, index);
  }

  clear(): void {
    this.indices.clear();
  }
}

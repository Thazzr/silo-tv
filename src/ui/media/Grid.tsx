import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBarAway } from '../../app/shell/ShellBar';
import { FocusGroup, focusFromPointer, moveFocusTo, type ArrowDirection } from '../../app/nav';
import { CardSkeleton } from './Skeletons';
import { DEFAULT_GRID, type GridMetrics } from './layout';
import { prefetchImage } from './prefetch';
import {
  FocusIndexMemory,
  keepAtOrigin,
  mountedIndices,
  nextScrollIndex,
  prefetchIndices,
} from './scroll';

/** Grid rows mounted above the first visible row and below the last one. */
const MOUNT_ROWS_BEFORE = 1;
const MOUNT_ROWS_AFTER = 3;
/** Grid rows past the mounted ones whose pictures are fetched ahead, in the direction of travel. */
const PREFETCH_ROWS = 2;
/** The next page is requested when the focus is this many cards (three rows) from the end. */
export const LOAD_AHEAD_CARDS = DEFAULT_GRID.columns * 3;

export const gridFocusKey = (gridId: string) => `grid:${gridId}`;
export const gridCardKey = (gridId: string, key: string) => `gcard:${gridId}:${key}`;

export interface GridCardContext {
  focusKey: string;
  index: number;
  autoFocus: boolean;
  onFocused: () => void;
}

/** The rows a grid shows, reported to a parent that loads by position. */
export interface GridWindow {
  /** The first index of the top visible row. */
  top: number;
  /** The first index of the first mounted row. */
  first: number;
  /** One past the last index of the last mounted row. */
  end: number;
}

/**
 * The window of a grid scrolled to `scrollRow`: the scroll window only, because the focused card's
 * row is mounted wherever it is and must not widen it.
 */
export function gridWindow(scrollRow: number, totalRows: number, columns: number): GridWindow {
  return {
    top: scrollRow * columns,
    first: Math.max(0, scrollRow - MOUNT_ROWS_BEFORE) * columns,
    end: Math.min(totalRows, scrollRow + 1 + MOUNT_ROWS_AFTER) * columns,
  };
}

export interface GridProps<T> {
  gridId: string;
  /** One entry per list position; `undefined` is a title that is not loaded yet (a skeleton card). */
  items: readonly (T | undefined)[];
  getKey: (item: T) => string;
  renderCard: (item: T, context: GridCardContext) => ReactNode;
  /** The server has more pages. */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  memory?: FocusIndexMemory;
  /** The picture URL of a card; the rows just beyond the window are fetched ahead. Must be stable. */
  artUrl?: (item: T) => string | null;
  /** Columns, card size and spacing; the browse grid's six 260x390 posters unless given. Must be stable. */
  layout?: GridMetrics;
  /** Called when the visible or mounted rows change, for a list that loads the part in view. */
  onWindow?: (window: GridWindow) => void;
  /**
   * Scrolls the grid so the row of `index` is on top. A new object scrolls again. The focus stays
   * where it is (a jump from outside the grid), and only the remembered index follows.
   */
  jumpTo?: { index: number } | null;
  /**
   * Draws the rows above the scrolled-to row invisible. They stay mounted (Up needs a card to
   * land on) but must not peek into the top of a viewport that is cut mid-page.
   */
  hideRowsAbove?: boolean;
}

/**
 * A virtualised grid of 260x390 posters, six across (or another `layout`). Only the rows near the viewport are mounted;
 * the grid scrolls with a transform so the focused row is on screen. It asks for the next page
 * while the focus is still a few rows from the end, and it stops when the server has no more.
 */
export function Grid<T>({
  gridId,
  items,
  getKey,
  renderCard,
  hasMore,
  loadingMore,
  onLoadMore,
  memory,
  artUrl,
  layout = DEFAULT_GRID,
  onWindow,
  jumpTo,
  hideRowsAbove = false,
}: GridProps<T>) {
  const { columns, rowPitch } = layout;
  const loadAhead = columns * 3;
  const count = items.length;
  const [focused, setFocused] = useState(() =>
    Math.min(memory?.get(gridId) ?? 0, Math.max(0, count - 1)),
  );
  const totalRows = Math.ceil(count / columns) + (loadingMore ? 1 : 0);
  const focusedRow = Math.floor(focused / columns);
  // The grid row the viewport last scrolled to; a hovered card does not move it (nav/origin.ts).
  const [scrolledRow, setScrolledRow] = useState(() => focusedRow);
  const [scrollRow, setScrollRow] = useState(() => focusedRow);
  const effectiveScroll = nextScrollIndex(scrollRow, scrolledRow, 1, totalRows);
  // A grid scrolled off its first row has left the top of the page, so the shell's top bar leaves.
  useBarAway(effectiveScroll > 0);

  // A jump scrolls to the row of its index; it is not a focus move, so the focused card stays put.
  // The scroll is set while rendering (the new jump is told apart from the one handled), so the
  // first frame of the jump is already at the new row.
  const [handledJump, setHandledJump] = useState(jumpTo);
  if (jumpTo !== handledJump) {
    setHandledJump(jumpTo);
    if (jumpTo) {
      const row = Math.floor(jumpTo.index / columns);
      setScrolledRow(row);
      setScrollRow(row);
    }
  }
  useEffect(() => {
    if (jumpTo) memory?.set(gridId, jumpTo.index);
  }, [jumpTo, gridId, memory]);

  const loadMore = useRef(onLoadMore);
  useEffect(() => {
    loadMore.current = onLoadMore;
  });
  // Before the end: the focus is within three rows of the last loaded card.
  useEffect(() => {
    if (hasMore && !loadingMore && focused >= count - loadAhead) loadMore.current();
  }, [hasMore, loadingMore, focused, count, loadAhead]);

  // What a card does when the focus arrives. It changes only with the row count (a page loading),
  // so the cards, which are memoised, are not redrawn by a focus move.
  const focusIndex = useCallback(
    (index: number) => {
      setFocused(index);
      if (!focusFromPointer()) {
        setScrolledRow(Math.floor(index / columns));
        setScrollRow((current) =>
          nextScrollIndex(current, Math.floor(index / columns), 1, totalRows),
        );
      }
      memory?.set(gridId, index);
    },
    [columns, gridId, memory, totalRows],
  );

  const rows = mountedIndices(
    effectiveScroll,
    focusedRow,
    1,
    totalRows,
    MOUNT_ROWS_BEFORE,
    MOUNT_ROWS_AFTER,
  );
  const step = layout.card.width + layout.gap;
  // Arrow keys move by index (the cards sit at known places; the library's spatial search would
  // measure every card of the mounted rows on each press). The edges are left to it: Up from the
  // first row (pills above), Right from the last column (alphabet rail), the end of the list.
  const latest = useRef({
    items,
    getKey,
    byKey: new Map<string, number>(),
    mapped: null as unknown,
  });
  useEffect(() => {
    latest.current.items = items;
    latest.current.getKey = getKey;
  });
  const arrow = useCallback(
    (direction: ArrowDirection, fromKey: string) => {
      const now = latest.current;
      if (now.mapped !== now.items) {
        now.byKey = new Map();
        now.items.forEach((item, i) => {
          if (item !== undefined) now.byKey.set(gridCardKey(gridId, now.getKey(item)), i);
        });
        now.mapped = now.items;
      }
      const from = now.byKey.get(fromKey);
      if (from === undefined) return false;
      const total = now.items.length;
      const col = from % columns;
      let to = -1;
      if (direction === 'left') to = col > 0 ? from - 1 : -1;
      else if (direction === 'right') to = col < columns - 1 && from + 1 < total ? from + 1 : -1;
      else if (direction === 'up') to = from - columns;
      // Below a short last row there may be fewer cards than columns: land on the last one.
      else if (from + columns < total) to = from + columns;
      else if (Math.floor(from / columns) < Math.floor((total - 1) / columns)) to = total - 1;
      if (to < 0) return false;
      // A title that is not loaded yet cannot take the focus; the press waits for the next one.
      const target = now.items[to];
      return target === undefined ? true : moveFocusTo(gridCardKey(gridId, now.getKey(target)));
    },
    [columns, gridId],
  );
  const focusedItem = items[focused];

  const {
    top: windowTop,
    first: windowFirst,
    end: windowEnd,
  } = gridWindow(effectiveScroll, totalRows, columns);
  const reportWindow = useRef(onWindow);
  useEffect(() => {
    reportWindow.current = onWindow;
  });
  useEffect(() => {
    reportWindow.current?.({ top: windowTop, first: windowFirst, end: windowEnd });
  }, [windowTop, windowFirst, windowEnd]);

  // Pictures of the rows past the window, on the side the focus travels to.
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const lastFocusedRow = useRef(focusedRow);
  useEffect(() => {
    if (!artUrl || firstRow === undefined || lastRow === undefined) return;
    const direction = focusedRow < lastFocusedRow.current ? -1 : 1;
    lastFocusedRow.current = focusedRow;
    const ahead = prefetchIndices([firstRow, lastRow], totalRows, direction, PREFETCH_ROWS);
    for (const row of ahead) {
      for (let col = 0; col < columns; col += 1) {
        const item = items[row * columns + col];
        if (item !== undefined) prefetchImage(artUrl(item));
      }
    }
  }, [artUrl, columns, firstRow, focusedRow, items, lastRow, totalRows]);

  return (
    <div
      className="grid-viewport"
      data-testid="grid-viewport"
      data-transform-scrolled="box"
      onScroll={keepAtOrigin}
    >
      <FocusGroup
        focusKey={gridFocusKey(gridId)}
        enterable
        saveLastFocusedChild
        preferredChildFocusKey={
          focusedItem === undefined ? undefined : gridCardKey(gridId, getKey(focusedItem))
        }
        className="grid-track"
        data-columns={columns}
        data-testid="grid-track"
        onArrow={arrow}
        style={{
          transform: `translateY(${-effectiveScroll * rowPitch}px)`,
          height: totalRows * rowPitch,
          left: layout.inset,
          // The cards are absolute, so the track needs its width for the navigation to see its box.
          width: columns * step - layout.gap,
        }}
      >
        {rows.flatMap((row) => {
          const cells: ReactNode[] = [];
          for (let col = 0; col < columns; col += 1) {
            const index = row * columns + col;
            const style = {
              left: col * step,
              top: row * rowPitch,
              ...(hideRowsAbove && row < effectiveScroll ? { opacity: 0 } : {}),
            };
            const item = items[index];
            if (item === undefined) {
              // A title that is not loaded yet, and the row of placeholders that stands in for the
              // page that is loading.
              if (index < count || loadingMore) {
                cells.push(
                  <div className="grid-slot" key={`s${index}`} style={style}>
                    <CardSkeleton shape="grid" />
                  </div>,
                );
              }
              continue;
            }
            const key = getKey(item);
            cells.push(
              <div
                className="grid-slot"
                key={key}
                style={style}
                data-nav-rect={`${style.left},${style.top},${layout.card.width},${layout.card.height}`}
              >
                <GridCell
                  item={item}
                  index={index}
                  focusKey={gridCardKey(gridId, key)}
                  autoFocus={index === focused}
                  renderCard={renderCard}
                  focusIndex={focusIndex}
                />
              </div>,
            );
          }
          return cells;
        })}
      </FocusGroup>
    </div>
  );
}

interface GridCellProps<T> {
  item: T;
  index: number;
  focusKey: string;
  autoFocus: boolean;
  renderCard: (item: T, context: GridCardContext) => ReactNode;
  focusIndex: (index: number) => void;
}

// One card of the grid; skipped while the grid re-renders for a focus move (only the two cards
// whose autoFocus flag flips are drawn again).
function GridCellImpl<T>({
  item,
  index,
  focusKey,
  autoFocus,
  renderCard,
  focusIndex,
}: GridCellProps<T>) {
  const onFocused = useCallback(() => focusIndex(index), [focusIndex, index]);
  return <>{renderCard(item, { focusKey, index, autoFocus, onFocused })}</>;
}
const GridCell = memo(GridCellImpl) as typeof GridCellImpl;

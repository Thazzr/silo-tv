import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FocusGroup, moveFocusTo, type ArrowDirection } from '../../app/nav';
import { CardSkeleton } from './Skeletons';
import { CARD_GAP, GRID_CARD_SIZE, GRID_COLUMNS, GRID_ROW_PITCH, ROW_INSET } from './layout';
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
export const LOAD_AHEAD_CARDS = GRID_COLUMNS * 3;

export const gridFocusKey = (gridId: string) => `grid:${gridId}`;
export const gridCardKey = (gridId: string, key: string) => `gcard:${gridId}:${key}`;

export interface GridCardContext {
  focusKey: string;
  index: number;
  autoFocus: boolean;
  onFocused: () => void;
}

export interface GridProps<T> {
  gridId: string;
  items: readonly T[];
  getKey: (item: T) => string;
  renderCard: (item: T, context: GridCardContext) => ReactNode;
  /** The server has more pages. */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  memory?: FocusIndexMemory;
  /** The picture URL of a card; the rows just beyond the window are fetched ahead. Must be stable. */
  artUrl?: (item: T) => string | null;
}

/**
 * A virtualised grid of 260x390 posters, six across. Only the rows near the viewport are mounted;
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
}: GridProps<T>) {
  const count = items.length;
  const [focused, setFocused] = useState(() =>
    Math.min(memory?.get(gridId) ?? 0, Math.max(0, count - 1)),
  );
  const totalRows = Math.ceil(count / GRID_COLUMNS) + (loadingMore ? 1 : 0);
  const focusedRow = Math.floor(focused / GRID_COLUMNS);
  const [scrollRow, setScrollRow] = useState(() => focusedRow);
  const effectiveScroll = nextScrollIndex(scrollRow, focusedRow, 1, totalRows);

  const loadMore = useRef(onLoadMore);
  useEffect(() => {
    loadMore.current = onLoadMore;
  });
  // Before the end: the focus is within three rows of the last loaded card.
  useEffect(() => {
    if (hasMore && !loadingMore && focused >= count - LOAD_AHEAD_CARDS) loadMore.current();
  }, [hasMore, loadingMore, focused, count]);

  // What a card does when the focus arrives. It changes only with the row count (a page loading),
  // so the cards, which are memoised, are not redrawn by a focus move.
  const focusIndex = useCallback(
    (index: number) => {
      setFocused(index);
      setScrollRow((current) =>
        nextScrollIndex(current, Math.floor(index / GRID_COLUMNS), 1, totalRows),
      );
      memory?.set(gridId, index);
    },
    [gridId, memory, totalRows],
  );

  const rows = mountedIndices(
    effectiveScroll,
    focusedRow,
    1,
    totalRows,
    MOUNT_ROWS_BEFORE,
    MOUNT_ROWS_AFTER,
  );
  const step = GRID_CARD_SIZE.width + CARD_GAP;
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
        now.byKey = new Map(now.items.map((item, i) => [gridCardKey(gridId, now.getKey(item)), i]));
        now.mapped = now.items;
      }
      const from = now.byKey.get(fromKey);
      if (from === undefined) return false;
      const total = now.items.length;
      const col = from % GRID_COLUMNS;
      let to = -1;
      if (direction === 'left') to = col > 0 ? from - 1 : -1;
      else if (direction === 'right')
        to = col < GRID_COLUMNS - 1 && from + 1 < total ? from + 1 : -1;
      else if (direction === 'up') to = from - GRID_COLUMNS;
      // Below a short last row there may be fewer cards than columns: land on the last one.
      else if (from + GRID_COLUMNS < total) to = from + GRID_COLUMNS;
      else if (Math.floor(from / GRID_COLUMNS) < Math.floor((total - 1) / GRID_COLUMNS))
        to = total - 1;
      return to < 0 ? false : moveFocusTo(gridCardKey(gridId, now.getKey(now.items[to]!)));
    },
    [gridId],
  );
  const focusedItem = items[focused];

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
      for (let col = 0; col < GRID_COLUMNS; col += 1) {
        const item = items[row * GRID_COLUMNS + col];
        if (item !== undefined) prefetchImage(artUrl(item));
      }
    }
  }, [artUrl, firstRow, focusedRow, items, lastRow, totalRows]);

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
        data-columns={GRID_COLUMNS}
        data-testid="grid-track"
        onArrow={arrow}
        style={{
          transform: `translateY(${-effectiveScroll * GRID_ROW_PITCH}px)`,
          height: totalRows * GRID_ROW_PITCH,
          left: ROW_INSET,
          // The cards are absolute, so the track needs its width for the navigation to see its box.
          width: GRID_COLUMNS * step - CARD_GAP,
        }}
      >
        {rows.flatMap((row) => {
          const cells: ReactNode[] = [];
          for (let col = 0; col < GRID_COLUMNS; col += 1) {
            const index = row * GRID_COLUMNS + col;
            const style = { left: col * step, top: row * GRID_ROW_PITCH };
            const item = items[index];
            if (item === undefined) {
              // The row of placeholders that stands in for the page that is loading.
              if (loadingMore && index >= count) {
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
                data-nav-rect={`${style.left},${style.top},${GRID_CARD_SIZE.width},${GRID_CARD_SIZE.height}`}
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

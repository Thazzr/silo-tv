import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FocusGroup } from '../../app/nav';
import { CardSkeleton } from './Skeletons';
import { CARD_GAP, GRID_CARD_SIZE, GRID_COLUMNS, GRID_ROW_PITCH, ROW_INSET } from './layout';
import { FocusIndexMemory, keepAtOrigin, mountedIndices, nextScrollIndex } from './scroll';

/** Grid rows mounted above the first visible row and below the last one. */
const MOUNT_ROWS_BEFORE = 1;
const MOUNT_ROWS_AFTER = 3;
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

  const rows = mountedIndices(
    effectiveScroll,
    focusedRow,
    1,
    totalRows,
    MOUNT_ROWS_BEFORE,
    MOUNT_ROWS_AFTER,
  );
  const step = GRID_CARD_SIZE.width + CARD_GAP;
  const focusedItem = items[focused];

  return (
    <div className="grid-viewport" data-testid="grid-viewport" onScroll={keepAtOrigin}>
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
        style={{
          transform: `translateY(${-effectiveScroll * GRID_ROW_PITCH}px)`,
          height: totalRows * GRID_ROW_PITCH,
          left: ROW_INSET,
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
              <div className="grid-slot" key={key} style={style}>
                {renderCard(item, {
                  focusKey: gridCardKey(gridId, key),
                  index,
                  autoFocus: index === focused,
                  onFocused: () => {
                    setFocused(index);
                    setScrollRow((current) =>
                      nextScrollIndex(current, Math.floor(index / GRID_COLUMNS), 1, totalRows),
                    );
                    memory?.set(gridId, index);
                  },
                })}
              </div>,
            );
          }
          return cells;
        })}
      </FocusGroup>
    </div>
  );
}

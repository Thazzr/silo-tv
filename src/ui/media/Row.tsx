import { useCallback, useState, type ReactNode } from 'react';
import { FocusGroup } from '../../app/nav';
import { ExploreAllCard } from './Cards';
import {
  cardBlockHeight,
  rowHeight,
  rowStep,
  rowVisibleCards,
  ROW_INSET,
  STRIP_PADDING,
  type CardShape,
} from './layout';
import { FocusIndexMemory, mountedIndices, nextScrollIndex } from './scroll';

/** Cards mounted left of the first visible one, and right of the last: room for a few key presses. */
const MOUNT_BEFORE = 2;
const MOUNT_AFTER = 4;

export const rowFocusKey = (rowId: string) => `row:${rowId}`;
export const cardFocusKey = (rowId: string, key: string) => `card:${rowId}:${key}`;
export const EXPLORE_KEY = 'explore';

export interface CardContext {
  focusKey: string;
  index: number;
  /** The card reports its focus here; the row scrolls and remembers it. */
  onFocused: () => void;
}

export interface RowProps<T> {
  rowId: string;
  title: string;
  shape: CardShape;
  items: readonly T[];
  getKey: (item: T) => string;
  renderCard: (item: T, context: CardContext) => ReactNode;
  /** The row ends with an "Explore all" card that calls this. */
  onExploreAll?: () => void;
  /** Where the focus was when the row was last shown (it survives the screen being covered). */
  memory?: FocusIndexMemory;
  /** False renders the header and an empty strip of the same height: far-away rows cost nothing. */
  mounted?: boolean;
  onCardFocused?: (item: T, index: number) => void;
  onExploreFocused?: () => void;
  /** Any card of the row got the focus (for the screen's vertical scroll). */
  onRowFocused?: () => void;
  /** Left inset of the title and the first card; 80 px on Home, 100 px on the detail pages. */
  inset?: number;
}

/**
 * A titled horizontal list of cards. The focus moves card by card; the strip scrolls with a
 * transform so the focused card stays on screen; only the cards near the viewport are mounted.
 * Each row remembers its own focused card (also when the screen is covered), so Down and Up land
 * on the card you left.
 */
export function Row<T>({
  rowId,
  title,
  shape,
  items,
  getKey,
  renderCard,
  onExploreAll,
  memory,
  mounted = true,
  onCardFocused,
  onExploreFocused,
  onRowFocused,
  inset = ROW_INSET,
}: RowProps<T>) {
  const count = items.length + (onExploreAll ? 1 : 0);
  const visible = rowVisibleCards(shape);
  const step = rowStep(shape);
  const [focused, setFocused] = useState(() =>
    Math.min(memory?.get(rowId) ?? 0, Math.max(0, count - 1)),
  );
  const [scroll, setScroll] = useState(() => nextScrollIndex(0, focused, visible, count));
  // The count changes when cards load or are removed; keep the position valid.
  const effectiveScroll = nextScrollIndex(scroll, Math.min(focused, count - 1), visible, count);

  const focus = useCallback(
    (index: number, notify: () => void) => {
      setFocused(index);
      setScroll((current) => nextScrollIndex(current, index, visible, count));
      memory?.set(rowId, index);
      onRowFocused?.();
      notify();
    },
    [count, memory, onRowFocused, rowId, visible],
  );

  const focusedItem = items[focused];
  const focusedKey = focusedItem === undefined ? EXPLORE_KEY : getKey(focusedItem);
  const stripHeight = cardBlockHeight(shape) + 2 * STRIP_PADDING;
  const indices = mounted
    ? mountedIndices(effectiveScroll, focused, visible, count, MOUNT_BEFORE, MOUNT_AFTER)
    : [];

  return (
    <section
      className="row-section"
      data-testid={`row-${rowId}`}
      style={{ height: rowHeight(shape) }}
      aria-label={title}
    >
      <h2 className="row-title" data-testid="row-title" style={{ paddingLeft: inset }}>
        {title}
      </h2>
      {mounted ? (
        <FocusGroup
          focusKey={rowFocusKey(rowId)}
          enterable
          saveLastFocusedChild
          // A row that was unmounted and mounted again has forgotten its last focused card.
          preferredChildFocusKey={cardFocusKey(rowId, focusedKey)}
          className="row-strip"
          style={{ height: stripHeight }}
          data-shape={shape}
        >
          <div
            className="row-track"
            data-testid="row-track"
            style={{ transform: `translateX(${-effectiveScroll * step}px)`, left: inset }}
          >
            {indices.map((index) => {
              const item = items[index];
              const exploring = item === undefined;
              const key = exploring ? EXPLORE_KEY : getKey(item);
              const focusKey = cardFocusKey(rowId, key);
              return (
                <div className="row-slot" key={key} style={{ left: index * step }}>
                  {exploring ? (
                    <ExploreAllCard
                      shape={shape}
                      rowTitle={title}
                      focusKey={focusKey}
                      onOpen={() => onExploreAll?.()}
                      onFocused={() => focus(index, () => onExploreFocused?.())}
                    />
                  ) : (
                    renderCard(item, {
                      focusKey,
                      index,
                      onFocused: () => focus(index, () => onCardFocused?.(item, index)),
                    })
                  )}
                </div>
              );
            })}
          </div>
        </FocusGroup>
      ) : (
        <div className="row-strip" style={{ height: stripHeight }} data-shape={shape} />
      )}
    </section>
  );
}

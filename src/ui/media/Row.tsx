import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FocusGroup, moveFocusTo, type ArrowDirection } from '../../app/nav';
import { ExploreAllCard } from './Cards';
import {
  CARD_SIZE,
  cardBlockHeight,
  rowHeight,
  rowStep,
  rowVisibleCards,
  ROW_INSET,
  STRIP_PADDING,
  type CardShape,
} from './layout';
import { prefetchImage } from './prefetch';
import { FocusIndexMemory, mountedIndices, nextScrollIndex, prefetchIndices } from './scroll';

/** Cards mounted left of the first visible one, and right of the last: room for a few key presses. */
const MOUNT_BEFORE = 2;
const MOUNT_AFTER = 4;
/** Cards past the mounted window whose pictures are fetched ahead, on the side the focus travels to. */
const PREFETCH_AHEAD = 6;

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
  /** The picture URL a card of the row shows; the pictures just beyond the window are fetched ahead. Must be stable. */
  artUrl?: (item: T) => string | null;
  /** A row that is not mounted yet but is next in line: its first cards' pictures are fetched ahead. */
  prefetchRow?: boolean;
}

/**
 * A titled horizontal list of cards. The focus moves card by card; the strip scrolls with a
 * transform so the focused card stays on screen; only the cards near the viewport are mounted.
 * Each row remembers its own focused card (also when the screen is covered), so Down and Up land
 * on the card you left.
 */
function RowImpl<T>({
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
  artUrl,
  prefetchRow = false,
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

  // The callbacks of a card must not change when the focus moves, or no card could be skipped
  // while the row re-renders: the latest ones are read when the focus arrives.
  const latest = useRef({ items, getKey, onCardFocused, onExploreFocused, onRowFocused });
  useEffect(() => {
    latest.current = { items, getKey, onCardFocused, onExploreFocused, onRowFocused };
  });
  const focusIndex = useCallback(
    (index: number) => {
      setFocused(index);
      setScroll((current) => nextScrollIndex(current, index, visible, count));
      memory?.set(rowId, index);
      const now = latest.current;
      now.onRowFocused?.();
      const item = now.items[index];
      if (item === undefined) now.onExploreFocused?.();
      else now.onCardFocused?.(item, index);
    },
    [count, memory, rowId, visible],
  );

  // Left and Right move by index: the cards sit at known places, so the library's spatial search
  // (which measures every card of the row on every press) is not needed. The ends are left to it.
  const arrow = useCallback(
    (direction: ArrowDirection, fromKey: string) => {
      if (direction !== 'left' && direction !== 'right') return false;
      const now = latest.current;
      const keyAt = (i: number) =>
        cardFocusKey(rowId, i < now.items.length ? now.getKey(now.items[i]!) : EXPLORE_KEY);
      let from = -1;
      for (let i = 0; i < count; i += 1) {
        if (keyAt(i) === fromKey) {
          from = i;
          break;
        }
      }
      const to = from + (direction === 'right' ? 1 : -1);
      return from < 0 || to < 0 || to >= count ? false : moveFocusTo(keyAt(to));
    },
    [count, rowId],
  );

  const focusedItem = items[focused];
  const focusedKey = focusedItem === undefined ? EXPLORE_KEY : getKey(focusedItem);
  const stripHeight = cardBlockHeight(shape) + 2 * STRIP_PADDING;
  const indices = mounted
    ? mountedIndices(effectiveScroll, focused, visible, count, MOUNT_BEFORE, MOUNT_AFTER)
    : [];

  // Pictures ahead of the window, on the side the focus travels to; for a row that is not mounted
  // yet, the pictures it will show first.
  const firstMounted = indices[0];
  const lastMounted = indices[indices.length - 1];
  const lastFocused = useRef(focused);
  useEffect(() => {
    if (!artUrl) return;
    const direction = focused < lastFocused.current ? -1 : 1;
    lastFocused.current = focused;
    let ahead: number[] = [];
    if (firstMounted !== undefined && lastMounted !== undefined) {
      ahead = prefetchIndices([firstMounted, lastMounted], count, direction, PREFETCH_AHEAD);
    } else if (!mounted && prefetchRow) {
      ahead = Array.from({ length: Math.min(count, visible + MOUNT_AFTER) }, (_, i) => i);
    }
    for (const index of ahead) {
      const item = items[index];
      if (item !== undefined) prefetchImage(artUrl(item));
    }
  }, [artUrl, count, firstMounted, focused, items, lastMounted, mounted, prefetchRow, visible]);

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
          onArrow={arrow}
          data-transform-scrolled="box"
        >
          <div
            className="row-track"
            data-testid="row-track"
            style={{ transform: `translateX(${-effectiveScroll * step}px)`, left: inset }}
          >
            {indices.map((index) => {
              const item = items[index];
              const key = item === undefined ? EXPLORE_KEY : getKey(item);
              return (
                <div
                  className="row-slot"
                  key={key}
                  style={{ left: index * step }}
                  data-nav-rect={slotRect(index * step, shape)}
                >
                  <RowCard
                    rowId={rowId}
                    title={title}
                    shape={shape}
                    item={item}
                    itemKey={key}
                    index={index}
                    renderCard={renderCard}
                    focusIndex={focusIndex}
                    onExploreAll={onExploreAll}
                  />
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

/** Where a slot sits in its track and how big its card is, for the navigation (data-nav-rect, see src/app/nav/adapter.ts). */
const slotRect = (left: number, shape: CardShape) =>
  `${left},0,${CARD_SIZE[shape].width},${CARD_SIZE[shape].height}`;

interface RowCardProps<T> {
  rowId: string;
  title: string;
  shape: CardShape;
  item: T | undefined;
  itemKey: string;
  index: number;
  renderCard: (item: T, context: CardContext) => ReactNode;
  focusIndex: (index: number) => void;
  onExploreAll?: () => void;
}

const noop = () => undefined;

// One card of the row. It is skipped while the row re-renders for a focus move, as long as the
// row's own props are the same: the focus ring is CSS (:focus), so a card has nothing to redraw.
function RowCardImpl<T>({
  rowId,
  title,
  shape,
  item,
  itemKey,
  index,
  renderCard,
  focusIndex,
  onExploreAll,
}: RowCardProps<T>) {
  const onFocused = useCallback(() => focusIndex(index), [focusIndex, index]);
  const focusKey = cardFocusKey(rowId, itemKey);
  if (item === undefined) {
    return (
      <ExploreAllCard
        shape={shape}
        rowTitle={title}
        focusKey={focusKey}
        onOpen={onExploreAll ?? noop}
        onFocused={onFocused}
      />
    );
  }
  return <>{renderCard(item, { focusKey, index, onFocused })}</>;
}
const RowCard = memo(RowCardImpl) as typeof RowCardImpl;

// A row re-renders when its own focus moves, not when a screen above it re-renders for another
// row's focus (the callers hand it stable props).
export const Row = memo(RowImpl) as typeof RowImpl;

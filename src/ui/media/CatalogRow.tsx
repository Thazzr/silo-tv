import { memo, useCallback, useMemo } from 'react';
import { LandscapeCard, PosterCard } from './Cards';
import type { CatalogItem } from './cardInfo';
import type { CardShape } from './layout';
import { Row, type CardContext } from './Row';
import type { FocusIndexMemory } from './scroll';
import { useArtUrl } from './spoilers';

const contentId = (item: CatalogItem) => item.content_id;

export interface CatalogRowProps {
  rowId: string;
  title: string;
  shape: CardShape;
  items: readonly CatalogItem[];
  /** The row ends with an "Explore all" card. */
  hasMore: boolean;
  memory?: FocusIndexMemory;
  mounted: boolean;
  /** Not mounted yet but next in line: its first pictures are fetched ahead. */
  prefetchRow: boolean;
  /** Where the row sits on its screen; handed back to `onRowFocused`. */
  rowIndex: number;
  /** The three handlers below must be stable (the row is skipped while its props are the same). */
  onOpen: (item: CatalogItem) => void;
  onExploreAll: (rowId: string, title: string) => void;
  onRowFocused: (rowIndex: number) => void;
  onCardFocused?: (item: CatalogItem, shape: CardShape) => void;
}

/**
 * A row of catalog cards (posters, or wide cards for Continue Watching and Next Up) for a screen that
 * stacks several rows (Home, a library's Recommended view). It is memoised: while the focus runs
 * along another row the screen re-renders, and this row must not.
 */
export const CatalogRow = memo(function CatalogRow({
  rowId,
  title,
  shape,
  items,
  hasMore,
  memory,
  mounted,
  prefetchRow,
  rowIndex,
  onOpen,
  onExploreAll,
  onRowFocused,
  onCardFocused,
}: CatalogRowProps) {
  const artUrl = useArtUrl(shape === 'landscape' ? 'landscape' : 'poster');
  const exploreAll = useMemo(
    () => (hasMore ? () => onExploreAll(rowId, title) : undefined),
    [hasMore, onExploreAll, rowId, title],
  );
  const rowFocused = useCallback(() => onRowFocused(rowIndex), [onRowFocused, rowIndex]);
  const cardFocused = useCallback(
    (item: CatalogItem) => onCardFocused?.(item, shape),
    [onCardFocused, shape],
  );
  const renderCard = useCallback(
    (item: CatalogItem, ctx: CardContext) =>
      shape === 'landscape' ? (
        <LandscapeCard
          item={item}
          focusKey={ctx.focusKey}
          onFocused={ctx.onFocused}
          onOpen={onOpen}
        />
      ) : (
        <PosterCard item={item} focusKey={ctx.focusKey} onFocused={ctx.onFocused} onOpen={onOpen} />
      ),
    [shape, onOpen],
  );
  return (
    <Row
      rowId={rowId}
      title={title}
      shape={shape}
      items={items}
      getKey={contentId}
      memory={memory}
      mounted={mounted}
      prefetchRow={prefetchRow}
      artUrl={artUrl}
      onExploreAll={exploreAll}
      onRowFocused={rowFocused}
      onCardFocused={cardFocused}
      renderCard={renderCard}
    />
  );
});
